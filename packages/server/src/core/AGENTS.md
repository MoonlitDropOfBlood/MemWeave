# src/core/

**Shared types, config loader, and decay model. No I/O, no Fastify.**

## OVERVIEW

The contract layer. Every enum (`MemoryType`, `MemoryTier`, `EdgeType`, `ScopeKey`, `ScopeLevel`, `MemorySource`, `SourceClient`) is a Zod schema in `types.ts`; the rest of the codebase infers TypeScript types via `z.infer<>`. `config.ts` reads `memweave.config.jsonc` and exposes `loadConfig()`; `decay.ts` models memory strength over time.

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `MemoryTypeSchema` / `MemoryType` | `types.ts` | 9-value enum: fact, decision, preference, event, project_context, lesson, code_pattern, bug, workflow |
| `MemoryTierSchema` / `MemoryTier` | `types.ts` | short / medium / long |
| `EdgeTypeSchema` / `EdgeType` | `types.ts` | 10 edge kinds (causal, temporal, entity) |
| `ScopeTagSchema` | `types.ts` | `{ key: ScopeKey, value: string }` |
| `loadConfig()` | `config.ts` | Reads JSONC; honors `MEMWEAVE_CONFIG` env override; `expandPath()` resolves `~/` |
| `computeDecay()` | `decay.ts` | strength(t) = base × exp(-t/τ) × reinforcement modifier |

## CONVENTIONS

- **Zod-first**: a new enum = `z.enum([...])` + `type X = z.infer<typeof XSchema>`. Never `as const` arrays.
- **No I/O** in this directory. Pure types + pure functions.
- `expandPath()` is the only way to resolve user paths; do not call `path.resolve` directly against config values.

## ANTI-PATTERNS

- **NEVER** widen an enum by adding a value without checking that it round-trips through DB, REST, MCP, and plugin.
- **NEVER** read the filesystem here — config loading is the only exception, and it lives in `config.ts`.
- **NEVER** duplicate an enum literal. Always import from `types.ts`.
