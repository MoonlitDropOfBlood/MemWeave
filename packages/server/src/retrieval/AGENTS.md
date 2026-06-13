# src/retrieval/

**4-layer search engine + Reciprocal Rank Fusion. The brain of memory recall.**

## OVERVIEW

When a query lands, this directory runs four parallel-ish layers, then fuses results via RRF. The `searchMemories()` orchestrator lives in `search-engine.ts`; each layer is a single file.

## WHERE TO LOOK

| File | Layer | What it does |
|---|---|---|
| `bm25-search.ts` | 1. Keyword (BM25) | SQLite FTS5; always runs |
| `vector-search.ts` | 2. Vector (sqlite-vec) | Cosine similarity; **skipped** when `queryEmbedding` is not provided or `embedding.dimensions=0` |
| `graph-traversal.ts` | 3. Graph (BFS) | Depth-1 expansion from BM25/vector seeds; bidirectional edges |
| `causal-chain.ts` | 4. Causal | Walks `causes`/`enables` edges, length ≤ 3, from seeds |
| `fusion.ts` | (post) RRF | `score = Σ w_layer / (K + rank)`; default `K=60` |
| `search-engine.ts` | orchestrator | Runs layers, calls `fuseResults()`, applies tier/strength/scope/freshness weighting |

## CONVENTIONS

- Each layer takes `(db, tenantId, seeds, options)` and returns `RankedCandidate[]` (memoryId + score + source).
- `fusion.ts` is **the only place** where RRF math lives. Don't reinvent it.
- Layer limits default to: bm25=50, vector=50, graph=30, causal=30.
- Vector layer returns nothing when `queryEmbedding` is undefined; `bm25Only: true` skips layers 2-4 entirely.

## ANTI-PATTERNS

- **NEVER** call SQL directly here. Go through `db/repositories/*`.
- **NEVER** apply business logic (tier promotion, importance boost) outside the post-fusion step in `search-engine.ts`.
- **NEVER** re-rank with a learned model. RRF only — that's the project's design choice.

## NOTES

- The RRF K constant and per-layer weights are tunable via `SearchOptions` (`rrfK`, etc.).
- Seed propagation: layers 3-4 use BM25 + vector hits as seeds, not the original query.
