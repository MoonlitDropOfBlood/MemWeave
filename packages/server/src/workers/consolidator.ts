import type { Db } from '../db/database.js';
import { transaction } from '../db/database.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../server/logger.js';
import { MemoryRepo } from '../db/repositories/memory-repo.js';
import { evaluateObservation, type ValueGateResult } from './value-gate.js';
import { EdgeRepo } from '../db/repositories/edge-repo.js';
import type { ScopeTag, MemoryType } from '../core/types.js';

export interface ConsolidationResult {
  /** Observations promoted to memories. */
  promoted: number;
  /** Short-tier memories promoted to medium tier. */
  tierPromoted: number;
  evicted: number;
  merged: number;
  /** Edges created during the merge pass (duplicates edges). */
  edgesCreated: number;
  /** Ids of observations promoted to new memories. */
  promotedIds: string[];
  /** Ids of memories promoted short -> medium tier. */
  tierPromotedIds: string[];
  /** Ids of memories soft-deleted. */
  evictedIds: string[];
  /** Ids of memory pairs merged (each inner array is [survivor, absorbed]). */
  mergedPairs: string[][];
  summary: string;
}

/**
 * Process-wide mutex: only one consolidation may run at a time.
 * Without this, a manual `POST /api/v1/consolidate` triggered while
 * the scheduler is also running would double-evict / double-promote
 * the same memories and produce two `consolidation_runs` rows that
 * share work. The scheduler AGENTS.md says "NEVER run two
 * consolidations concurrently" — this enforces it.
 *
 * Not perfect (a second node wouldn't see this flag), but for the
 * v1 single-node deployment the project targets, it's sufficient.
 */
let consolidationInFlight = false;

export function isConsolidationRunning(): boolean {
  return consolidationInFlight;
}

export function runConsolidation(
  db: Db,
  tenantId: string,
  options: { dryRun?: boolean } = {}
): ConsolidationResult {
  if (consolidationInFlight) {
    return {
      promoted: 0,
      tierPromoted: 0,
      evicted: 0,
      merged: 0,
      edgesCreated: 0,
      promotedIds: [],
      tierPromotedIds: [],
      evictedIds: [],
      mergedPairs: [],
      summary: 'Skipped: another consolidation is already running.'
    };
  }
  consolidationInFlight = true;
  try {
    return runConsolidationInner(db, tenantId, options);
  } finally {
    consolidationInFlight = false;
  }
}

function runConsolidationInner(
  db: Db,
  tenantId: string,
  options: { dryRun?: boolean }
): ConsolidationResult {
  const result: ConsolidationResult = {
    promoted: 0,
    tierPromoted: 0,
    evicted: 0,
    merged: 0,
    edgesCreated: 0,
    promotedIds: [],
    tierPromotedIds: [],
    evictedIds: [],
    mergedPairs: [],
    summary: ''
  };
  const DAY = 24 * 60 * 60 * 1000;
  let edgesCreatedCount = 0;

  try {
    const now = Date.now();

    // 0. Promote unprocessed observations into memories. Runs BEFORE
    //    evict/promote-tier/merge so the new memories participate in
    //    the same eviction and merge passes (a buggy observation
    //    that gets promoted can still be evicted or merged away on
    //    the same run).
    if (!options.dryRun) {
      const promotedObs = promoteObservationsToMemories(db, tenantId);
      result.promoted = promotedObs.length;
      result.promotedIds = promotedObs;
    }


    // 1. Evict short-term: strength < 0.1 AND age > 7 days AND 0 access
    const toEvict = db.prepare(`
      SELECT id FROM memories
      WHERE tenant_id = ? AND tier = 'short' AND deleted_at IS NULL
        AND strength < 0.1 AND access_count = 0
        AND (? - created_at) > ?
    `).all(tenantId, now, 7 * DAY) as Array<{ id: string }>;

    if (!options.dryRun && toEvict.length > 0) {
      transaction(db, () => {
        const stmt = db.prepare('UPDATE memories SET deleted_at = ?, eviction_reason = ? WHERE id = ?');
        for (const row of toEvict) {
          stmt.run(now, 'low_strength_old_age', row.id);
        }
      });
    }
    result.evicted = toEvict.length;
    result.evictedIds = toEvict.map((r) => r.id);

    // 2. Promote short→medium: accessed >= 3 times recently OR importance >= 7
    const toPromote = db.prepare(`
      SELECT id FROM memories
      WHERE tenant_id = ? AND tier = 'short' AND deleted_at IS NULL
        AND ((access_count >= 3 AND (? - last_accessed_at) < ?) OR importance >= 7)
    `).all(tenantId, now, 7 * DAY) as Array<{ id: string }>;

    if (!options.dryRun && toPromote.length > 0) {
      transaction(db, () => {
        const stmt = db.prepare('UPDATE memories SET tier = ?, promoted_at = ? WHERE id = ?');
        for (const row of toPromote) {
          stmt.run('medium', now, row.id);
        }
      });
    }
    result.tierPromoted = toPromote.length;
    result.tierPromotedIds = toPromote.map((r) => r.id);

    // 2b. Promote medium→long: high importance AND frequently accessed OR
    //     strongly reinforced. This was MISSING before — nothing ever reached
    //     the long tier (the consolidator only created importance 6/8, and the
    //     only `long` assignment was at create-time when importance >= 10,
    //     which the consolidator never produced). The long tier drives the
    //     injection stable pack and the Atlas dashboard's long-tier bar, so
    //     leaving it permanently empty made the Web UI look barren.
    const toPromoteLong = db.prepare(`
      SELECT id FROM memories
      WHERE tenant_id = ? AND tier = 'medium' AND deleted_at IS NULL
        AND (
          (importance >= 8 AND access_count >= 5)
          OR (importance >= 7 AND reinforcement_score >= 0.5)
        )
    `).all(tenantId) as Array<{ id: string }>;

    if (!options.dryRun && toPromoteLong.length > 0) {
      transaction(db, () => {
        const stmt = db.prepare('UPDATE memories SET tier = ?, promoted_at = ? WHERE id = ?');
        for (const row of toPromoteLong) {
          stmt.run('long', now, row.id);
        }
      });
    }
    result.tierPromoted += toPromoteLong.length;
    result.tierPromotedIds.push(...toPromoteLong.map((r) => r.id));

    // 3. Merge near-duplicates. Reuses the Jaccard-on-concepts logic
    //    that `MemoryRepo.create` uses, but operating on existing rows.
    //    For each pair (a, b) where a.id < b.id AND Jaccard(concepts) >= 0.8
    //    AND same type AND same tenant, keep the older (a) and absorb b.
    //
    //    The same threshold is used as the live dedup gate, so a memory
    //    that slipped through during a high-throughput write (e.g.
    //    Jaccard = 0.75 because the new save only had partial concepts)
    //    will still be merged here if the operator later enriches the
    //    older memory's concepts.
    if (!options.dryRun) {
      const mergeResult = mergeNearDuplicates(db, tenantId, now);
      result.merged = mergeResult.merged.length;
      result.mergedPairs = mergeResult.merged;
      edgesCreatedCount += mergeResult.edgesCreated;
    }

    result.summary =
      `Promoted ${result.promoted} obs to memory, evicted ${result.evicted}, tier-promoted ${result.tierPromoted}, merged ${result.merged} pairs, edges ${edgesCreatedCount}`;
  } catch (err) {
    logger.error({ err }, 'consolidation failed');
  }

  result.edgesCreated = edgesCreatedCount;
  return result;
}

/**
 * Find pairs of near-duplicate memories (Jaccard on concepts >= 0.8,
 * same type) and absorb the newer one into the older. Returns the list
 * of [survivorId, absorbedId] pairs.
 *
 * This is the *background* counterpart to the live dedup gate in
 * `MemoryRepo.create`. They use the same threshold and the same Jaccard
 * formula, so behavior is consistent.
 */
function mergeNearDuplicates(db: Db, tenantId: string, now: number): { merged: string[][]; edgesCreated: number } {
  // Load all live memories for this tenant. In a real production system
  // we'd page this; for v1 with O(thousands) memories per tenant, an
  // in-memory O(n^2) pass is acceptable (a few seconds at most).
  const allMemories = db.prepare(`
    SELECT id, type, content, summary, importance, confidence,
           concepts_json, files_json, created_at
    FROM memories
    WHERE tenant_id = ? AND deleted_at IS NULL
    ORDER BY created_at ASC
  `).all(tenantId) as Array<{
    id: string;
    type: string;
    content: string;
    summary: string;
    importance: number;
    confidence: number;
    concepts_json: string;
    files_json: string;
    created_at: number;
  }>;

  const JACCARD_THRESHOLD = 0.8;
  const SURVIVOR_BENEFIT = 0.05;  // bump survivor's strength on absorb
  const merged: string[][] = [];
  const absorbed = new Set<string>();
  let edgesCreatedInMerge = 0;

  for (let i = 0; i < allMemories.length; i++) {
    const a = allMemories[i];
    if (absorbed.has(a.id)) continue;
    const aConcepts = new Set(
      (JSON.parse(a.concepts_json) as string[]).map((c) => c.toLowerCase())
    );
    if (aConcepts.size === 0) continue;

    for (let j = i + 1; j < allMemories.length; j++) {
      const b = allMemories[j];
      if (absorbed.has(b.id)) continue;
      if (a.type !== b.type) continue;

      const bConcepts = new Set(
        (JSON.parse(b.concepts_json) as string[]).map((c) => c.toLowerCase())
      );
      const jaccard = jaccardSimilarity(aConcepts, bConcepts);
      if (jaccard < JACCARD_THRESHOLD) continue;

      // a is older (ORDER BY created_at ASC) — keep a, absorb b.
      // b's concepts/files are unioned into a; b is soft-deleted.
      const mergedConcepts = Array.from(new Set([
        ...aConcepts,
        ...bConcepts
      ]));
      const mergedFiles = Array.from(new Set([
        ...(JSON.parse(a.files_json) as string[]),
        ...(JSON.parse(b.files_json) as string[])
      ]));

      transaction(db, () => {
        // Boost the survivor.
        db.prepare(`
          UPDATE memories
          SET concepts_json = ?,
              concepts_text = ?,
              files_json = ?,
              importance = MAX(importance, ?),
              access_count = access_count + 1,
              last_reinforced_at = ?,
              reinforcement_score = min(1, reinforcement_score + ?),
              strength = min(1, strength + ?),
              updated_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(mergedConcepts),
          mergedConcepts.join(' '),
          JSON.stringify(mergedFiles),
          b.importance,
          now,
          SURVIVOR_BENEFIT,
          SURVIVOR_BENEFIT,
          now,
          a.id
        );
        // Soft-delete the absorbed.
        db.prepare(`
          UPDATE memories
          SET deleted_at = ?, eviction_reason = ?
          WHERE id = ?
        `).run(now, 'merged_into_consolidation', b.id);
        // ── Write a `duplicates` edge (survivor → absorbed) ──────────────
        // Previously the merge step soft-deleted b and strengthened a but left
        // NO edge, so the graph view and causal/graph retrieval layers stayed
        // empty. Now we record a `duplicates` edge so the relationship is
        // discoverable. Idempotent: skip if an edge of the same triple exists.
        try {
          const existing = db.prepare(`
            SELECT 1 FROM edges
            WHERE from_memory_id = ? AND to_memory_id = ? AND type = 'duplicates'
            LIMIT 1
          `).get(a.id, b.id);
          if (!existing) {
            db.prepare(`
              INSERT INTO edges (id, tenant_id, from_memory_id, to_memory_id, type, strength, reason, created_at)
              VALUES (?, ?, ?, ?, 'duplicates', 0.9, 'merged near-duplicate during consolidation', ?)
            `).run(randomUUID(), tenantId, a.id, b.id, now);
            edgesCreatedInMerge++;
          }
        } catch {
          // Edge write failure is non-fatal — the merge already succeeded.
        }
        // Audit log.
        db.prepare(`
          INSERT INTO consolidation_runs (id, tenant_id, started_at, ended_at, summary, dry_run)
          SELECT ?, ?, ?, ?, ?, 0
          WHERE NOT EXISTS (SELECT 1 FROM consolidation_runs WHERE id = ?)
        `).run(`merge-${a.id}-${b.id}-${now}`, tenantId, now, now, `merged ${b.id} -> ${a.id}`, `merge-${a.id}-${b.id}-${now}`);
      });

      absorbed.add(b.id);
      merged.push([a.id, b.id]);
    }
  }

  return { merged, edgesCreated: edgesCreatedInMerge };
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Phase 0: promote unprocessed `observations` into memories.
 *
 * Each observation is run through `evaluateObservation` (the
 * value-gate) to decide whether it carries memory-worthy signal.
 * Promoted observations are inserted as memories via `MemoryRepo.create`
 * (so the write-side dedup gate applies), and the observation is
 * linked to the new memory + marked `processed = 1`. Observations
 * the value-gate rejects are also marked `processed = 1` so the
 * next run does not re-evaluate them - we never want to spend
 * CPU on the same uninteresting message twice.
 *
 * The new memory inherits the observation's `scopes_json` (project
 * / domain / topic tags the client attached) so cross-project
 * recall and search filters work without re-classification.
 *
 * Returns the list of new memory ids.
 */
function promoteObservationsToMemories(db: Db, tenantId: string): string[] {
  const repo = new MemoryRepo(db);
  const newMemoryIds: string[] = [];

  // Read unprocessed observations oldest first. Cap at 200 per
  // run so a backlog of thousands doesn't lock the DB for minutes.
  const BATCH_LIMIT = 200;
  const rows = db.prepare(`
    SELECT id, session_id, hook_type, tool_name, tool_input, tool_output,
           scopes_json
    FROM observations
    WHERE tenant_id = ? AND processed = 0 AND memory_id IS NULL
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(tenantId, BATCH_LIMIT) as Array<{
    id: string;
    session_id: string;
    hook_type: string;
    tool_name: string | null;
    tool_input: string | null;
    tool_output: string | null;
    scopes_json: string;
  }>;

  if (rows.length === 0) return newMemoryIds;

  // Track which observation ids we've processed in this run so the
  // bulk UPDATE at the end touches only those rows (avoids losing
  // observations other instances might be processing concurrently).
  const processedIds: string[] = [];
  // Track which observations became memories (for the audit log).
  const promotedPairs: Array<{ obsId: string; memId: string; reason: string }> = [];

  for (const obs of rows) {
    const toolInput = parseJsonSafe(obs.tool_input);
    const scopes = parseJsonSafe<ScopeTag[]>(obs.scopes_json) ?? [];

    // Map observation fields to the value-gate input shape.
    // For chat.user / chat.assistant hooks, the user/assistant text
    // is in `tool_output` (where the OpenCode plugin writes the
    // message body). For chat.tool hooks, the input/output come
    // from the tool wrapper.
    const userPrompt = obs.hook_type === 'chat.user' || obs.hook_type === 'prompt_submit'
      ? obs.tool_output ?? ''
      : extractUserPrompt(toolInput);
    const toolOutput = obs.tool_output ?? '';
    const error = extractError(toolInput, toolOutput);

    const verdict: ValueGateResult = evaluateObservation({
      hookType: obs.hook_type,
      toolName: obs.tool_name ?? undefined,
      toolInput: obs.tool_input ?? undefined,
      toolOutput,
      userPrompt,
      error,
    });

    processedIds.push(obs.id);

    if (!verdict.shouldCreateMemory) continue;

    // Build a memory from the observation. Importance defaults: high
    // priority -> 8, medium -> 6, low (would not happen since we
    // skip shouldCreateMemory=false) -> not used.
    const importance = verdict.priority === 'high' ? 8 : 6;
    // Pick the first suggested type, fall back to 'fact'. The
    // value-gate returns `MemoryType`-shaped strings, but TypeScript
    // can't prove that without importing the union (which we do at
    // the top of the file). Narrow with a Set check rather than
    // `as any`.
    const VALID_TYPES = new Set<MemoryType>([
      'fact', 'decision', 'preference', 'event', 'project_context',
      'lesson', 'code_pattern', 'bug', 'workflow'
    ]);
    const suggested = verdict.suggestedTypes[0];
    const type: MemoryType = (suggested && VALID_TYPES.has(suggested as MemoryType))
      ? (suggested as MemoryType)
      : 'fact';
    // Title: first 80 chars of the content, sanitized.
    const titleRaw = (userPrompt || toolOutput || '').replace(/\s+/g, ' ').trim();
    const title = titleRaw.slice(0, 80) || `${verdict.reason} (${obs.hook_type})`;
    // Content: prefer user prompt, fall back to tool output.
    const content = userPrompt || toolOutput || verdict.reason;

    // scopeLevel: if any scope is 'project' tag, scope is 'project';
    // otherwise 'global'. This is what the Web UI's project switcher
    // and the search filter both key off of.
    const scopeLevel: 'project' | 'global' = scopes.some((s) => s.key === 'project')
      ? 'project'
      : 'global';

    try {
      const created = repo.create({
        tenantId,
        type,
        title,
        content,
        summary: content.slice(0, 200),
        concepts: [],
        files: [],
        importance,
        confidence: 0.8,
        source: 'agent_capture',
        scopeLevel,
        scopes,
        sourceClient: null,
        sourceSessionId: obs.session_id,
        sourceDeviceId: null,
      });
      // Link observation -> memory so future reads know where it went.
      db.prepare('UPDATE observations SET memory_id = ? WHERE id = ?')
        .run(created.id, obs.id);
      newMemoryIds.push(created.id);
      promotedPairs.push({ obsId: obs.id, memId: created.id, reason: verdict.reason });
    } catch (err) {
      // One bad observation should not abort the whole run.
      logger.error({ err, obsId: obs.id }, 'promoteObservations: create failed');
    }
  }

  // Mark all touched observations as processed. We do this in one
  // statement so a crash mid-loop doesn't leave rows half-processed.
  if (processedIds.length > 0) {
    const placeholders = processedIds.map(() => '?').join(',');
    db.prepare(`
      UPDATE observations
      SET processed = 1
      WHERE id IN (${placeholders}) AND tenant_id = ?
    `).run(...processedIds, tenantId);
  }

  if (promotedPairs.length > 0) {
    logger.info(
      { tenantId, count: promotedPairs.length, sample: promotedPairs.slice(0, 3) },
      'promoted observations to memories'
    );
  }

  return newMemoryIds;
}

function parseJsonSafe<T = unknown>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * OpenCode's plugin packs the chat.user prompt and any tool envelope
 * into the observation's `tool_input` as a JSON envelope of the form
 * { messageId, toolInput?, toolName? }. The actual user prompt is not
 * in tool_input; for chat.* hooks it lives in `tool_output`. This
 * helper exists for future hook shapes where a structured prompt
 * might be supplied.
 */
function extractUserPrompt(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const obj = toolInput as Record<string, unknown>;
  const candidate = obj.userPrompt ?? obj.user_prompt ?? obj.prompt ?? obj.text;
  return typeof candidate === 'string' ? candidate : '';
}

function extractError(toolInput: unknown, toolOutput: string): string {
  // The plugin's reportObservation doesn't surface a top-level error
  // field today. We pull error-shaped keys from the tool envelope
  // if any, and fall back to a substring scan of the output.
  if (toolInput && typeof toolInput === 'object') {
    const obj = toolInput as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
  }
  if (/error|exception|failed|crash/i.test(toolOutput)) {
    return toolOutput.slice(0, 500);
  }
  return '';
}
