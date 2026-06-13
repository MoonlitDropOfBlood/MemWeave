import type { Db } from '../db/database.js';
import type { MemoryRecord, ScopeKey, MemoryType } from '../core/types.js';
import { bm25Search, type SearchResultRow } from './bm25-search.js';
import { vectorSearch, type VectorSearchResult } from './vector-search.js';
import { graphExpand, type GraphCandidate } from './graph-traversal.js';
import { detectCausalChains, type CausalChainCandidate } from './causal-chain.js';
import { fuseResults, type FusedResult, type SearchSource, type RankedCandidate } from './fusion.js';

export interface SearchOptions {
  query: string;
  /** Optional query embedding (for the vector layer). When omitted, vector layer is skipped. */
  queryEmbedding?: number[];
  limit?: number;
  scope?: Partial<Record<ScopeKey, string>>;
  types?: MemoryType[];
  /** When true, vector/graph/causal layers are skipped (BM25-only). */
  bm25Only?: boolean;
  /** Per-layer limits (defaults: bm25=50, vector=50, graph=30, causal=30). */
  bm25Limit?: number;
  vectorLimit?: number;
  graphLimit?: number;
  causalLimit?: number;
  /** RRF K constant (default: 60). */
  rrfK?: number;
  /** Min similarity for vector results (default: 0). */
  vectorMinSimilarity?: number;
  /** Vector dimensions (default: 768). */
  vectorDimensions?: number;
}

export interface SearchResponse {
  query: string;
  results: FusedResult[];
  totalCandidates: number;
  layerStats: {
    bm25: number;
    vector: number;
    graph: number;
    causal: number;
  };
}

/**
 * Multi-layer search (design spec §4.13):
 *
 *   1. BM25 keyword recall (FTS5)
 *   2. Vector recall (sqlite-vec; skipped when `queryEmbedding` is not provided)
 *   3. Graph expansion (BFS from BM25/vector seeds, depth 1)
 *   4. Causal chain detection (from BM25/vector seeds, length ≤ 3)
 *   5. RRF fusion of all 4 streams
 *   6. Tier / strength / scope / freshness weighting
 *   7. Return top-K
 *
 * When `bm25Only` is true, layers 2-4 are skipped.
 */
export async function searchMemories(db: Db, tenantId: string, options: SearchOptions): Promise<SearchResponse> {
  const limit = options.limit ?? 8;
  const query = options.query.trim();
  const bm25Only = options.bm25Only ?? false;
  const rrfK = options.rrfK ?? 60;
  const bm25Limit = options.bm25Limit ?? 50;
  const vectorLimit = options.vectorLimit ?? 50;
  const graphLimit = options.graphLimit ?? 30;
  const causalLimit = options.causalLimit ?? 30;
  const vectorMinSimilarity = options.vectorMinSimilarity ?? 0;
  const vectorDimensions = options.vectorDimensions ?? 768;

  const layerStats = { bm25: 0, vector: 0, graph: 0, causal: 0 };

  if (!query && !options.queryEmbedding) {
    return { query, results: [], totalCandidates: 0, layerStats };
  }

  // --- Layer 1: BM25 ---
  let bm25Rows: SearchResultRow[] = query ? bm25Search(db, tenantId, query, bm25Limit) : [];
  layerStats.bm25 = bm25Rows.length;

  if (options.scope || options.types) {
    bm25Rows = bm25Rows.filter((row) => {
      if (options.scope && !matchesScope(row.memory, options.scope)) return false;
      if (options.types && !options.types.includes(row.memory.type)) return false;
      return true;
    });
  }

  // --- Layer 2: Vector (optional) ---
  let vectorRows: VectorSearchResult[] = [];
  if (!bm25Only && options.queryEmbedding && options.queryEmbedding.length === vectorDimensions) {
    vectorRows = vectorSearch(db, tenantId, options.queryEmbedding, vectorLimit, vectorDimensions)
      .filter((r) => r.similarity >= vectorMinSimilarity);
    layerStats.vector = vectorRows.length;
    if (options.scope || options.types) {
      vectorRows = vectorRows.filter((row) => {
        if (options.scope && !matchesScope(row.memory, options.scope)) return false;
        if (options.types && !options.types.includes(row.memory.type)) return false;
        return true;
      });
    }
  }

  // Build streams
  const streams: RankedCandidate[][] = [];

  if (bm25Rows.length > 0) {
    streams.push(
      bm25Rows.map((r, idx) => ({
        candidate: { memory: r.memory, sources: new Set<SearchSource>(['bm25']) },
        rank: idx,
        source: 'bm25' as const
      }))
    );
  }

  if (vectorRows.length > 0) {
    streams.push(
      vectorRows.map((r, idx) => ({
        candidate: { memory: r.memory, sources: new Set<SearchSource>(['vector']) },
        rank: idx,
        source: 'vector' as const
      }))
    );
  }

  // --- Layer 3: Graph expansion ---
  if (!bm25Only) {
    const seeds = [...bm25Rows, ...vectorRows].slice(0, 5).map((r) => r.memory.id);
    const allGraph: GraphCandidate[] = [];
    for (const seed of seeds) {
      const out = graphExpand(db, { startMemoryId: seed, tenantId, depth: 1, maxNodes: graphLimit });
      for (const c of out) {
        if (options.scope && !matchesScope(c.memory, options.scope)) continue;
        if (options.types && !options.types.includes(c.memory.type)) continue;
        allGraph.push(c);
      }
    }
    layerStats.graph = allGraph.length;
    if (allGraph.length > 0) {
      streams.push(
        allGraph.map((c, idx) => ({
          candidate: { memory: c.memory, sources: new Set<SearchSource>(['graph']) },
          rank: idx,
          source: 'graph' as const
        }))
      );
    }
  }

  // --- Layer 4: Causal chains ---
  if (!bm25Only) {
    const seeds = [...bm25Rows, ...vectorRows].slice(0, 5).map((r) => r.memory.id);
    const allCausal: CausalChainCandidate[] = [];
    for (const seed of seeds) {
      const out = detectCausalChains(db, { seedMemoryIds: [seed], tenantId, maxLength: 3, maxChains: causalLimit });
      for (const chain of out) {
        for (const m of chain.memories) {
          if (m.id === seed) continue;
          if (options.scope && !matchesScope(m, options.scope)) continue;
          if (options.types && !options.types.includes(m.type)) continue;
          allCausal.push(chain);
          break;
        }
      }
    }
    layerStats.causal = allCausal.length;
    if (allCausal.length > 0) {
      streams.push(
        allCausal.map((c, idx) => {
          const m = c.memories[0];
          return {
            candidate: { memory: m, sources: new Set<SearchSource>(['causal']) },
            rank: idx,
            source: 'causal' as const
          };
        })
      );
    }
  }

  // --- RRF fusion ---
  const fused = fuseResults(streams, rrfK);

  return {
    query,
    results: fused.slice(0, limit),
    totalCandidates: streams.reduce((s, x) => s + x.length, 0),
    layerStats
  };
}

function matchesScope(memory: MemoryRecord, scope: Partial<Record<ScopeKey, string>>): boolean {
  for (const [key, value] of Object.entries(scope)) {
    if (!value) continue;
    const found = memory.scopes.some((s) => s.key === key && s.value === value);
    if (!found) return false;
  }
  return true;
}
