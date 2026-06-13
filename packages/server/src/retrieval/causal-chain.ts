import type { Db } from '../db/database.js';
import type { MemoryRecord, EdgeType } from '../core/types.js';

export interface CausalChainOptions {
  /** Seed memory ids (the starting points of causal exploration). */
  seedMemoryIds: string[];
  /** Tenant id. */
  tenantId: string;
  /** Max chain length (number of edges). Default: 5. */
  maxLength?: number;
  /** Max chains to return. Default: 10. */
  maxChains?: number;
  /** Edge types considered causal. Default: causes/before/after/refines/supersedes. */
  edgeTypes?: EdgeType[];
  /** When true, include both directions. Default: true. */
  bidirectional?: boolean;
}

export interface CausalChainCandidate {
  /** The full chain of memory ids, in chronological order (root cause → leaf). */
  memoryIds: string[];
  /** The full chain of edge ids, in order. */
  edgeIds: string[];
  /** The hydrated memories, in chain order. */
  memories: MemoryRecord[];
  /** Score: average(memory.strength) * average(edge.strength) * chainCompleteness. */
  chainScore: number;
  /** 0..1 — the fraction of the chain edges that hit a 'causes' / 'refines' relation. */
  completeness: number;
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

const CAUSAL_EDGE_TYPES: EdgeType[] = ['causes', 'before', 'after', 'refines', 'supersedes'];
const STRONG_CAUSAL: EdgeType[] = ['causes', 'refines'];

/**
 * Causal-chain detection (design spec §4.6).
 *
 * Starting from a set of seed memories, walk along causal edges in both
 * directions to extract linear chains. Each chain is scored by:
 *
 *   chainScore = average(memory.strength)
 *              * average(edge.strength)
 *              * completeness
 *
 * where `completeness` is the fraction of edges in the chain that are
 * strong causal relations ('causes' or 'refines') — chains dominated by
 * 'before'/'after' temporal links score lower.
 *
 * The implementation is bounded: each chain explores at most `maxLength` edges
 * and we return at most `maxChains` chains total (ranked by chainScore).
 */
export function detectCausalChains(db: Db, options: CausalChainOptions): CausalChainCandidate[] {
  const maxLength = Math.max(1, Math.min(10, options.maxLength ?? 5));
  const maxChains = Math.max(1, options.maxChains ?? 10);
  const edgeTypes = options.edgeTypes ?? CAUSAL_EDGE_TYPES;
  const bidirectional = options.bidirectional ?? true;

  const allChains: CausalChainCandidate[] = [];
  for (const seedId of options.seedMemoryIds) {
    if (allChains.length >= maxChains) break;
    // Forward chain: from seed outward via outgoing edges
    const forward = walkChain(db, options.tenantId, seedId, 'out', edgeTypes, maxLength);
    for (const c of forward) {
      allChains.push(c);
      if (allChains.length >= maxChains) break;
    }
    // Backward chain: from seed via incoming edges
    if (bidirectional) {
      const backward = walkChain(db, options.tenantId, seedId, 'in', edgeTypes, maxLength);
      for (const c of backward) {
        allChains.push(c);
        if (allChains.length >= maxChains) break;
      }
    }
  }

  // Rank by chain score, descending
  allChains.sort((a, b) => b.chainScore - a.chainScore);
  return allChains.slice(0, maxChains);
}

interface WalkStep {
  memoryId: string;
  edgeId: string | null; // null for the seed
}

function walkChain(
  db: Db,
  tenantId: string,
  seedId: string,
  direction: 'in' | 'out',
  edgeTypes: EdgeType[],
  maxLength: number
): CausalChainCandidate[] {
  // Greedy chain extension: at each step, pick the highest-strength edge
  // to extend the chain. Returns one chain per "branch" up to maxLength.
  const chains: WalkStep[][] = [[] as WalkStep[]];

  // The seed starts every chain
  for (const c of chains) c.push({ memoryId: seedId, edgeId: null });

  for (let step = 1; step <= maxLength; step++) {
    const newChains: WalkStep[][] = [];
    for (const chain of chains) {
      const last = chain[chain.length - 1];
      const nextEdges = pullNextCausalEdges(db, tenantId, last.memoryId, direction, edgeTypes);
      if (nextEdges.length === 0) {
        // Dead end — keep this chain as-is
        newChains.push([...chain]);
        continue;
      }
      for (const e of nextEdges) {
        if (chain.some((s) => s.memoryId === e.toMemoryId)) continue; // avoid cycles
        newChains.push([...chain, { memoryId: e.toMemoryId, edgeId: e.id }]);
      }
    }
    chains.length = 0;
    chains.push(...newChains);
  }

  // Hydrate and score each chain
  const allIds = new Set<string>();
  for (const c of chains) for (const s of c) allIds.add(s.memoryId);
  if (allIds.size === 0) return [];

  const placeholders = [...allIds].map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE tenant_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL
  `).all(tenantId, ...allIds) as MemoryRow[];

  const byId = new Map<string, MemoryRecord>();
  for (const row of rows) byId.set(row.id, rowToMemory(row));

  const edgeIdSet = new Set<string>();
  for (const c of chains) for (const s of c) if (s.edgeId) edgeIdSet.add(s.edgeId);
  const edgeStrengthById = new Map<string, { strength: number; type: EdgeType }>();
  if (edgeIdSet.size > 0) {
    const edgePlaceholders = [...edgeIdSet].map(() => '?').join(',');
    const edgeRows = db.prepare(`
      SELECT id, strength, type FROM edges
      WHERE id IN (${edgePlaceholders})
    `).all(...edgeIdSet) as Array<{ id: string; strength: number; type: EdgeType }>;
    for (const r of edgeRows) edgeStrengthById.set(r.id, { strength: r.strength, type: r.type });
  }

  const candidates: CausalChainCandidate[] = [];
  for (const chain of chains) {
    if (chain.length < 2) continue; // need at least one edge
    const memories: MemoryRecord[] = [];
    for (const s of chain) {
      const m = byId.get(s.memoryId);
      if (m) memories.push(m);
    }
    if (memories.length !== chain.length) continue; // hydration failed for some node

    let edgeStrengthSum = 0;
    let edgeCount = 0;
    let strongCausalCount = 0;
    const edgeIds: string[] = [];
    for (const s of chain) {
      if (s.edgeId) {
        const e = edgeStrengthById.get(s.edgeId);
        if (e) {
          edgeStrengthSum += e.strength;
          edgeCount++;
          if (STRONG_CAUSAL.includes(e.type)) strongCausalCount++;
          edgeIds.push(s.edgeId);
        }
      }
    }
    const avgEdgeStrength = edgeCount > 0 ? edgeStrengthSum / edgeCount : 1;
    const avgMemStrength = memories.reduce((s, m) => s + m.strength, 0) / memories.length;
    const completeness = edgeCount > 0 ? strongCausalCount / edgeCount : 0;
    const chainScore = avgMemStrength * avgEdgeStrength * completeness;

    candidates.push({
      memoryIds: chain.map((s) => s.memoryId),
      edgeIds,
      memories,
      chainScore,
      completeness
    });
  }

  return candidates;
}

interface EdgeRow {
  id: string;
  to_memory_id: string;
  strength: number;
  type: EdgeType;
}

function pullNextCausalEdges(
  db: Db,
  tenantId: string,
  fromMemoryId: string,
  direction: 'in' | 'out',
  edgeTypes: EdgeType[]
): Array<{ id: string; toMemoryId: string; strength: number; type: EdgeType }> {
  const placeholders = edgeTypes.map(() => '?').join(',');
  const sql = direction === 'out'
    ? `SELECT id, to_memory_id, strength, type FROM edges
       WHERE tenant_id = ? AND from_memory_id = ? AND type IN (${placeholders})
       ORDER BY strength DESC LIMIT 5`
    : `SELECT id, from_memory_id AS to_memory_id, strength, type FROM edges
       WHERE tenant_id = ? AND to_memory_id = ? AND type IN (${placeholders})
       ORDER BY strength DESC LIMIT 5`;
  const rows = db.prepare(sql).all(tenantId, fromMemoryId, ...edgeTypes) as Array<{
    id: string; to_memory_id: string; strength: number; type: EdgeType;
  }>;
  return rows.map((r) => ({
    id: r.id,
    toMemoryId: r.to_memory_id,
    strength: r.strength,
    type: r.type
  }));
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
