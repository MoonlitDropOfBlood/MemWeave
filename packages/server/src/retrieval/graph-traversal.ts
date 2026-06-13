import type { Db } from '../db/database.js';
import type { MemoryRecord, EdgeType } from '../core/types.js';

export interface GraphExpansionOptions {
  /** Starting memory id. */
  startMemoryId: string;
  /** Tenant id. */
  tenantId: string;
  /** Max BFS depth (1 = direct neighbors only). Default: 1. */
  depth?: number;
  /** Edge types to follow. Default: most semantic edge types. */
  edgeTypes?: EdgeType[];
  /** Direction. Default: 'both'. */
  direction?: 'in' | 'out' | 'both';
  /** Max nodes to return. Default: 30. */
  maxNodes?: number;
}

export interface GraphCandidate {
  memory: MemoryRecord;
  /** How far this memory is from the start (1 = direct neighbor). */
  distance: number;
  /** The path of edge ids from start to this memory. */
  edgePath: string[];
  /** The path of memory ids from start to this memory. */
  memoryPath: string[];
  /** The strength of the weakest edge in the path. */
  pathStrength: number;
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

const DEFAULT_EDGE_TYPES: EdgeType[] = [
  'causes', 'enables', 'supersedes', 'references', 'refines', 'contradicts'
];

/**
 * Graph expansion: starting from `startMemoryId`, BFS outward through edges
 * of the specified types and return the discovered memory nodes ranked by
 * their `distance` from the start. Implements design spec §4.4.
 *
 * Notes:
 * - The starting memory itself is NOT returned (only its neighbors).
 * - `related_to` and `duplicates` are NOT followed by default (too noisy).
 * - `before`/`after` are deferred to the causal-chain layer.
 */
export function graphExpand(
  db: Db,
  options: GraphExpansionOptions
): GraphCandidate[] {
  const depth = Math.max(1, Math.min(3, options.depth ?? 1));
  const maxNodes = options.maxNodes ?? 30;
  const edgeTypes = options.edgeTypes ?? DEFAULT_EDGE_TYPES;
  const direction = options.direction ?? 'both';

  const visited = new Set<string>([options.startMemoryId]);
  const allDiscovered: Frontier[] = [];

  interface Frontier {
    memoryId: string;
    distance: number;
    edgePath: string[];
    memoryPath: string[];
    pathStrength: number;
  }
  let frontier: Frontier[] = [{
    memoryId: options.startMemoryId,
    distance: 0,
    edgePath: [],
    memoryPath: [options.startMemoryId],
    pathStrength: 1
  }];

  for (let d = 1; d <= depth; d++) {
    const nextFrontier: Frontier[] = [];
    for (const node of frontier) {
      // Pull outgoing edges
      if (direction === 'out' || direction === 'both') {
        const outRows = db.prepare(`
          SELECT id, to_memory_id, strength
          FROM edges
          WHERE tenant_id = ? AND from_memory_id = ? AND type IN (${edgeTypes.map(() => '?').join(',')})
        `).all(options.tenantId, node.memoryId, ...edgeTypes) as Array<{ id: string; to_memory_id: string; strength: number }>;
        for (const r of outRows) {
          if (visited.has(r.to_memory_id)) continue;
          visited.add(r.to_memory_id);
          nextFrontier.push({
            memoryId: r.to_memory_id,
            distance: d,
            edgePath: [...node.edgePath, r.id],
            memoryPath: [...node.memoryPath, r.to_memory_id],
            pathStrength: Math.min(node.pathStrength, r.strength)
          });
        }
      }
      // Pull incoming edges
      if (direction === 'in' || direction === 'both') {
        const inRows = db.prepare(`
          SELECT id, from_memory_id, strength
          FROM edges
          WHERE tenant_id = ? AND to_memory_id = ? AND type IN (${edgeTypes.map(() => '?').join(',')})
        `).all(options.tenantId, node.memoryId, ...edgeTypes) as Array<{ id: string; from_memory_id: string; strength: number }>;
        for (const r of inRows) {
          if (visited.has(r.from_memory_id)) continue;
          visited.add(r.from_memory_id);
          nextFrontier.push({
            memoryId: r.from_memory_id,
            distance: d,
            edgePath: [...node.edgePath, r.id],
            memoryPath: [...node.memoryPath, r.from_memory_id],
            pathStrength: Math.min(node.pathStrength, r.strength)
          });
        }
      }
    }
    frontier = nextFrontier;
    // Accumulate every discovered node, not just the final frontier.
    for (const node of nextFrontier) allDiscovered.push(node);
    if (allDiscovered.length >= maxNodes) break;
  }

  // Collect all discovered nodes
  const visitedIds: string[] = [];
  for (const node of allDiscovered) visitedIds.push(node.memoryId);
  if (visitedIds.length > maxNodes) visitedIds.length = maxNodes;

  // Hydrate memory records
  if (visitedIds.length === 0) return [];
  const placeholders = visitedIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE tenant_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL
  `).all(options.tenantId, ...visitedIds) as MemoryRow[];

  const byId = new Map<string, MemoryRecord>();
  for (const row of rows) byId.set(row.id, rowToMemory(row));

  return allDiscovered
    .slice(0, maxNodes)
    .map((node) => {
      const memory = byId.get(node.memoryId);
      return memory
        ? {
            memory,
            distance: node.distance,
            edgePath: node.edgePath,
            memoryPath: node.memoryPath,
            pathStrength: node.pathStrength
          }
        : null;
    })
    .filter((c): c is GraphCandidate => c !== null);
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
