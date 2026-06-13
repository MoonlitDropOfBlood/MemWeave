# src/mcp/

**Model Context Protocol server. 10 tools over stdio, hits the REST API via `client.ts`.**

## OVERVIEW

The MCP entry point. `index.ts` boots the stdio transport; `registry.ts` registers all 10 tools; each tool lives in its own file under `tools/`. Tools are thin wrappers — they call `MemweaveClient` (in `client.ts`) which in turn hits the local Fastify server's `/api/v1/*` endpoints.

## STRUCTURE

```
src/mcp/
├── index.ts          # Stdio entry; creates Server, registers tools
├── registry.ts       # Exports all 10 tool definitions
├── client.ts         # MemweaveClient — typed wrapper over fetch → /api/v1
└── tools/            # 10 tools, one file each
    ├── save.ts           # memory_save
    ├── recall.ts         # memory_recall (keyword)
    ├── smart-search.ts   # memory_smart_search (4-layer)
    ├── expand.ts         # memory_expand
    ├── graph-query.ts    # memory_graph_query
    ├── file-history.ts   # memory_file_history
    ├── sessions.ts       # memory_sessions
    ├── patterns.ts       # memory_patterns
    ├── consolidate.ts    # memory_consolidate
    └── forget.ts         # memory_forget
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `MemweaveClient` | `client.ts` | `setBaseUrl()`, `health()`, plus one method per REST endpoint |
| `registerTools(server, client)` | `registry.ts` | Wires each tool to the MCP server |
| `MEMWEAVE_URL` | env | Server base URL (default `http://127.0.0.1:3131`) |
| `SearchResponseSchema` | `client.ts` | Typed Zod schema for `POST /api/v1/memories/search` responses. Used by 4 tools (`recall`, `smart_search`, `file_history`, `patterns`) |
| `GraphResponseSchema` | `client.ts` | Typed Zod schema for `GET /api/v1/memories/:id/graph` |
| `SessionsListResponseSchema` | `client.ts` | Typed Zod schema for `GET /api/v1/sessions` |
| `ConsolidationTriggerResponseSchema` | `client.ts` | Typed Zod schema for `POST /api/v1/consolidate` |
| `ForgetResponseSchema` | `client.ts` | Typed Zod schema for `DELETE /api/v1/memories/:id` |

## CONVENTIONS

- **One file per tool.** Schema is Zod; inputs go through `z.object({...}).parse(args)`.
- **All response schemas are typed** in `client.ts` and imported by tools. The 8 tools that previously passed `z.any()` now use the named schemas. A malformed server response throws a Zod parse error rather than silently corrupting the LLM context.
- Tools call `client.*` — never reach into the server process directly. The MCP shim stays stateless.
- All tool responses are JSON-stringified in `content[0].text`. The LLM parses it.
- Error handling: catch and return `{ isError: true, content: [{ type: 'text', text: err.message }] }`. Never throw across the tool boundary.

## ANTI-PATTERNS

- **NEVER** import from `src/db/`, `src/server/`, or `src/retrieval/` here. MCP talks to REST only.
- **NEVER** start the Fastify server from this process — assume it's already running.
- **NEVER** add business logic inside a tool. If it's more than a request + shape, extract to a service the REST API can also call.
