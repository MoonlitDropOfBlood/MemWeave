# @mem-weave/server

**Fastify + SQLite memory server + CLI + embedded MCP server. Single published package that runs the whole MemWeave backend.**

## OVERVIEW

This package is what `npm install -g @mem-weave/server` installs. The
`memweave` global bin (PowerShell/cmd/Bash) launches `dist/cli-entry.js`,
which dispatches CLI commands and starts the HTTP server (via
`start`).

The HTTP server hosts:

1. **REST API** at `/api/v1/*` (8 route files)
2. **Embedded MCP server** at `POST/GET/DELETE /mcp` (Streamable HTTP)
3. **Static admin UI** at `/ui/` (from `dist/web/`)

A background scheduler runs the consolidation worker every 6 hours.

## STRUCTURE

```
src/
├── cli-entry.ts              # `memweave` bin entry — dispatches argv
├── cli.ts                    # Argv parser
├── commands/                 # 11 CLI subcommands (start, stop, init, …)
├── core/                     # Config loader + Zod enums + decay model
├── db/                       # SQLite schema (SCHEMA_SQL) + 9 repositories
├── retrieval/                # 4-layer search (BM25 / vector / graph / causal) + RRF
├── injection/                # XML bundler (4 phases: session_start / prompt_delta / file_pack / failure_delta)
├── rest/routes/              # 8 route files (memories / sessions / observations / consolidation / …)
├── mcp/                      # EMBEDDED MCP SERVER — see below
├── prompts/                  # LLM prompt templates (compression / edge-extract / value-gate)
├── workers/                  # Consolidation pipeline (scheduler + consolidator + decay + dedup)
├── server/                   # HTTP bootstrap (http.ts) + auth + rate-limiter + logger + scheduler
├── providers/                # Embedding (openai / xenova / noop) + LLM (openai / noop)
└── types/                    # Ambient .d.ts for optional deps (xenova)
```

## EMBEDDED MCP SERVER (v0.4+)

The `mcp/` directory holds a **self-contained** MCP server that runs
**inside** this package's process. It is exposed at
`POST/GET/DELETE /mcp` over Streamable HTTP (MCP 2025-03-26).

```
mcp/
├── index.ts          # buildMcpHandler({ db }) — Fastify → fetch bridge
├── service.ts        # McpService — wraps MemoryRepo + EdgeRepo + SessionRepo + ConsolidationRunRepo + AccessLogRepo
├── registry.ts       # Registers the 10 memory_* tools on a McpServer
└── tools/            # 10 tools (memory_save / memory_recall / memory_expand / …)
```

**Why embedded (not a separate npm package)**: the previous standalone
`@mem-weave/mcp` package was retired in v0.4 because (a) users had to
install three packages (`server` + `mcp` + `opencode-plugin`) for the
end-to-end loop to work, and (b) the OpenCode plugin had to spawn
the MCP server as a child process, which broke on Windows + npm 9+.
The embedded server talks to the in-process SQLite directly via
`service.ts`, so it has no separate lifecycle to manage.

**Streamable HTTP semantics**:
- POST `/mcp` accepts a single JSON object OR newline-delimited JSON.
  The Fastify handler reads `req.raw` directly so the MCP SDK can
  decide per-line. The **global** `application/json` content-type
  parser stays at the default (strict JSON) — only the `/mcp`
  handler is permissive. **Do not** add a global permissive parser;
  it will break Zod validation on the REST routes (this regression
  was already fixed once; see CHANGELOG 0.5.0).
- GET `/mcp` holds a long-lived SSE stream for server-pushed
  notifications.
- DELETE `/mcp` closes the session.

**Stateless mode**: each request creates a fresh transport; no
session state lives on the server. If we later need true sessions,
`@modelcontextprotocol/sdk` has stateful variants — would need
changes to `mcp/index.ts` only.

**Where to look for the 10 tools**:

| Tool | File | Behaviour |
|---|---|---|
| `memory_save` | `mcp/tools/save.ts` | CreateMemoryInput → repo.create → returns MemoryRecord |
| `memory_recall` | `mcp/tools/recall.ts` | SearchMemoryInput → searchMemories() (4-layer fusion) |
| `memory_smart_search` | `mcp/tools/smart-search.ts` | Cross-source search with rerank |
| `memory_expand` | `mcp/tools/expand.ts` | Returns full memory record + neighbours/edges |
| `memory_graph_query` | `mcp/tools/graph-query.ts` | EdgeRepo traversal from a memory id |
| `memory_file_history` | `mcp/tools/file-history.ts` | Memories touching a given file path |
| `memory_sessions` | `mcp/tools/sessions.ts` | List recent sessions + their memories |
| `memory_patterns` | `mcp/tools/patterns.ts` | Cross-session pattern detection |
| `memory_consolidate` | `mcp/tools/consolidate.ts` | Trigger runConsolidation() (process-level mutex) |
| `memory_forget` | `mcp/tools/forget.ts` | Soft-delete via repo (sets deleted_at) |

## REST API (v0.5+)

Each file in `rest/routes/` is one resource. **All routes** take an
`X-API-Key` header (set by `auth.ts` middleware → `request.tenantId`).

| Method | Path | File | Notes |
|---|---|---|---|
| GET | `/api/v1/health` | `health.ts` | Used by `memweave doctor` and the OpenCode plugin's startup checks |
| GET / POST | `/api/v1/memories` | `memories.ts` | POST goes through `MemoryRepo.create()` with write-side dedup (BM25 + Jaccard) |
| GET / PATCH / DELETE | `/api/v1/memories/:id` | `memories.ts` | Soft-delete (`deleted_at`) — never `DELETE FROM` |
| GET | `/api/v1/memories/:id/edges` | `memories.ts` | EdgeRepo traversal |
| POST | `/api/v1/injection/preview` | `injection.ts` | Returns the same XML the plugin would inject, for the web UI's preview |
| GET | `/api/v1/stats` | `stats.ts` | Dashboard aggregates |
| GET | `/api/v1/sessions` | `sessions.ts` | listRecent |
| **POST** | **`/api/v1/sessions`** | `sessions.ts` (v0.5+) | **Idempotent** upsert on `sessionId` |
| GET | `/api/v1/sessions/:id/observations` | `sessions.ts` | List observations for a session |
| **POST** | **`/api/v1/observations`** | `observations.ts` (v0.5+) | **Idempotent** on `(sessionId, messageId)` via JSON envelope in `tool_input` |
| GET | `/api/v1/observations` / `/observations/:id` | `observations.ts` | List / detail |
| GET | `/api/v1/consolidation/runs[/...]` | `consolidation.ts` | Run history |
| POST | `/api/v1/consolidation/run` | `consolidation.ts` | Manual trigger (mutex with background scheduler) |
| GET / POST / DELETE | `/api/v1/devices` | `devices.ts` | Per-tenant API key registration |
| GET | `/api/v1/settings` | `settings.ts` | Server config (secrets masked) |
| POST / GET / DELETE | `/mcp` | `mcp/index.ts` | **Embedded MCP** (Streamable HTTP) |
| GET | `/ui/...` | static | `dist/web/` (built by `npm run web:build`) |

## WRITE-SIDE CLOSURE (v0.5+)

The OpenCode plugin (separate package) listens to its own event bus
and pushes every chat message to `POST /api/v1/sessions` +
`POST /api/v1/observations`. The consolidation worker then promotes
high-signal observations to long-term memories on its next tick.

**Why this is on the server, not the client**: idempotency keys
(sessionId, messageId) live in the database. The OpenCode plugin
can restart, drop network frames, or replay events; the server
upserts handle all of it without growing duplicates.

**Idempotency mechanism**:
- `POST /api/v1/sessions` uses `SessionRepo.findOrCreate()`. Caller
  supplies `sessionId`; the server inserts only if the row does not
  exist. Returns `201 + { created: true }` or `200 + { created: false }`.
- `POST /api/v1/observations` uses
  `ObservationRepo.createOrGetByMessageId()`. The caller-supplied
  `messageId` is encoded into the existing `tool_input` column as
  `JSON.stringify({ messageId: "..." })`. The lookup uses
  `WHERE tool_input LIKE '%"messageId":"..."%'`. This avoids a
  schema migration (which would have needed `ALTER TABLE
  observations ADD COLUMN message_id TEXT`).

## CONSOLIDATION WORKER

`workers/consolidator.ts` exports `runConsolidation({ dbPath })`. The
background scheduler (`server/scheduler.ts`) invokes it every 6
hours with `runOnStart: true` by default. Manual triggers
(`POST /api/v1/consolidation/run` and the `memweave consolidate`
CLI) use the same entry point.

A process-level mutex (`consolidationInFlight` boolean) ensures
only one run per tenant at a time. The phases, in order:

1. **Evict** — memories below the tier's strength threshold
2. **Promote** — short / medium → long if `reinforcement_score` is high
3. **Merge** — Jaccard on concepts within the same type (≥ 0.8)
4. **Edge discovery** — extract temporal / causal / entity edges
5. **Snapshot** — write a `consolidation_runs` row with the
   deltas. The web UI's "Sleep" page diffs this against the previous
   run.

## CONVENTIONS

- **No raw SQL outside `src/db/`**. Everything goes through a
  repository. The 9 repositories in `src/db/repositories/` are
  the ONLY place that calls `db.prepare(...)`.
- **All repository methods take `tenantId: string`** as the first
  parameter. This is enforced by convention + code review; there is
  no global query.
- **JSON columns** (`concepts_json`, `files_json`, `settings_json`)
  are TEXT. Serialize in the repo, parse on read.
- **Timestamps** are integer Unix epoch ms.
- **Soft delete**: set `deleted_at`; never `DELETE FROM`.
- **Idempotent POST** for write endpoints that may be retried by
  the OpenCode plugin: `POST /api/v1/sessions` (sessionId) and
  `POST /api/v1/observations` (messageId via JSON envelope).
- **CLI dispatch** lives in `commands/`. Each subcommand exports
  a `Command` object; `commands/index.ts` is the `Record<CliCommand,
  Command>` map. Add a new subcommand by creating a file + adding
  the key to the enum + the map.

## ANTI-PATTERNS

- **NEVER** add `as any` / `@ts-ignore`. Strict TS is enforced.
- **NEVER** edit `dist/` by hand — it's the `tsc` output.
- **NEVER** add a global `application/json` permissive parser.
  The `/mcp` handler reads `req.raw` directly and does not depend
  on Fastify's parser — keep the REST routes using the default
  parser so Zod sees an object, not a string.
- **NEVER** reach for the old `@mem-weave/mcp` package — it was
  retired in v0.4.0.
- **NEVER** call `app.listen()` from any code path other than
  `commands/start.ts` (via `bootstrap.ts`). Tests use `app.inject()`
  or `app.ready()` instead.
- **NEVER** import from `dist/` — it's build output.

## COMPILED OUTPUT

`npm run build` runs `tsc` → `dist/`. The npm tarball additionally
includes `dist/web/` (React build) and the README files; this is
configured in `scripts/publish.mjs` (`PACKAGES = [server, opencode-plugin]`).
