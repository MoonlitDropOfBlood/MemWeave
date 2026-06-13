import type { Db } from '../db/database.js';
import { getVecTableName, VECTOR_DEFAULT_DIMENSIONS } from '../db/database.js';
import type { MemoryRecord } from '../core/types.js';

export interface VectorSearchResult {
  memory: MemoryRecord;
  distance: number;
  similarity: number;
}

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

/**
 * Vector similarity search using sqlite-vec.
 *
 * Returns the top-`limit` memories in the tenant whose stored embedding is
 * closest to `queryVector` (L2 distance, then converted to similarity
 * = 1 / (1 + distance) for downstream fusion).
 */
export function vectorSearch(
  db: Db,
  tenantId: string,
  queryVector: number[],
  limit: number,
  dimensions: number = VECTOR_DEFAULT_DIMENSIONS
): VectorSearchResult[] {
  if (limit <= 0 || queryVector.length === 0) return [];
  if (queryVector.length !== dimensions) {
    // Mismatched dimensions — degrade gracefully.
    return [];
  }

  const tableName = getVecTableName(dimensions);

  // Verify the vec table exists; if not, vector search returns empty.
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;
  if (!exists) return [];

  const float32 = new Float32Array(queryVector);
  // Use a subquery: sqlite-vec's `MATCH` operator only works on the
  // outermost virtual table in a query. Wrapping the vec search as a
  // subquery lets us join the result against `memories` for scope/type filters.
  const rows = db.prepare(`
    SELECT
      m.id, m.tenant_id, m.tier, m.type, m.title, m.content, m.summary,
      m.concepts_json, m.files_json, m.importance, m.confidence, m.strength,
      m.source, m.scope_level, m.source_client, m.source_device_id,
      m.source_session_id, m.tau, m.access_count, m.last_accessed_at,
      m.last_reinforced_at, m.last_decay_at, m.reinforcement_score,
      m.promoted_at, m.created_at, m.updated_at, m.deleted_at, m.eviction_reason,
      v.distance AS vec_distance
    FROM (
      SELECT memory_id, tenant_id, distance
      FROM ${tableName}
      WHERE embedding MATCH ? AND k = ?
    ) v
    JOIN memories m ON m.id = v.memory_id
    WHERE v.tenant_id = ? AND m.deleted_at IS NULL
    ORDER BY v.distance
    LIMIT ?
  `).all(float32, limit, tenantId, limit) as Array<MemoryRow & { vec_distance: unknown }>;

  return rows.map((row) => {
    const distance = Number(row.vec_distance);
    return {
      memory: rowToMemory(row),
      distance,
      similarity: similarityFromL2(distance)
    };
  });
}

function rowToMemory(row: MemoryRow): MemoryRecord {
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
    scopes: [],
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

/** L2 distance → [0, 1] similarity. */
export function similarityFromL2(distance: number): number {
  return 1 / (1 + distance);
}
