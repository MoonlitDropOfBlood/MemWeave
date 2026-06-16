# MemWeave for OpenAI Codex — Design Spec

> **Status**: DRAFT (pending Codex plugin manifest schema research)
> **Date**: 2026-06-16
> **Companion to**: [2026-06-16-opencode-mcp-type-schema.md](./2026-06-16-opencode-mcp-type-schema.md)
> **Version target**: MemWeave server 0.5.2

## 1. Background

MemWeave is a local-first memory infrastructure for AI agents. It ships:

- `@mem-weave/server` — Fastify + SQLite server, port 3131, exposes
  - REST API at `/api/v1/*`
  - Embedded MCP server at `POST/GET/DELETE /mcp` (Streamable HTTP)
  - 10 `memory_*` MCP tools
- `@mem-weave/opencode-plugin` — for OpenCode, in-process plugin that:
  - Auto-injects memory summaries into the system prompt
  - Auto-writes completed chat messages back to the server (idempotent on `(sessionId, messageId)`)

The OpenCode plugin is great, but Codex users can't use it. This spec
designs an analogous plugin for OpenAI Codex.

## 1.1 Codex Plugin System — Resolved Schema

Based on the OpenAI Codex source (`codex-rs/core-plugins/src/manifest.rs`,
`codex-rs/hooks/src/schema.rs`, `codex-rs/config/src/hook_config.rs`):

| Concept | Codex path | Notes |
|---|---|---|
| Plugin manifest | `.codex-plugin/plugin.json` | At plugin root, **only** file inside `.codex-plugin/` |
| MCP config | `.mcp.json` (at plugin root) | Format: `{"mcpServers": { "name": { "type": "http", "url": "..." }}}` |
| Hooks config | `hooks/hooks.json` | Or inline in `~/.codex/config.toml` |
| Stop event fields | `session_id`, `turn_id`, `last_assistant_message`, `transcript_path`, `cwd`, `model`, `permission_mode`, `stop_hook_active` | Codex uses **snake_case** |
| Stop control | Hook writes `{"continue": true}` to stdout | Exit code 0 = success |
| Plugin install | `codex plugin add <name>@<marketplace>` | Or `codex plugin install <local-path>` |
| Hook trust | First-time prompt per (plugin, hook, event) | User must accept before hooks fire |

Cross-platform: hooks resolve `command` (Unix) or `commandWindows`
(Win). Codex's hook format is **file-based config only**; there is
no Codex plugin SDK like `@opencode-ai/plugin`. The plugin's
"compute" lives entirely in shell scripts and a `.mcp.json`.

## 2. Goals

1. **Zero modifications to `@mem-weave/server`**. The Codex plugin must
   be a pure consumer of the existing REST + MCP surface.
2. **Pure consumer, no plugin framework coupling**. The plugin should
   consist of a manifest, an `.mcp.json`, and a `Stop` hook shell
   script. No SDK, no compiled runtime — just text files the user
   can inspect.
3. **Idempotent writes**. The Codex plugin may be called multiple
   times for the same message (retries, restarts). The write path
   MUST be safe under repeated invocation.

## 3. Non-Goals

- A standalone npm package. The Codex plugin lives in `packages/codex-plugin/`
  as a directory; users either symlink it or `codex plugin install` it.
- Plugin-side LLM calls. MemWeave's consolidation pipeline already runs
  server-side.
- Bidirectional realtime. The plugin is fire-and-forget on agent stop.
- Reading historical messages. Codex (as of 2026-06) does not expose a
  hook that gives access to the full conversation history. The plugin
  reads only what the current Stop event provides.

## 4. Architecture

```
   ┌─────────────────────────────────────────────────────────────┐
   │  OpenAI Codex agent                                          │
   │                                                              │
   │  - Loads .mcp.json → 10 memory_* tools appear in the agent   │
   │  - Loads hooks/hooks.json → Stop fires hooks/stop.sh          │
   │                                                              │
   │  hooks/stop.sh                                               │
   │    ↓ reads JSON from stdin (sessionId, last user msg, ...)    │
   │    ↓ curl POST /api/v1/sessions                              │
   │    ↓ curl POST /api/v1/observations                          │
   │                                                              │
   └─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP (curl)
                              ↓
   ┌─────────────────────────────────────────────────────────────┐
   │  @mem-weave/server (already running on :3131)                │
   │                                                              │
   │  /mcp              — 10 memory_* tools (read + write)        │
   │  /api/v1/sessions  — idempotent on sessionId                 │
   │  /api/v1/observations — idempotent on (sessionId, messageId)  │
   │                                                              │
   └─────────────────────────────────────────────────────────────┘
```

## 5. File Layout

```
packages/codex-plugin/
├── .mcp.json                        # Registers the 10 memory_* tools
├── hooks/
│   ├── hooks.json                   # Stop event binding
│   └── stop.sh                      # curl POST session + observations
├── scripts/
│   └── install.sh                   # Optional: copy into ~/.codex/plugins/
├── README.md                        # Install + usage guide
└── package.json                     # Metadata + scripts only (not published)
```

## 6. The .mcp.json

Points Codex at the running MemWeave server's MCP endpoint:

```json
{
  "mcpServers": {
    "memweave": {
      "type": "http",
      "url": "http://127.0.0.1:3131/mcp"
    }
  }
}
```

Once Codex loads this, the 10 `memory_*` tools (memory_save,
memory_recall, memory_search, memory_expand, memory_get, memory_delete,
memory_graph_query, memory_file_history, memory_patterns,
memory_consolidate) are auto-exposed to the agent.

## 7. The Stop Hook

### 7.1 hooks.json

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$PLUGIN_DIR/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
```

### 7.2 stop.sh

The hook receives a JSON event on stdin. Pseudocode:

```bash
#!/usr/bin/env bash
# Read event from stdin
EVENT=$(cat)

# Extract fields
SESSION_ID=$(echo "$EVENT" | jq -r '.session_id // .sessionId // ""')
USER_MSG=$(echo "$EVENT" | jq -r '.user_message // .lastUserMessage // ""')

# Defaults
[ -z "$SESSION_ID" ] && SESSION_ID="codex-$(date +%s)"
SERVER="http://127.0.0.1:3131"

# 1. Register/refresh the session (idempotent on sessionId)
curl -fsS -X POST "$SERVER/api/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "X-Memweave-Tenant: codex" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"sourceClient\":\"codex\",\"metadata\":{}}"

# 2. Write the user message as an observation (idempotent on messageId)
MSG_ID="codex-${SESSION_ID}-$(date +%s%N)"
curl -fsS -X POST "$SERVER/api/v1/observations" \
  -H "Content-Type: application/json" \
  -H "X-Memweave-Tenant: codex" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"messageId\":\"$MSG_ID\",\"role\":\"user\",\"content\":\"$USER_MSG\"}"
```

### 7.3 Idempotency contract

- `POST /api/v1/sessions` — server uses `INSERT OR IGNORE` on
  `sessionId` (serverside)
- `POST /api/v1/observations` — server uses
  `(sessionId, messageId)` as a unique key (serverside)

The hook MUST generate a stable `messageId` for the same user message
so retries collapse to a single row. Strategy: `messageId =
sha256(sessionId + "user-" + hash(userMessage))` — same content →
same id, dedup wins.

## 8. Install

```bash
# 1. Start MemWeave server
memweave start

# 2. Install the plugin (Codex CLI)
codex plugin install ./packages/codex-plugin

# 3. Verify
codex plugins list
```

The plugin requires no environment variables, no API keys, no
configuration. The server URL is hard-coded to `127.0.0.1:3131`
for security (no remote MemWeave by default).

## 9. Out of Scope (and Why)

- **Tool whitelist for the agent.** Codex exposes the 10 MCP tools
  globally. We don't restrict them because MemWeave's server already
  has tenant + auth isolation; the 10 tools are the entire surface
  anyway.
- **Multi-tenant via plugin config.** The plugin uses a single
  `X-Memweave-Tenant: codex` header. Multi-tenant is a server concern.
- **Embedding/vector search.** Handled server-side; the plugin doesn't
  need to know.

## 10. Open Questions (pending research)

- Exact field names in the Stop event JSON (sessionId vs session_id
  vs conversation_id)
- Whether Codex supports `http` mcp type natively or wants `sse`
- Whether the manifest filename is `.codex/plugin.json` or
  `plugin.json` or something else
- The exact install command for Codex plugins (TBD)

These will be filled in once `bg_bc3de3f7` librarian research
completes.
