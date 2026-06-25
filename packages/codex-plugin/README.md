# MemWeave for OpenAI Codex

> Local-first long-term memory for Codex agents. The plugin auto-exposes
> 10 `memory_*` MCP tools (via the running `@mem-weave/server` `/mcp`
> endpoint), injects relevant memories on `UserPromptSubmit` and on
> file-touching tool calls (`PreToolUse`), and writes completed turns
> back to the server on `Stop` (assistant) and `UserPromptSubmit`
> (user), so high-signal facts are consolidated into durable memory
> across sessions.

## Install

The plugin lives at `packages/codex-plugin/` in the
[MemWeave monorepo](https://github.com/MoonlitDropOfBlood/MemWeave).
You can install it two ways:

### A. From a local checkout (recommended for development)

```bash
# 1. Make sure the MemWeave server is running
npx @mem-weave/server start

# 2. Install the plugin from the local path
codex plugin install /path/to/MemWeave/packages/codex-plugin

# 3. Verify
codex plugins list
```

### B. From a marketplace (when published)

```bash
codex plugin add memweave@<marketplace>
```

## What the plugin does

1. **10 MCP tools auto-loaded.** Codex reads `.mcp.json` and
   instantiates an HTTP transport to `http://127.0.0.1:3131/mcp`
   (the running MemWeave server). The tools appear with the
   `mcp__memweave__` prefix and the agent can call them at will.

   | Tool | Purpose |
   |---|---|
   | `memory_save` | Write a memory (server-side dedup, no LLM tokens) |
   | `memory_recall` | BM25 keyword search |
   | `memory_smart_search` | 4-layer fusion search (BM25 + vector + graph + causal) |
   | `memory_expand` | Full record + neighbours from a memory id |
   | `memory_graph_query` | Walk the relationship graph around a memory |
   | `memory_file_history` | Memories touching a given file path |
   | `memory_sessions` | List recent sessions |
   | `memory_patterns` | Detect recurring patterns across sessions |
   | `memory_consolidate` | Manually trigger a "sleep" cycle |
   | `memory_forget` | Soft-delete a memory |

2. **`UserPromptSubmit` hook** — when the user submits a prompt to
   the agent, the hook fires and:
   - Captures the prompt as a `chat.user` observation.
   - Upserts the session row (idempotent on `sessionId`).
   - Fetches a `prompt_delta` memory pack from the server and emits
     it as `hookSpecificOutput.additionalContext`, so the LLM sees
     the relevant memories before responding.

3. **`PreToolUse` hook (file-touching tools only)** — when the LLM
   is about to call `Read` / `Edit` / `Write` / `Glob` / `Grep`, the
   hook fires and asks the server for a `file_pack` of memories
   related to those file paths. The XML is emitted as
   `additionalContext` so the LLM sees prior context on the file
   mid-turn.

4. **`Stop` lifecycle hook** — when the agent finishes a turn
   (user message → assistant response), the hook fires and posts
   the session + last assistant message to the MemWeave server.
   Writes are idempotent on `(sessionId, messageId)`, so retries and
   re-fires collapse to a single row.

All hooks are fail-silent: if the MemWeave server is down or the
request fails, the Codex agent still completes normally. We never
block any event.

## How it works

```
[Codex agent]
   ↓ user prompt → UserPromptSubmit event JSON on stdin (snake_case, includes cwd)
[hooks/prompt-inject.mjs] (UserPromptSubmit)
   ↓ POST /api/v1/sessions    { sessionId, source: "codex", title }
   ↓ POST /api/v1/observations { sessionId, messageId, hookType: "chat.user", text, scopes }
   ↓ POST /api/v1/inject      { sessionId, phase: "prompt_delta", query: <prompt> }
   ↓                            → additionalContext
[LLM] sees memories; may call Read/Edit/Write/Glob/Grep
[hooks/file-pack.mjs] (PreToolUse, file tools only)
   ↓ POST /api/v1/inject      { sessionId, phase: "file_pack", files: [...] }
   ↓                            → additionalContext
[LLM] completes response → Stop event JSON on stdin
[hooks/stop.mjs] (Stop)
   ↓ POST /api/v1/sessions    { sessionId, source: "codex", title }
   ↓ POST /api/v1/observations { sessionId, messageId, hookType: "chat.assistant", text, scopes }
[MemWeave server on 127.0.0.1:3131]
   ↓ consolidation worker (every 6h)
   ↓ promote high-signal observations → long-term memories
   ↓   (inherits the observation's scopes: project gets scope_level="project")
[Next Codex session] system prompt receives memory summaries
                       via the 10 MCP tools (filtered by project)
```

## Prerequisites

- The MemWeave server **must be running** before Codex starts. The
  plugin does not start the server for you.
- Node 20+ (Codex requires it anyway)
- No external dependencies; no API keys; no configuration.

## Configuration

The plugin reads these env vars (all optional; defaults shown):

| Var | Default | Meaning |
|---|---|---|
| `MEMWEAVE_SERVER_URL` | `http://127.0.0.1:3131` | MemWeave server base URL |
| `MEMWEAVE_TENANT` | `tenant_default` | Tenant id (multi-tenant isolation) |

The Codex server URL is hard-coded to `127.0.0.1` for security — the
plugin does not talk to remote MemWeave servers by default. To point
it at a remote server, edit `_lib.mjs`.

## File layout

```
packages/codex-plugin/
├── .codex-plugin/
│   └── plugin.json            # Plugin manifest (name, version, capabilities)
├── .mcp.json                  # Registers 10 memory_* tools via HTTP transport
├── hooks/
│   ├── hooks.json             # UserPromptSubmit / PreToolUse / Stop bindings
│   ├── _lib.mjs               # Shared HTTP client (readStdin, postJson, helpers)
│   ├── prompt-inject.mjs      # UserPromptSubmit -> inject prompt_delta
│   ├── prompt-inject.sh       # Unix thin wrapper
│   ├── prompt-inject.cmd      # Windows thin wrapper
│   ├── file-pack.mjs          # PreToolUse (file tools) -> inject file_pack
│   ├── file-pack.sh           # Unix thin wrapper
│   ├── file-pack.cmd          # Windows thin wrapper
│   ├── stop.mjs               # Stop -> POST session + last assistant message
│   ├── stop.sh                # Unix thin wrapper
│   └── stop.cmd               # Windows thin wrapper
├── fixtures/                  # Synthetic stdin for `npm run test:hook`
├── package.json               # Private (not published)
├── README.md
└── AGENTS.md
```

## Testing the hooks locally

```bash
cd packages/codex-plugin

# 1. Make sure the server is up
npx @mem-weave/server start

# 2. Run each hook with a synthetic event. The scripts read JSON
# from stdin and write the hook response (also JSON) to stdout.
npm run test:prompt-inject
npm run test:file-pack
npm run test:writeback

# All three:
npm run test:hook
```

Each script is fail-silent: a missing server does not raise -- it
just writes `{"continue":true,"suppressOutput":true}` to stdout
and exits 0. Inspect the response JSON to see whether the
`hookSpecificOutput.additionalContext` is populated.

## Versioning

| Plugin version | Server version | Notes |
|---|---|---|
| 0.1.0 | ≥ 0.5.3 | Adds `codex` to the source enum (v0.5.3+) |
| 0.5.4 | ≥ 0.5.4 | Sends `scopes: [{ key: 'project', value: cwd }]` on every observation. The server's consolidation worker inherits the scope onto the promoted memory, so different Codex projects stay separate in search + the Web UI project filter |
| 0.6.0 | ≥ 0.5.6 | Brings parity with the `opencode-plugin` and `mavis-plugin`: adds `UserPromptSubmit` (user message writeback + `prompt_delta` injection) and `PreToolUse` (file_pack injection). The `Stop` hook is unchanged but now shares `_lib.mjs` with the new hooks. |
| 0.7.0 | ≥ 0.7.0 | Sends the **resolved project name** on every session POST (`project` field on `POST /api/v1/sessions`) and uses it as the `scopes: [{ key: 'project', value: <name> }]` value on every observation POST (replacing the raw `event.cwd` path). The `deriveProjectFromCwd` cascade (git remote last segment → basename → absolute path, with worktree walk-up to the main gitdir) lives in `hooks/_lib.mjs`. Run `npm run test:all` (now includes `test:derive-project`, 5 cascade cases). |

## Known limitations

- **No session `ended_at` update.** The plugin posts the assistant
  message but does not call a `sessions/:id/end` endpoint (none
  exists in the REST API yet). The session row's `ended_at` stays
  `null`. This is consistent with the OpenCode plugin's behaviour.
- **`alreadyInjected` is not tracked across hooks.** Every
  `UserPromptSubmit` re-fetches; the server is the source of truth
  for dedup. Cost is one search per prompt.
- **Server must be running first.** If the server is down at
  hook-time, the hooks silently no-op. The 10 MCP tools will also
  fail to connect.

## License

MIT (same as MemWeave).
