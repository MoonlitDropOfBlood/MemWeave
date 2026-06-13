# src/prompts/

**LLM prompt templates. Compression, edge extraction, value-gate.**

## OVERVIEW

Static string templates consumed by `src/workers/` and `src/providers/llm/`. Each file exports one or more named prompt strings, parameterized by an `interpolate(vars)` helper that does safe `{varName}` substitution.

## WHERE TO LOOK

| File | Used by | Purpose |
|---|---|---|
| `compression.ts` | `workers/compressor.ts` | "Merge these N memories into one summary" |
| `edge-extract.ts` | `workers/graph-worker.ts` | "Given observation X, what edges does it imply?" |
| `value-gate.ts` | `workers/value-gate.ts` | "Should this memory be kept? Score 0-1." |

## CONVENTIONS

- **Templates are pure strings + a tiny `interpolate()` helper**. No templating engine.
- Variables use `{camelCase}` placeholders. Unknown placeholders throw — fail fast, don't silently drop.
- Keep prompts **short and opinionated**. The LLM provider's context window is not infinite.
- Each file exports `export const X_PROMPT: Prompt` where `Prompt = { system, user, interpolate(vars): { system, user } }`.

## ANTI-PATTERNS

- **NEVER** call an LLM from this directory. Prompts are inert; the LLM lives in `providers/llm/`.
- **NEVER** concatenate user input into the system prompt. Always use `interpolate()`.
- **NEVER** commit a prompt that hasn't been tested against the `noop` provider's noop output (i.e., the rule-based path).
