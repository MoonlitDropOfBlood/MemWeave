# src/plugin/

**OpenCode plugin. Auto-injects memory into the LLM's system prompt.**

## OVERVIEW

`MemweaveInjectPlugin` is registered in `~/.config/opencode/opencode.json` and runs **inside OpenCode's hook context**, not the server process. It calls the server's `/api/v1/injection/preview` endpoint to get a `contextXml` block and appends it to the LLM's system prompt.

## STRUCTURE

```
src/plugin/
├── index.ts          # `MemweaveInjectPlugin` — the @opencode-ai/plugin export
├── injector.ts       # Phase dispatcher (session_start / prompt_delta / file_pack)
└── client.ts         # `MemweaveClient` — POST to MEMWEAVE_URL
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `MemweaveInjectPlugin` | `index.ts` | The default export; OpenCode calls it with `{ app, $ }` |
| `phaseFor(event)` | `injector.ts` | `session_start` | `prompt_delta` | `file_pack` |
| `MEMWEAVE_URL` | env | Server base URL (default `http://127.0.0.1:3131`) |
| `MEMWEAVE_PLUGIN_TIMEOUT` | hardcoded | 10s per injection request |

## CONVENTIONS

- **Fail-silent**: every network call is wrapped in try/catch. A MemWeave outage must not break OpenCode.
- Three injection phases:
  1. `session_start` — hooked on `experimental.chat.system.transform`; bundles all relevant memories for the session.
  2. `prompt_delta` — after each new prompt; only appends *new* memories (avoids duplication).
  3. `file_pack` — hooked on `tool.execute.before` for `Read`/`Edit`/`Write`/`Glob`/`Grep`; extracts file paths and queries file-scoped memories.
- Sort order on the wire: `tier` (long > medium > short) → `strength × importance`. Server-side (`injection/bundler.ts`) enforces token budget.

## ANTI-PATTERNS

- **NEVER** import from `src/server/`, `src/db/`, or `src/retrieval/` here. Plugin is a separate process.
- **NEVER** rethrow a network error. The whole point of the plugin is to be a soft dependency.
- **NEVER** run this file with `tsx` outside OpenCode's plugin context. It expects `@opencode-ai/plugin`'s hook shapes.
