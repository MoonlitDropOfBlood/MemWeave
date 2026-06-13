import type { Db } from '../db/database.js';
import { transaction } from '../db/database.js';

export interface ConsolidationResult {
  promoted: number;
  evicted: number;
  /** Ids of memories promoted from short to medium. */
  promotedIds: string[];
  /** Ids of memories soft-deleted. */
  evictedIds: string[];
  summary: string;
}

export function runConsolidation(
  db: Db,
  tenantId: string,
  options: { dryRun?: boolean } = {}
): ConsolidationResult {
  const result: ConsolidationResult = {
    promoted: 0,
    evicted: 0,
    promotedIds: [],
    evictedIds: [],
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

    result.summary = `Evicted ${result.evicted} short-term, promoted ${result.promoted} to medium`;
  } catch (err) {
    console.error('Consolidation failed:', err);
  }

  return result;
}
