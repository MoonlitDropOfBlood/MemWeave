import type { Db } from '../db/database.js';
import type { MemoryRecord, ScopeTag } from '../core/types.js';

interface MemoryRow {
  id: string;
  tenant_id: string;
  tier: 'short' | 'medium' | 'long';
  type: MemoryRecord['type'];
  title: string;
  content: string;
  summary: string;
  concepts_json: string;
  files_json: string;
  importance: number;
  confidence: number;
  strength: number;
  source: MemoryRecord['source'];
  scope_level: MemoryRecord['scopeLevel'];
  source_client: MemoryRecord['sourceClient'];
  source_device_id: string | null;
  source_session_id: string | null;
  tau: number;
  access_count: number;
  last_accessed_at: number | null;
  last_reinforced_at: number | null;
  last_decay_at: number | null;
  reinforcement_score: number;
  promoted_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  eviction_reason: string | null;
}

export interface SearchResultRow {
  memory: MemoryRecord;
  bm25Score: number;
}

export function bm25Search(
  db: Db,
  tenantId: string,
  query: string,
  limit: number,
  scopes?: Array<{ key: string; value: string }>
): SearchResultRow[] {
  try {
    if (!query.trim() || limit <= 0) return [];

    // FTS5 escaping: strip special chars, split into tokens, wrap each in double-quotes for literal matching
    const tokens = query.replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => `"${w}"`);
    if (tokens.length === 0) return [];
    const safe = tokens.join(' ');

    // Build query dynamically — scope filter uses EXISTS to avoid row duplication
    let sql = `
      SELECT m.*, bm25(memory_fts) AS bm25_score
      FROM memory_fts
      JOIN memories m ON m.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ?
        AND m.tenant_id = ?
        AND m.deleted_at IS NULL
    `;
    const params: unknown[] = [safe, tenantId];

    if (scopes && scopes.length > 0) {
      for (const scope of scopes) {
        sql += ` AND EXISTS (SELECT 1 FROM memory_scopes ms WHERE ms.memory_id = m.id AND ms.key = ? AND ms.value = ?)`;
        params.push(scope.key, scope.value);
      }
    }

    sql += ` ORDER BY bm25_score DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<MemoryRow & { bm25_score: number }>;

    // Batch query scopes for all returned memory IDs (populate mapRow correctly)
    const memoryIds = rows.map(r => r.id);
    const scopeMap = new Map<string, ScopeTag[]>();
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const scopeRows = db.prepare(`
        SELECT memory_id, key, value FROM memory_scopes
        WHERE tenant_id = ? AND memory_id IN (${placeholders})
        ORDER BY key, value
      `).all(tenantId, ...memoryIds) as Array<{ memory_id: string; key: string; value: string }>;
      for (const sr of scopeRows) {
        if (!scopeMap.has(sr.memory_id)) scopeMap.set(sr.memory_id, []);
        scopeMap.get(sr.memory_id)!.push({ key: sr.key, value: sr.value } as ScopeTag);
      }
    }

    return rows.map(row => ({
      memory: mapRow(row, scopeMap.get(row.id) ?? []),
      bm25Score: row.bm25_score
    }));
  } catch (err) {
    console.error('[bm25Search] search failed:', err);
    return [];
  }
}

function mapRow(row: MemoryRow, scopes: ScopeTag[]): MemoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tier: row.tier,
    type: row.type,
    title: row.title,
    content: row.content,
    summary: row.summary,
    concepts: JSON.parse(row.concepts_json) as string[],
    files: JSON.parse(row.files_json) as string[],
    importance: row.importance,
    confidence: row.confidence,
    strength: row.strength,
    source: row.source,
    scopeLevel: row.scope_level,
    scopes,
    sourceClient: row.source_client,
    sourceDeviceId: row.source_device_id,
    sourceSessionId: row.source_session_id,
    tau: row.tau,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    lastReinforcedAt: row.last_reinforced_at,
    lastDecayAt: row.last_decay_at,
    reinforcementScore: row.reinforcement_score,
    promotedAt: row.promoted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    evictionReason: row.eviction_reason
  };
}
