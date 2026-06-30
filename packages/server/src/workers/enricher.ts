import { openDatabase, type Db } from '../db/database.js';
import type { LlmProvider } from '../providers/llm/index.js';
import type { EmbeddingProvider } from '../providers/embedding/index.js';
import type { MemoryType } from '../core/types.js';
import { COMPRESSION_SYSTEM, buildCompressionPrompt } from '../prompts/compression.js';
import { parseJsonLenient } from './json-repair.js';
import { VectorRepo } from '../db/repositories/vector-repo.js';
import { logger } from '../server/logger.js';

/**
 * The set of valid MemoryType values (mirrors the Zod enum in core/types.ts).
 * Used to validate the LLM's `type` output.
 */
const VALID_TYPES = new Set<MemoryType>([
  'fact', 'decision', 'preference', 'event', 'project_context',
  'lesson', 'code_pattern', 'bug', 'workflow'
]);

export interface EnrichResult {
  enriched: number;
  failed: number;
  skipped: number;
  /** Ids of memories that were successfully enriched. */
  enrichedIds: string[];
}

interface MemoryToEnrich {
  id: string;
  tenant_id: string;
  tier: string;
  type: string;
  title: string;
  content: string;
  summary: string;
  concepts_json: string;
  source_session_id: string | null;
}

/**
 * Enrich memories that lack a proper title/summary/concepts.
 *
 * This is the LLM-powered counterpart to the consolidator's rule-based
 * promotion. The consolidator creates memories with `title = first 80 chars`
 * and `concepts: []` (the data-quality problem that left 975/1015 memories
 * with empty concepts and BM25 searching against raw conversation text).
 * enrichMemories picks those up and asks the LLM to produce a real title,
 * compressed summary, and reusable concept keywords.
 *
 * Key design decisions:
 * - **Async, fire-and-forget**: called after the synchronous consolidation
 *   pass completes, so it never blocks the scheduler loop.
 * - **JSON-repair layer**: small models emit malformed JSON; we use
 *   parseJsonLenient to recover. On total failure we KEEP the original
 *   values — never lose data.
 * - **Also embeds**: after rewriting the text, we (re)generate the vector so
 *   the vector layer reflects the enriched content.
 * - **Batched**: processes up to `batchSize` memories per run to bound latency.
 */
/**
 * Process-wide flag: once embedding fails (model download blocked, network
 * down), disable it for ALL subsequent enrichMemories calls in this process.
 * The backfill script calls enrichMemories in a loop — without this module-
 * level flag, each round would re-attempt embedding and re-fail, stalling the
 * run with per-call timeouts. LLM enrichment (title/summary/concepts) is
 * unaffected; only the vector is skipped until the process restarts.
 */
let embeddingDisabledProcessWide = false;

export async function enrichMemories(
  dbPath: string,
  tenantId: string,
  llm: LlmProvider,
  embedding: EmbeddingProvider | undefined,
  options: { batchSize?: number; dryRun?: boolean } = {}
): Promise<EnrichResult> {
  const batchSize = options.batchSize ?? 25;
  const result: EnrichResult = { enriched: 0, failed: 0, skipped: 0, enrichedIds: [] };

  const db = openDatabase(dbPath);
  try {
    return await enrichMemoriesInner(db, tenantId, llm, embedding, batchSize, options.dryRun ?? false, result);
  } finally {
    db.close();
  }
}

async function enrichMemoriesInner(
  db: Db,
  tenantId: string,
  llm: LlmProvider,
  embedding: EmbeddingProvider | undefined,
  batchSize: number,
  dryRun: boolean,
  result: EnrichResult
): Promise<EnrichResult> {

  // Select memories needing enrichment: concepts empty OR title looks like raw
  // conversation (heuristic: title starts with a lowercase letter or contains
  // conversational fillers). Ordered oldest-first so backfill progresses.
  const candidates = db.prepare(`
    SELECT id, tenant_id, tier, type, title, content, summary, concepts_json, source_session_id
    FROM memories
    WHERE tenant_id = ? AND deleted_at IS NULL
      AND (
        concepts_json = '[]'
        OR concepts_json IS NULL
        OR title LIKE 'Let me%'
        OR title LIKE 'I''ll%'
        OR title LIKE 'I''m%'
        OR title LIKE 'Good %'
        OR title LIKE 'OK %'
        OR title LIKE 'So %'
        OR title LIKE 'Well %'
      )
    ORDER BY created_at ASC
    LIMIT ?
  `).all(tenantId, batchSize) as MemoryToEnrich[];

  if (candidates.length === 0) return result;

  const dims = embedding?.dimensions ?? 768;
  const vecRepo = (embedding && !embeddingDisabledProcessWide) ? new VectorRepo(db, dims) : null;

  for (const mem of candidates) {
    try {
      const candidate = await enrichOne(llm, mem);
      if (!candidate) {
        result.skipped++;
        continue;
      }
      if (dryRun) {
        result.enriched++;
        result.enrichedIds.push(mem.id);
        continue;
      }

      // Write back the enriched fields. We preserve the original tier and
      // reinforcement metrics — only text/type/importance/concepts change.
      const conceptsJson = JSON.stringify(candidate.concepts);
      const conceptsText = candidate.concepts.join(' ');
      const now = Date.now();
      db.prepare(`
        UPDATE memories
        SET title = ?, summary = ?, content = ?, type = ?, importance = ?,
            concepts_json = ?, concepts_text = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(
        candidate.title, candidate.summary, candidate.content,
        candidate.type, candidate.importance,
        conceptsJson, conceptsText, now,
        mem.id, tenantId
      );

      // (Re)generate the embedding from the enriched text. Skipped entirely
      // once embedding has failed in this process (network/model-download
      // issues won't recover, and retrying stalls the backfill).
      if (vecRepo && embedding && !embeddingDisabledProcessWide) {
        try {
          const text = [candidate.title, candidate.summary, candidate.content, conceptsText].filter(Boolean).join('\n');
          // Race against a 30s timeout so a hung fetch can't stall the run.
          const vec = await Promise.race([
            embedding.embed(text),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('embedding timeout (30s)')), 30_000))
          ]);
          vecRepo.upsert(mem.id, tenantId, vec);
        } catch (err) {
          embeddingDisabledProcessWide = true;
          logger.warn({ err: (err as Error).message }, 'enrich: embedding disabled process-wide until restart (LLM enrichment continues)');
        }
      }

      result.enriched++;
      result.enrichedIds.push(mem.id);
    } catch (err) {
      result.failed++;
      logger.warn({ err: (err as Error).message, memId: mem.id }, 'enrich: failed');
    }
  }

  logger.info(
    { tenantId, enriched: result.enriched, failed: result.failed, skipped: result.skipped },
    'enrichMemories complete'
  );
  return result;
}

/**
 * Call the LLM on one memory and parse the result. Returns null if the LLM
 * says "not worth remembering" or output can't be recovered — caller skips.
 * On partial success, fields are clamped to valid ranges.
 */
async function enrichOne(
  llm: LlmProvider,
  mem: MemoryToEnrich
): Promise<EnrichedMemory | null> {
  const prompt = buildCompressionPrompt({
    hookType: `tier=${mem.tier},type=${mem.type}`,
    userPrompt: mem.title,
    toolOutput: mem.content,
    timestamp: new Date().toISOString()
  });

  const raw = await llm.call(COMPRESSION_SYSTEM, prompt);
  if (!raw.trim()) return null;

  const parsed = parseJsonLenient(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;

  // If the LLM decides this memory isn't worth keeping, skip (don't delete —
  // the consolidator's eviction pass handles lifecycle).
  if (parsed.shouldCreateMemory === false) return null;

  const title = clampString(String(parsed.title ?? mem.title), 1, 120, mem.title);
  const summary = clampString(String(parsed.summary ?? mem.summary), 1, 300, mem.summary);
  const content = clampString(String(parsed.content ?? mem.content), 1, 10000, mem.content);

  const typeRaw = String(parsed.type ?? mem.type);
  const type: MemoryType = VALID_TYPES.has(typeRaw as MemoryType) ? (typeRaw as MemoryType) : (mem.type as MemoryType);

  const concepts = clampConcepts(Array.isArray(parsed.concepts) ? (parsed.concepts as unknown[]) : []);
  const importance = clampInt(Number(parsed.importance ?? 5), 1, 10, 5);

  return { title, summary, content, type, concepts, importance };
}

interface EnrichedMemory {
  title: string;
  summary: string;
  content: string;
  type: MemoryType;
  concepts: string[];
  importance: number;
}

function clampString(val: string, min: number, max: number, fallback: string): string {
  const v = (val ?? '').trim();
  if (v.length < min) return fallback;
  return v.length > max ? v.slice(0, max) : v;
}

function clampConcepts(arr: unknown[]): string[] {
  const out = arr
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 80))
    .filter((x, i, self) => self.indexOf(x) === i) // dedupe
    .slice(0, 50);
  return out;
}

function clampInt(val: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}
