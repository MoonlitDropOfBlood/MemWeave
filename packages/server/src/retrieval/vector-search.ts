import type { Db } from '../db/database.js';
import { VECTOR_DEFAULT_DIMENSIONS } from '../db/database.js';
import { VECTOR_TABLE_NAME } from '../db/repositories/vector-repo.js';
import type { MemoryRecord, ScopeTag } from '../core/types.js';

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

interface VectorRow {
  memory_id: string;
  embedding: Buffer;
}

/**
 * Vector similarity search using brute-force L2 distance in pure JS.
 *
 * Replaces the previous sqlite-vec `MATCH ... k=?` KNN query. We migrated
 * off sqlite-vec because `node:sqlite` does not support `loadExtension`, so
 * the loadable vec0 module cannot be used. At memory-system scale (thousands
 * of 768-dim vectors), a single brute-force scan is sub-millisecond to a few
 * milliseconds — see the benchmark in `scripts/validate-node-sqlite.mjs`
 * (1k vectors ≈ 0.6ms, 10k ≈ 5ms on a typical CPU). No native vector
 * extension is needed.
 *
 * The query vector and stored vectors are compared by true L2 (Euclidean)
 * distance, matching the previous sqlite-vec ranking. Embeddings from
 * local-xenova are L2-normalized so cosine and L2 ranking coincide there,
 * but this layer does not assume normalization — it computes true L2.
 *
 * Returns the top-`limit` memories in the tenant whose stored embedding is
 * closest to `queryVector`, with similarity = 1 / (1 + L2_distance) for
 * downstream RRF fusion.
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

  // Verify the vectors table exists; if not, vector search returns empty.
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(VECTOR_TABLE_NAME) as { name: string } | undefined;
  if (!exists) return [];

  // Load all vectors for this tenant + dimension. At memory-system scale
  // (thousands of rows) this is a single indexed SELECT; the BLOBs are
  // deserialized into Float32Array views without copying.
  const vecRows = db
    .prepare(`SELECT memory_id, embedding FROM ${VECTOR_TABLE_NAME} WHERE tenant_id = ? AND dimensions = ?`)
    .all(tenantId, dimensions) as VectorRow[];

  if (vecRows.length === 0) return [];

  const query = new Float32Array(queryVector);
  const k = Math.min(limit, vecRows.length);

  // Brute-force L2 distance (squared — the square root is taken only on the
  // final top-k, not per candidate). This matches the previous sqlite-vec
  // behavior (which ranked by raw L2). We do NOT assume the vectors are
  // L2-normalized: embeddings from local-xenova ARE normalized, but stored
  // vectors may not be (and the old layer ranked by true L2 regardless).
  // similarity = 1 / (1 + L2) is applied downstream for RRF fusion.
  const top: Array<{ memoryId: string; distSq: number }> = [];

  for (const row of vecRows) {
    const v = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4
    );
    let sumSqDiff = 0;
    for (let d = 0; d < dimensions; d++) {
      const diff = v[d] - query[d];
      sumSqDiff += diff * diff;
    }
    const distSq = sumSqDiff;

    if (top.length < k) {
      top.push({ memoryId: row.memory_id, distSq });
      // Keep ascending by distance (smallest = best first).
      top.sort((a, b) => a.distSq - b.distSq);
    } else if (distSq < top[top.length - 1].distSq) {
      // Replace the worst.
      top[top.length - 1] = { memoryId: row.memory_id, distSq };
      top.sort((a, b) => a.distSq - b.distSq);
    }
  }

  if (top.length === 0) return [];

  // Fetch the full memory rows for the top-k memory ids (one IN-list query).
  const ids = top.map((t) => t.memoryId);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, tenant_id, tier, type, title, content, summary,
      concepts_json, files_json, importance, confidence, strength,
      source, scope_level, source_client, source_device_id,
      source_session_id, tau, access_count, last_accessed_at,
      last_reinforced_at, last_decay_at, reinforcement_score,
      promoted_at, created_at, updated_at, deleted_at, eviction_reason
    FROM memories
    WHERE id IN (${placeholders}) AND tenant_id = ? AND deleted_at IS NULL
  `).all(...ids, tenantId) as MemoryRow[];

  // Batch-load scopes for the returned memories (mirrors bm25-search.ts).
  const scopeMap = new Map<string, ScopeTag[]>();
  if (rows.length > 0) {
    const memIds = rows.map((r) => r.id);
    const scopeRows = db.prepare(`
      SELECT memory_id, key, value FROM memory_scopes
      WHERE tenant_id = ? AND memory_id IN (${placeholders})
      ORDER BY key, value
    `).all(tenantId, ...memIds) as Array<{ memory_id: string; key: string; value: string }>;
    for (const sr of scopeRows) {
      if (!scopeMap.has(sr.memory_id)) scopeMap.set(sr.memory_id, []);
      scopeMap.get(sr.memory_id)!.push({ key: sr.key, value: sr.value } as ScopeTag);
    }
  }

  // Build a distSq lookup so we can attach distance to each memory in the
  // order the SQL returned them (not necessarily distance order).
  const distSqById = new Map<string, number>();
  for (const t of top) distSqById.set(t.memoryId, t.distSq);

  // Sort the fetched rows by distance ascending (best first), drop any id
  // that had no surviving memory row (e.g. soft-deleted between the two queries).
  const results: VectorSearchResult[] = [];
  for (const t of top) {
    const row = rows.find((r) => r.id === t.memoryId);
    if (!row) continue;
    const distance = Math.sqrt(t.distSq);
    results.push({
      memory: rowToMemory(row, scopeMap.get(row.id) ?? []),
      distance,
      similarity: similarityFromL2(distance)
    });
  }

  return results;
}

function rowToMemory(row: MemoryRow, scopes: ScopeTag[]): MemoryRecord {
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

/** L2 distance → [0, 1] similarity. */
export function similarityFromL2(distance: number): number {
  return 1 / (1 + distance);
}
