# src/workers/

**Consolidation pipeline. Runs in a `setInterval` from `server/scheduler.ts`.**

## OVERVIEW

The "sleep" cycle. Every 6h (and once on startup) it (1) evicts cold short-term memories, (2) promotes accessed/important ones to medium, (3) **merges near-duplicate memory pairs using the same Jaccard-on-concepts logic as the live write-side dedup gate** in `MemoryRepo.create`, and (4) writes a `consolidation_runs` snapshot. Pure rule-based by default.

**Important**: the consolidation pipeline's *only* near-duplicate detection mechanism is the Jaccard merge stage inside `consolidator.ts` (the live dedup gate is a separate, real-time check at write time). The two are consistent — same threshold (0.8), same Jaccard formula.

## WHERE TO LOOK

| File | Stage | What it does |
|---|---|---|
| `consolidator.ts` | orchestrator | `runConsolidation(db, tenantId, { dryRun })` — runs evict + promote + **merge** in order, returns a `ConsolidationResult`. **Process-wide mutex** via `isConsolidationRunning()` prevents concurrent runs |
| `value-gate.ts` | (separate, unused by runConsolidation) | "Should this memory exist?" — pure rule-based filter, not yet wired into the main pipeline |
| `embedder.ts` | (separate, unused by runConsolidation) | Background worker that ensures memories have embeddings (no-op when `embedding.dimensions=0`) |
| `compressor.ts` | (separate, **NOT dedup**) | Compresses a single `CompressInput` observation into a `MemoryCandidate` via LLM prompt. **Does NOT merge memories** — that was a misleading comment from an earlier draft. The real merge is in `consolidator.ts` |
| `graph-worker.ts` | (separate, unused by runConsolidation) | Background worker that walks observations to extract candidate edges via LLM prompt |
| `association.ts` | helper | Co-occurrence scoring: how often do two memories show up in the same session/observation? |

## CONVENTIONS

- The pipeline is **idempotent within a run**: re-running on the same `now` produces the same output. (No re-promotion of already-long memories, no re-eviction of already-deleted ones.)
- **Process-wide mutex** (line 32 of `consolidator.ts`): `consolidationInFlight` boolean blocks concurrent runs. If a second call arrives during a run, the function returns immediately with `summary: 'Skipped: another consolidation is already running.'`
- Each stage is a pure function: `(db, tenantId, ctx) => StageResult`. Persist at the end, not per stage.
- The LLM is optional. `providers/llm/noop.ts` makes stages 3-4 a no-op (pure rule-based).
- Write the snapshot to `consolidation_runs` even if the run is empty — operators want to see "ran, did nothing".

## ANTI-PATTERNS

- **NEVER** mutate `memories` from the worker without going through `db/repositories/memory-repo.ts`.
- **NEVER** throw on a single bad memory; log and continue. One bad apple should not abort the run.
- **NEVER** run two consolidations concurrently for the same tenant. The `consolidationInFlight` mutex in `consolidator.ts` enforces this; if you add a new caller (CLI command, another route, etc.) it gets the protection for free.
