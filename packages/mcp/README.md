# @mem-weave/mcp

**MemWeave MCP server** — stdio-based Model Context Protocol server exposing 10 memory tools over `@mem-weave/server`'s REST API.

This is the **MCP transport** half of the MemWeave stack. The complementary packages are:

- **[@mem-weave/server](https://www.npmjs.com/package/@mem-weave/server)** — the server the MCP tools proxy to
- **[@mem-weave/opencode-plugin](https://www.npmjs.com/package/@mem-weave/opencode-plugin)** — auto-registers this MCP server with OpenCode

## Install + run

```bash
# Install
npm install -g @mem-weave/mcp

# Make sure @mem-weave/server is running on the default port
memweave start  # in another terminal, or as a daemon

# Run the MCP server (stdio JSON-RPC)
memweave-mcp
```

By default this talks to `http://127.0.0.1:3131`. Override with the `MEMWEAVE_URL` env var:

```bash
MEMWEAVE_URL=http://memweave.internal:3131 memweave-mcp
```

## The 10 tools

| Tool | Purpose | Server endpoint |
|---|---|---|
| `memory_save` | Persist an insight, decision, or fact | `POST /api/v1/memories` |
| `memory_recall` | Keyword search over past observations | `POST /api/v1/memories/search` |
| `memory_smart_search` | 4-layer hybrid search (BM25 + vector + graph + causal) | `POST /api/v1/memories/search` |
| `memory_expand` | Fetch full record for a memory (progressive disclosure close-the-loop) | `GET /api/v1/memories/:id` |
| `memory_graph_query` | Walk the memory graph around an anchor | `GET /api/v1/memories/:id/graph` |
| `memory_file_history` | Past observations about specific files | `POST /api/v1/memories/search` |
| `memory_sessions` | Recent sessions with observation counts | `GET /api/v1/sessions` |
| `memory_patterns` | Detect recurring patterns across sessions | `POST /api/v1/memories/search` |
| `memory_consolidate` | Manually trigger a "sleep" cycle | `POST /api/v1/consolidate` |
| `memory_forget` | Soft-delete memories (audit trail) | `DELETE /api/v1/memories/:id` |

All responses are validated against typed Zod schemas. A malformed server response throws a parse error rather than silently corrupting the LLM context.

## Use with Claude Desktop / Cursor

Add to your MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memweave": {
      "command": "npx",
      "args": ["-y", "@mem-weave/mcp"],
      "env": { "MEMWEAVE_URL": "http://127.0.0.1:3131" }
    }
  }
}
```

## License

MIT
