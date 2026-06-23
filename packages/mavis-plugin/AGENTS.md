# packages/mavis-plugin/

**MemWeave plugin for Mavis (mavis). Pure-config directory-style plugin (no build step). Closes the read loop (auto-injection of summary-only XML on `UserPromptSubmit` and on file-touching tool calls) and the write loop (auto-upsert of every chat message back to the MemWeave server on `UserPromptSubmit` + `Stop`).**

## OVERVIEW

The plugin is a CC marketplace plugin installed into the Mavis
plugin loader at `~/.mavis/plugins/marketplaces/` (or wherever the
Mavis CC marketplace cache lives). It exposes three CC-style hooks
(`UserPromptSubmit`, `PreToolUse`, `Stop`) and a `.mcp.json` that
auto-registers the `memweave` MCP server pointing at the local
MemWeave server.

| Hook | What it does |
|---|---|
| `UserPromptSubmit` | Captures the user prompt as a `chat.user` observation; upserts the session row; fetches a `prompt_delta` memory pack and emits it as `hookSpecificOutput.additionalContext` so the LLM sees the relevant memories before responding. |
| `PreToolUse` (file tools only) | On `Read` / `Edit` / `Write` / `Glob` / `Grep`, fetches a `file_pack` memory pack for the file paths in `tool_input` and emits it as `hookSpecificOutput.additionalContext`. |
| `Stop` | Captures `last_assistant_message` as a `chat.assistant` observation; upserts the session row. |

The plugin does NOT spawn child processes. Each hook is a
cross-platform Node script invoked in-process by the Mavis loader.
All network communication is HTTP to the local MemWeave server
(`http://127.0.0.1:3131` by default).

## MCP REGISTRATION (automatic)

Unlike the OpenCode plugin, the Mavis plugin does NOT require the
user to hand-edit any config. Mavis's CC marketplace loader reads
`.mcp.json` from the plugin directory at install time and registers
the `memweave` MCP server automatically. **No boot-time warning
needed.**

## STRUCTURE

```
packages/mavis-plugin/
├── .claude-plugin/
│   └── plugin.json            # Plugin manifest (CC marketplace format)
├── .mcp.json                  # Registers 10 memory_* tools via HTTP transport
├── hooks/
│   ├── hooks.json             # UserPromptSubmit / PreToolUse / Stop bindings
│   ├── _lib.mjs               # Shared HTTP client + helpers (postJson, parseEvent, etc.)
│   ├── prompt-inject.mjs      # UserPromptSubmit -> inject prompt_delta
│   ├── prompt-inject.sh       # Unix thin wrapper
│   ├── prompt-inject.cmd      # Windows thin wrapper
│   ├── file-pack.mjs          # PreToolUse (file tools) -> inject file_pack
│   ├── file-pack.sh / .cmd
│   ├── writeback.mjs          # Stop -> POST session + last assistant message
│   └── writeback.sh / .cmd
├── fixtures/                  # Synthetic stdin for `npm run test:hook`
├── package.json               # Private, scripts: test:prompt-inject / file-pack / writeback
├── README.md
└── AGENTS.md                  # ← you are here
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `SERVER_URL` / `TENANT` | `hooks/_lib.mjs` | `MEMWEAVE_SERVER_URL` (default `http://127.0.0.1:3131`) + `MEMWEAVE_TENANT` (default `tenant_default`) |
| `readStdin()` / `parseEvent()` | `hooks/_lib.mjs` | Read JSON from stdin, parse safely (empty object on failure) |
| `deriveSessionId(event)` | `hooks/_lib.mjs` | Read `session_id` (CC) / `sessionId` (camelCase) / `sessionID` / fallback hash of cwd |
| `deriveScopes(event)` | `hooks/_lib.mjs` | Read `cwd` from event, build `[{ key: 'project', value: cwd }]` |
| `requestInjection({...})` | `hooks/_lib.mjs` | POST `/api/v1/inject` (4 phases: session_start, prompt_delta, file_pack, failure_delta) |
| `reportSession({...})` | `hooks/_lib.mjs` | POST `/api/v1/sessions` (idempotent on `sessionId`) |
| `reportObservation({...})` | `hooks/_lib.mjs` | POST `/api/v1/observations` (idempotent on `(sessionId, messageId)`) |
| `makeMessageId(sessionId, role, content)` | `hooks/_lib.mjs` | Deterministic messageId from content hash; same content = same id, retries collapse server-side |
| `extractFilePaths(toolInput)` | `hooks/_lib.mjs` | Pull file paths from `tool_input` (5 key variants: filePath, file_path, path, file, pattern) |
| `emitHookOutput(obj)` | `hooks/_lib.mjs` | Write hook response JSON line to stdout |
| `prompt-inject.mjs` | `hooks/prompt-inject.mjs` | UserPromptSubmit handler |
| `file-pack.mjs` | `hooks/file-pack.mjs` | PreToolUse handler (file tools only) |
| `writeback.mjs` | `hooks/writeback.mjs` | Stop handler |

## CONVENTIONS

- **Fail-silent**: every network call is wrapped in
  `try { ... } catch { resolve(undefined); }` inside `_lib.mjs`. A
  MemWeave outage must never break the Mavis agent. All three
  hooks emit at least `{ continue: true, suppressOutput: true }`
  even on failure.
- **One output line per hook.** Mavis's CC loader reads the LAST
  line of stdout as the hook response. We always emit exactly one
  JSON line and `process.exit(0)`.
- **`additionalContext` shape**: each hook that injects context
  emits `{ hookSpecificOutput: { hookEventName, additionalContext } }`
  matching CC's documented envelope. The `hookEventName` field is
  required so Mavis knows which event the response is for.
- **`source: 'mavis'`**: the plugin tags every session row with
  `source: 'mavis'`. The server's `SourceClientSchema` enum gained
  `'mavis'` in v0.6.0; the server's `/api/v1/sessions` route's
  zod schema was updated in lockstep.
- **Project scoping**: every observation gets a `[{ key: 'project',
  value: cwd }]` scope. The server's consolidation worker inherits
  it onto the promoted memory (v0.5.4+).
- **Deterministic `messageId`**: `makeMessageId(sessionId, role,
  content)` hashes `(role + content)` so a replayed hook (Stop
  re-fire, retry) collapses to the same observation row server-side.
- **No `alreadyInjected` cache across hooks.** Every
  `UserPromptSubmit` re-fetches; the server is the dedup source of
  truth. Cost is one search per prompt -- acceptable for v1.
- **Cross-platform Node, no native deps**: every `.mjs` uses only
  builtins (`node:http`, `node:url`, `node:crypto`). No `fetch`
  (Node 20's `fetch` is used in the OpenCode plugin because the
  OpenCode host provides a global `fetch`; we cannot rely on that
  in the Mavis loader).
- **`.sh` and `.cmd` wrappers are 1-liners**: they resolve their own
  directory via `BASH_SOURCE` / `%~dp0` and `exec` the `.mjs` with
  stdin forwarded. The `.mjs` is the canonical implementation; the
  wrappers are pure shims.

## ANTI-PATTERNS

- **NEVER** block on a network call. Every `postJson` has a
  `timeout: 10000` and an `on('error')` resolver that returns
  `undefined`. The hook must always complete in < timeout.
- **NEVER** use `process.exit(1)` or throw from a hook. A failed
  hook must emit `{ continue: true, suppressOutput: true }` and
  exit 0 so Mavis does not surface a confusing error to the user.
- **NEVER** import from `packages/server/src/`. The plugin is its
  own package; the only server contract is the HTTP API.
- **NEVER** call `process.stdout.write` more than once per hook.
  Mavis reads the LAST line; multiple writes are confusing.
- **NEVER** cache the message text across hooks. There is no
  cross-hook state in the Mavis loader, and a stale cache would
  produce wrong `messageId` hashes on retry.
- **NEVER** change `additionalContext` to a non-string value. The
  CC spec is `{ additionalContext: string }`; Mavis will not
  parse non-strings.

## COMPATIBILITY

- Targets Mavis 0.5.x and later (the CC marketplace format is
  stable in Mavis 0.5+).
- The plugin is compatible with `@mem-weave/server` v0.6.0+ (which
  added `'mavis'` to the `SourceClient` enum).
- For earlier server versions, the plugin's `UserPromptSubmit` and
  `PreToolUse` hooks still work (they POST to `/api/v1/inject`,
  `/api/v1/observations`, `/api/v1/sessions` which are all present
  in v0.5.x), but the `source: 'mavis'` value will fail Zod
  validation. Pin to a server with v0.6.0+.

## DIFFERENCES vs the OpenCode plugin

| Aspect | opencode-plugin | mavis-plugin |
|---|---|---|
| Distribution | npm package (`@mem-weave/opencode-plugin`) | Directory install via `mavis plugin install` |
| Build step | `tsc` → `dist/` | None -- pure Node ESM source |
| MCP registration | User must hand-edit `opencode.json` (OpenCode doesn't call plugin `config` hook) | Automatic via `.mcp.json` (Mavis's CC loader reads it) |
| `system.transform` mapping | `experimental.chat.system.transform` (OpenCode SDK) | `UserPromptSubmit` (CC marketplace) |
| `event.message.updated` mapping | OpenCode `event` hook + reverse-query SDK | Two separate hooks: `UserPromptSubmit` for user, `Stop` for assistant |
| `tool.execute.before` mapping | OpenCode SDK | `PreToolUse` (CC marketplace) |
| State | In-process Map (cache, in `index.ts`) | None -- stateless across hooks (server is dedup source) |
| **Hook registration** | OpenCode SDK auto-loads `hooks/hooks.json` | `distributeHooks` is a stub in Mavis; you must ALSO drop markdown hook files at `~/.mavis/agents/<agent>/hooks/*.md` (YAML frontmatter + bash body) to wire the events. See `README.md` for the exact three files. |

## DEV WORKFLOW (server source changes)

The hooks POST to `http://127.0.0.1:3131`, which is whichever
server is listening on that port. Two ways to drive that port:

1. **`npm run dev`** — `tsx` runs `packages/server/src/server/bootstrap.ts`
   with hot-reload. Source changes take effect on the next request
   (no rebuild needed). For dev iteration, kill the global server
   (`Stop-Process` on its PID) and run `npm run dev` instead.
2. **`npm run publish`** — proper release path. Bumps server
   version, rebuilds, pushes to npm. After publish,
   `npm install -g @mem-weave/server@latest` updates the global
   install.

**Do not** manually copy `packages/server/dist/` into the global
install — that bypasses versioning. If you need local-global
isolation, use `npm link ./packages/server` once and forget.
