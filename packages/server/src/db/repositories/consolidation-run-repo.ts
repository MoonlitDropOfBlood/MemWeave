import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';

export interface RecordConsolidationRunInput {
  tenantId: string;
  startedAt: number;
  endedAt: number;
  promoted: string[];
  evicted: string[];
  merged: string[][];     // each inner array is [from, to]
  edgesCreated: number;
  contradictionFound: number;
  dryRun: boolean;
  summary: string;
}

export interface ConsolidationRunRecord {
  id: string;
  tenantId: string;
  startedAt: number;
  endedAt: number;
  promoted: string[];
  evicted: string[];
  merged: string[][];
  edgesCreated: number;
  contradictionFound: number;
  dryRun: boolean;
  summary: string;
}

interface RunRow {
  id: string;
  tenant_id: string;
  started_at: number;
  ended_at: number;
  promoted_count: number;
  evicted_count: number;
  merged_count: number;
  edges_created_count: number;
  contradiction_found_count: number;
  promoted_ids: string;
  evicted_ids: string;
  merged_pairs: string;
  dry_run: number;
  summary: string;
}

export class ConsolidationRunRepo {
  constructor(private readonly db: Db) {}

  record(input: RecordConsolidationRunInput): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO consolidation_runs (
        id, tenant_id, started_at, ended_at,
        promoted_count, evicted_count, merged_count,
        edges_created_count, contradiction_found_count,
        promoted_ids, evicted_ids, merged_pairs,
        dry_run, summary
      ) VALUES (
        @id, @tenantId, @startedAt, @endedAt,
        @promotedCount, @evictedCount, @mergedCount,
        @edgesCreated, @contradictionFound,
        @promotedIds, @evictedIds, @mergedPairs,
        @dryRun, @summary
      )
    `).run({
      id,
      tenantId: input.tenantId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      promotedCount: input.promoted.length,
      evictedCount: input.evicted.length,
      mergedCount: input.merged.length,
      edgesCreated: input.edgesCreated,
      contradictionFound: input.contradictionFound,
      promotedIds: JSON.stringify(input.promoted),
      evictedIds: JSON.stringify(input.evicted),
      mergedPairs: JSON.stringify(input.merged),
      dryRun: input.dryRun ? 1 : 0,
      summary: input.summary
    });
    return id;
  }

  getById(tenantId: string, id: string): ConsolidationRunRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM consolidation_runs WHERE tenant_id = ? AND id = ?
    `).get(tenantId, id) as RunRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listRecent(tenantId: string, limit: number): ConsolidationRunRecord[] {
    if (limit <= 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM consolidation_runs
      WHERE tenant_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?
    `).all(tenantId, limit) as RunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  latestForTenant(tenantId: string): ConsolidationRunRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM consolidation_runs
      WHERE tenant_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `).get(tenantId) as RunRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  private mapRow(row: RunRow): ConsolidationRunRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      promoted: JSON.parse(row.promoted_ids) as string[],
      evicted: JSON.parse(row.evicted_ids) as string[],
      merged: JSON.parse(row.merged_pairs) as string[][],
      edgesCreated: row.edges_created_count,
      contradictionFound: row.contradiction_found_count,
      dryRun: row.dry_run === 1,
      summary: row.summary
    };
  }
}
