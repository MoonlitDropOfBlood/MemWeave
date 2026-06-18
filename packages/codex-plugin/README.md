# MemWeave for OpenAI Codex

> Local-first long-term memory for Codex agents. The plugin auto-exposes
> 10 `memory_*` MCP tools (via the running `@mem-weave/server` `/mcp`
> endpoint) and writes completed turns back to the server on Stop, so
> high-signal facts are consolidated into durable memory across sessions.

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

2. **`Stop` lifecycle hook.** When the Codex agent finishes a turn
   (user message → assistant response), the hook fires and posts the
   session + last assistant message to the MemWeave server. Writes
   are idempotent on `(sessionId, messageId)`, so retries and
   re-fires collapse to a single row.

   The hook is fail-silent: if the MemWeave server is down or the
   request fails, the Codex agent still completes normally. We never
   block the Stop event.

## How it works

```
[Codex agent]
   ↓ session_end → Stop event JSON on stdin (snake_case, includes cwd)
[hooks/stop.mjs] (cross-platform Node, no jq/curl)
   ↓ POST /api/v1/sessions    { sessionId, source: "codex", title }
   ↓ POST /api/v1/observations { sessionId, messageId, hookType: "chat.assistant", text,
   ↓                            scopes: [{ key: "project", value: cwd }] }
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
it at a remote server, edit `hooks/stop.mjs`.

## File layout

```
packages/codex-plugin/
├── .codex-plugin/
│   └── plugin.json            # Plugin manifest (name, version, capabilities)
├── .mcp.json                  # Registers 10 memory_* tools via HTTP transport
├── hooks/
│   ├── hooks.json             # Stop event binding
│   ├── stop.mjs               # Cross-platform Node logic (the canonical impl)
│   ├── stop.sh                # Unix thin wrapper → stop.mjs
│   └── stop.cmd               # Windows thin wrapper → stop.mjs
└── README.md
```

## Versioning

| Plugin version | Server version | Notes |
|---|---|---|
| 0.1.0 | ≥ 0.5.3 | Adds `codex` to the source enum (v0.5.3+) |
| 0.5.4 | ≥ 0.5.4 | Sends `scopes: [{ key: 'project', value: cwd }]` on every observation. The server's consolidation worker inherits the scope onto the promoted memory, so different Codex projects stay separate in search + the Web UI project filter |

## Known limitations

- **No session `ended_at` update.** The plugin posts the assistant
  message but does not call a `sessions/:id/end` endpoint (none
  exists in the REST API yet). The session row's `ended_at` stays
  `null`. This is consistent with the OpenCode plugin's behaviour.
- **No transcript capture.** Codex's `Stop` event gives
  `last_assistant_message` but not the full conversation. The plugin
  writes the assistant's last message as one observation; user
  messages and tool calls are not captured. (Unlike OpenCode, which
  has an SDK to query historical messages.)
- **Server must be running first.** If the server is down at
  Stop-time, the hook silently no-ops. The 10 MCP tools will also
  fail to connect.

## License

MIT (same as MemWeave).
