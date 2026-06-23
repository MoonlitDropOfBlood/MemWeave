# packages/codex-plugin/

**MemWeave plugin for OpenAI Codex. Pure-config directory-style plugin (no build step). Closes the read loop (auto-injection of summary-only XML on `UserPromptSubmit` and on file-touching tool calls) and the write loop (auto-upsert of every chat message back to the MemWeave server on `UserPromptSubmit` + `Stop`).**

## OVERVIEW

The plugin is a CC marketplace plugin installed via Codex's plugin
CLI. It exposes three CC-style hooks (`UserPromptSubmit`,
`PreToolUse`, `Stop`) and a `.mcp.json` that auto-registers the
`memweave` MCP server pointing at the local MemWeave server.

| Hook | What it does |
|---|---|
| `UserPromptSubmit` | Captures the user prompt as a `chat.user` observation; upserts the session row; fetches a `prompt_delta` memory pack and emits it as `hookSpecificOutput.additionalContext` so the LLM sees the relevant memories before responding. |
| `PreToolUse` (file tools only) | On `Read` / `Edit` / `Write` / `Glob` / `Grep`, fetches a `file_pack` memory pack for the file paths in `tool_input` and emits it as `hookSpecificOutput.additionalContext`. |
| `Stop` | Captures `last_assistant_message` as a `chat.assistant` observation; upserts the session row. |

The plugin does NOT spawn child processes. Each hook is a
cross-platform Node script invoked in-process by Codex's plugin
loader. All network communication is HTTP to the local MemWeave
server (`http://127.0.0.1:3131` by default).

## MCP REGISTRATION (automatic)

Unlike the OpenCode plugin, the codex plugin does NOT require the
user to hand-edit any config. Codex's CC marketplace loader reads
`.mcp.json` from the plugin directory at install time and registers
the `memweave` MCP server automatically.

## STRUCTURE

```
packages/codex-plugin/
├── .codex-plugin/
│   └── plugin.json            # Plugin manifest (CC marketplace format)
├── .mcp.json                  # Registers 10 memory_* tools via HTTP transport
├── hooks/
│   ├── hooks.json             # UserPromptSubmit / PreToolUse / Stop bindings
│   ├── _lib.mjs               # Shared HTTP client + helpers
│   ├── prompt-inject.mjs      # UserPromptSubmit -> inject prompt_delta
│   ├── prompt-inject.sh / .cmd
│   ├── file-pack.mjs          # PreToolUse (file tools) -> inject file_pack
│   ├── file-pack.sh / .cmd
│   ├── stop.mjs               # Stop -> POST session + last assistant message
│   └── stop.sh / .cmd
├── fixtures/                  # Synthetic stdin for `npm run test:hook`
├── package.json               # Private, scripts: test:prompt-inject / file-pack / writeback
├── README.md
└── AGENTS.md                  # ← you are here
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `SERVER_URL` / `TENANT` | `hooks/_lib.mjs` | `MEMWEAVE_SERVER_URL` (default `http://127.0.0.1:3131`) + `MEMWEAVE_TENANT` (default `tenant_default`) |
| `readStdin()` / `parseEvent()` | `hooks/_lib.mjs` | Read JSON from stdin, parse safely |
| `deriveSessionId(event)` | `hooks/_lib.mjs` | Read `session_id` / fallback hash of cwd |
| `deriveScopes(event)` | `hooks/_lib.mjs` | Read `cwd` from event, build `[{ key: 'project', value: cwd }]` |
| `requestInjection({...})` | `hooks/_lib.mjs` | POST `/api/v1/inject` (4 phases) |
| `reportSession({...})` | `hooks/_lib.mjs` | POST `/api/v1/sessions` (idempotent on `sessionId`) |
| `reportObservation({...})` | `hooks/_lib.mjs` | POST `/api/v1/observations` (idempotent on `(sessionId, messageId)`) |
| `makeMessageId(sessionId, role, content)` | `hooks/_lib.mjs` | Deterministic messageId from content hash |
| `extractFilePaths(toolInput)` | `hooks/_lib.mjs` | Pull file paths from `tool_input` |
| `emitHookOutput(obj)` | `hooks/_lib.mjs` | Write hook response JSON line to stdout |
| `prompt-inject.mjs` | `hooks/prompt-inject.mjs` | UserPromptSubmit handler |
| `file-pack.mjs` | `hooks/file-pack.mjs` | PreToolUse handler (file tools only) |
| `stop.mjs` | `hooks/stop.mjs` | Stop handler (refactored to use `_lib.mjs` in v0.6.0) |

## CONVENTIONS

- **Fail-silent**: every network call is wrapped in
  `try { ... } catch { resolve(undefined); }` inside `_lib.mjs`. A
  MemWeave outage must never break the Codex agent.
- **One output line per hook.** Codex's CC loader reads the LAST
  line of stdout as the hook response. We always emit exactly one
  JSON line and `process.exit(0)`.
- **`additionalContext` shape**: each hook that injects context
  emits `{ hookSpecificOutput: { hookEventName, additionalContext } }`
  matching CC's documented envelope.
- **`source: 'codex'`**: the plugin tags every session row with
  `source: 'codex'` (gained in server v0.5.3).
- **Project scoping**: every observation gets a `[{ key: 'project',
  value: cwd }]` scope. The server's consolidation worker inherits
  it onto the promoted memory (v0.5.4+).
- **Deterministic `messageId`**: `makeMessageId(sessionId, role,
  content)` hashes `(role + content)` so a replayed hook collapses
  to the same observation row server-side.
- **No `alreadyInjected` cache across hooks.** Every
  `UserPromptSubmit` re-fetches; the server is the dedup source of
  truth.
- **Cross-platform Node, no native deps**: every `.mjs` uses only
  builtins (`node:http`, `node:url`, `node:crypto`).
- **`.sh` and `.cmd` wrappers are 1-liners**: they resolve their own
  directory via `BASH_SOURCE` / `%~dp0` and `exec` the `.mjs` with
  stdin forwarded.

## ANTI-PATTERNS

- **NEVER** block on a network call. Every `postJson` has a
  `timeout: 10000` and an `on('error')` resolver that returns
  `undefined`.
- **NEVER** use `process.exit(1)` or throw from a hook. A failed
  hook must emit `{ continue: true, suppressOutput: true }` and
  exit 0.
- **NEVER** import from `packages/server/src/`. The plugin is its
  own package; the only server contract is the HTTP API.
- **NEVER** call `process.stdout.write` more than once per hook.
- **NEVER** cache the message text across hooks. There is no
  cross-hook state in the Codex loader, and a stale cache would
  produce wrong `messageId` hashes on retry.

## COMPATIBILITY

- Targets `@openai/codex` (CC marketplace format is stable).
- The plugin is compatible with `@mem-weave/server` v0.5.3+
  (`'codex'` was added to the `SourceClient` enum in v0.5.3).

## CHANGELOG

- **0.6.0**: Brings parity with the `opencode-plugin` and
  `mavis-plugin`. Adds `UserPromptSubmit` (user message writeback +
  `prompt_delta` injection) and `PreToolUse` (file_pack injection).
  The `Stop` hook is unchanged in behaviour but now shares
  `_lib.mjs` with the new hooks. New test fixtures
  (`fixtures/user-prompt.json`, `fixtures/pretool-read.json`).
- **0.5.4**: Sends `scopes: [{ key: 'project', value: cwd }]` on
  every observation.
- **0.1.0**: Initial release. Stop hook only.
