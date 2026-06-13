import type { Db } from '../db/database.js';
import { transaction } from '../db/database.js';
import { logger } from '../server/logger.js';

export interface ConsolidationResult {
  promoted: number;
  evicted: number;
  merged: number;
  /** Ids of memories promoted from short to medium. */
  promotedIds: string[];
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
      evicted: 0,
      merged: 0,
      promotedIds: [],
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
    evicted: 0,
    merged: 0,
    promotedIds: [],
    evictedIds: [],
    mergedPairs: [],
    summary: ''
  };
  const DAY = 24 * 60 * 60 * 1000;

  try {
    const now = Date.now();

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
        const stmt = db.prepare('UPDATE memories SET tier = ? WHERE id = ?');
        for (const row of toPromote) {
          stmt.run('medium', row.id);
        }
      });
    }
    result.promoted = toPromote.length;
    result.promotedIds = toPromote.map((r) => r.id);

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
      const merged = mergeNearDuplicates(db, tenantId, now);
      result.merged = merged.length;
      result.mergedPairs = merged;
    }

    result.summary =
      `Evicted ${result.evicted}, promoted ${result.promoted}, merged ${result.merged} pairs`;
  } catch (err) {
    logger.error({ err }, 'consolidation failed');
  }

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
function mergeNearDuplicates(db: Db, tenantId: string, now: number): string[][] {
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

  return merged;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
