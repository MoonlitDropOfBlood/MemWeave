# src/injection/

**Token-budgeted XML packager. The server-side counterpart to the OpenCode plugin.**

## OVERVIEW

`buildBundle()` is called by the `/api/v1/injection/preview` endpoint and by `src/plugin/injector.ts`. It runs `searchMemories()`, sorts by tier → strength × importance, and trims to a token budget. The output is a `<memory-context>` XML block that the LLM parses.

## WHERE TO LOOK

| File | Role |
|---|---|
| `bundler.ts` | `buildBundle({ db, tenantId, query, tokenBudget, phase })` — the only entry point |
| `formatter.ts` | XML escaping + `<memory>` element serialization |

## CONVENTIONS

- Three phases share this module: `session_start`, `prompt_delta`, `file_pack`. Phase affects query shape, not the bundler math.
- Token budget is **enforced** — never exceed it. The plugin on the other side trusts the budget.
- Sort: `tier` (long > medium > short) → `strength × importance` desc.
- Output is always XML wrapped in `<memory-context phase="..." count="N">`. The plugin appends this verbatim to the system prompt.

## ANTI-PATTERNS

- **NEVER** return raw JSON here. The contract with the plugin is XML.
- **NEVER** skip the token budget — a runaway bundle will blow the LLM's context window.
- **NEVER** import from `src/plugin/`. The bundler runs server-side; the plugin is a separate process.
