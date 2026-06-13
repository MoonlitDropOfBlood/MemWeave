# @mem-weave/server

**MemWeave local-first memory infrastructure for AI agents.** Structured memory, 4-layer retrieval (BM25 + vector + graph + causal), token-budgeted injection, server-side write deduplication, and background consolidation. Fastify REST API + CLI.

This is the **server** half of the MemWeave stack. The complementary packages are:

- **[@mem-weave/mcp](https://www.npmjs.com/package/@mem-weave/mcp)** — stdio MCP server exposing 10 tools
- **[@mem-weave/opencode-plugin](https://www.npmjs.com/package/@mem-weave/opencode-plugin)** — OpenCode plugin that auto-injects memory + registers the MCP server

## Install

```bash
npm install -g @mem-weave/server
```

## Quick start

```bash
# 1. Initialize a config + data dir in the current directory
memweave init

# 2. Start the server (foreground)
memweave start

# Server listens on http://127.0.0.1:3131 by default.
# Health check:
curl http://127.0.0.1:3131/api/v1/health
# → {"ok":true,"service":"memweave-server"}
```

In another terminal, point an MCP client (e.g. `@mem-weave/opencode-plugin`) at `http://127.0.0.1:3131`.

## CLI

```
memweave start           Start the HTTP server + background workers (default)
memweave stop            Stop a running memweave-server (via PID file)
memweave status          Probe /api/v1/health
memweave init            Create default config, DB, and device key
memweave doctor          Check dependencies, port, DB, embedding/LLM config
memweave migrate         Run schema migration (idempotent)
memweave backup [path]   Copy the SQLite DB to a snapshot file
memweave help            Show help
```

> Note: the `mcp` subcommand was removed in v0.2. Install `@mem-weave/mcp` and run its `memweave-mcp` bin instead.

## REST API

All routes are prefixed `/api/v1/`. Selected endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/memories` | Create a memory (rate-limited per API key) |
| `POST` | `/memories/search` | 4-layer hybrid search; `mode: 'compact' \| 'full'` |
| `GET` | `/memories/:id` | Fetch one memory (full record, used by `memory_expand`) |
| `PATCH` | `/memories/:id` | Edit title / content / summary / importance / confidence |
| `DELETE` | `/memories/:id` | Soft-delete (`deleted_at`) with reason |
| `POST` | `/inject` | Token-budgeted summary XML for a session/phase |
| `GET` | `/stats` | Dashboard aggregates |
| `GET` | `/sessions` | Recent sessions with observation counts |
| `GET` | `/consolidation/runs` | Background "sleep" cycle history |
| `POST` | `/consolidate` | Manually trigger a consolidation run |
| `GET/POST/DELETE` | `/devices` | Device API key management |
| `GET` | `/settings` | Server config (secrets masked) |

## Programmatic use

The server is also a TypeScript library. Importing the HTTP bootstrap from `@mem-weave/server/dist/server/bootstrap.js` boots everything in-process. See `src/server/bootstrap.ts` for the entry point.

## License

MIT
