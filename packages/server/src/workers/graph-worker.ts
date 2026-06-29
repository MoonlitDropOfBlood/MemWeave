import { openDatabase } from '../db/database.js';
import type { Db } from '../db/database.js';
import { EdgeRepo } from '../db/repositories/edge-repo.js';
import { MemoryRepo } from '../db/repositories/memory-repo.js';
import type { LlmProvider } from '../providers/llm/index.js';
import type { EdgeType, MemoryRecord } from '../core/types.js';
import { logger } from '../server/logger.js';

interface EdgeCandidate {
  type: EdgeType;
  reason: string;
  confidence: number;
}

export interface GraphWorkerOptions {
  dbPath: string;
  llm: LlmProvider;
  /** Tenant id. Default: 'tenant_default'. */
  tenantId?: string;
  /** Max candidate memories to scan per run. Default: 32. */
  batchSize?: number;
  /** Cosine threshold for "candidate edge" pair candidates. Default: not used by default. */
  minSimilarity?: number;
  /** Run interval. Default: 1 hour. */
  intervalMs?: number;
  /** Run immediately on start. Default: false. */
  runOnStart?: boolean;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Callback fired after each run. */
  onRun?: (result: { scanned: number; edgesCreated: number; timestamp: number }) => void;
}

export interface GraphWorkerHandle {
  stop(): void;
  runNow(): Promise<{ scanned: number; edgesCreated: number; timestamp: number }>;
}

/**
 * Background graph worker (edge discovery).
 *
 * Periodically:
 *   1. Pull a batch of recent memories that have no outgoing edges yet.
 *   2. For each, ask the LLM (via the edge-extract prompt) what edges it
 *      should form with OTHER existing memories.
 *   3. Persist the resulting edges.
 *
 * In v1, we use a simple heuristic + LLM call to find candidates:
 *   - Use the noop or real LLM to extract edge candidates from the new
 *     memory's title + content.
 *   - Resolve `targetHint` to an existing memory by title or concept match.
 *
 * The worker never overwrites existing edges (skips when an edge of the same
 * `(from, to, type)` already exists).
 */
export function startGraphWorker(options: GraphWorkerOptions): GraphWorkerHandle {
  const tenantId = options.tenantId ?? 'tenant_default';
  const batchSize = options.batchSize ?? 32;
  const interval = options.intervalMs ?? 60 * 60 * 1000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function runOnce(): Promise<{ scanned: number; edgesCreated: number; timestamp: number }> {
    const result = { scanned: 0, edgesCreated: 0, timestamp: Date.now() };
    const db = openDatabase(options.dbPath);
    try {
      const memRepo = new MemoryRepo(db);
      const edgeRepo = new EdgeRepo(db);

      // Find recent memories that have no outgoing edges yet
      const candidates = db.prepare(`
        SELECT m.id, m.tenant_id, m.type, m.title, m.content, m.summary, m.concepts_json
        FROM memories m
        LEFT JOIN edges e ON e.from_memory_id = m.id
        WHERE m.tenant_id = ? AND m.deleted_at IS NULL
        GROUP BY m.id
        HAVING COUNT(e.id) = 0
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(tenantId, batchSize) as Array<{
        id: string; tenant_id: string; type: string; title: string; content: string;
        summary: string; concepts_json: string;
      }>;

      result.scanned = candidates.length;

      // For each candidate, look up potential targets by simple keyword overlap
      // (title contains a concept or vice versa). This is a simple heuristic to
      // avoid burning LLM tokens on every pair; the LLM is only called to judge
      // whether the candidate pair actually has a typed relationship.
      for (const mem of candidates) {
        const targets = findCandidateTargets(db, tenantId, mem);
        for (const target of targets) {
          if (target.id === mem.id) continue;
          const llmCandidates = await extractEdgesViaLlm(options.llm, mem, target);
          for (const cand of llmCandidates) {
            if (cand.confidence < 0.6) continue;
            try {
              edgeRepo.create({
                tenantId: mem.tenant_id,
                fromMemoryId: mem.id,
                toMemoryId: target.id,
                type: cand.type,
                strength: cand.confidence,
                reason: cand.reason
              });
              result.edgesCreated++;
            } catch {
              // ignore duplicate / FK errors silently
            }
          }
        }
      }
    } finally {
      db.close();
    }
    options.onRun?.(result);
    return result;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } catch (err) {
        logger.error({ err }, 'graph-worker run failed');
      }
      schedule();
    }, interval);
  }

  if (options.signal) {
    if (options.signal.aborted) stopped = true;
    else options.signal.addEventListener('abort', () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });
  }

  if (options.runOnStart) {
    void runOnce();
  }
  schedule();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    runNow: runOnce
  };
}

interface CandidateRow {
  id: string;
  title: string;
  summary: string;
  concepts_json: string;
}

function findCandidateTargets(
  db: Db,
  tenantId: string,
  mem: { id: string; title: string; summary: string; concepts_json: string }
): CandidateRow[] {
  // Cheap heuristic: pull up to 10 most recent memories of the same tenant
  // whose title shares at least one word (>=4 chars) with the new memory.
  // This is intentionally simple — the LLM call is the source of truth for
  // whether a relationship actually exists.
  const allRows = db.prepare(`
    SELECT id, title, summary, concepts_json
    FROM memories
    WHERE tenant_id = ? AND id != ? AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(tenantId, mem.id) as CandidateRow[];

  const memWords = tokenize(`${mem.title} ${mem.summary}`);
  return allRows.filter((r) => {
    const rWords = tokenize(`${r.title} ${r.summary}`);
    return memWords.some((w) => rWords.includes(w));
  }).slice(0, 10);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((w) => w.length >= 4);
}

async function extractEdgesViaLlm(
  llm: LlmProvider,
  newMemory: { title: string; content: string; concepts_json: string },
  target: { title: string; summary: string; concepts_json: string }
): Promise<EdgeCandidate[]> {
  const newConcepts = JSON.parse(newMemory.concepts_json) as string[];
  const targetConcepts = JSON.parse(target.concepts_json) as string[];
  const prompt = `New memory:\nTitle: ${newMemory.title}\nContent: ${newMemory.content}\nConcepts: ${newConcepts.join(', ')}\n\nExisting memory:\nTitle: ${target.title}\nSummary: ${target.summary}\nConcepts: ${targetConcepts.join(', ')}`;
  const raw = await llm.call(
    'You are a relationship extraction engine. Given a new memory and an existing memory, return a JSON array of relationships (each with targetMemoryId="__target__", type, reason, confidence). Output [] if no relationship exists.',
    prompt
  );
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const validTypes: ReadonlySet<EdgeType> = new Set<EdgeType>([
      'causes', 'enables', 'contradicts', 'supersedes', 'references',
      'related_to', 'before', 'after', 'duplicates', 'refines'
    ]);
    return (parsed as Array<{ type: string; reason: string; confidence: number }>)
      .filter((e) => typeof e.type === 'string' && typeof e.reason === 'string' && typeof e.confidence === 'number')
      .filter((e): e is EdgeCandidate => validTypes.has(e.type as EdgeType))
      .map((e) => ({ type: e.type as EdgeType, reason: e.reason, confidence: e.confidence }));
  } catch {
    return [];
  }
}

// Helper to satisfy unused-warning
void (null as unknown as MemoryRecord);
