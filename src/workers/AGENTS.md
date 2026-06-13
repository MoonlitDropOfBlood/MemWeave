# src/workers/

**Consolidation pipeline. Runs in a `setInterval` from `server/scheduler.ts`.**

## OVERVIEW

The "sleep" cycle. Every 6h (and once on startup) it promotes short-term memories to long-term, evicts cold ones, discovers causal edges, and writes a `consolidation_runs` snapshot. Pure rule-based by default; can call out to the LLM provider for compression.

## WHERE TO LOOK

| File | Stage | What it does |
|---|---|---|
| `consolidator.ts` | orchestrator | `runConsolidation({ db, tenantId, now })` — runs the 4 stages below in order, returns a `ConsolidationRun` snapshot |
| `value-gate.ts` | 1. Filter | "Should this memory exist?" — drops low-strength, low-importance, rarely-accessed records |
| `embedder.ts` | 2. Vectorize | Ensures memories have embeddings (skips if `embedding.dimensions=0`) |
| `compressor.ts` | 3. Compress | LLM call (or noop) merges near-duplicates; writes back summary |
| `graph-worker.ts` | 4. Discover | Walks recent observations, extracts candidate edges via prompt, persists new ones |
| `association.ts` | helper | Co-occurrence scoring: how often do two memories show up in the same session/observation? |

## CONVENTIONS

- The pipeline is **idempotent within a run**: re-running on the same `now` produces the same output. (No re-promotion of already-long memories, no re-eviction of already-deleted ones.)
- Each stage is a pure function: `(db, tenantId, ctx) => StageResult`. Persist at the end, not per stage.
- The LLM is optional. `providers/llm/noop.ts` makes stages 3-4 a no-op (pure rule-based).
- Write the snapshot to `consolidation_runs` even if the run is empty — operators want to see "ran, did nothing".

## ANTI-PATTERNS

- **NEVER** mutate `memories` from the worker without going through `db/repositories/memory-repo.ts`.
- **NEVER** throw on a single bad memory; log and continue. One bad apple should not abort the run.
- **NEVER** run two consolidations concurrently for the same tenant. The scheduler is single-instance by design.
