# MemWeave

**Local-first, memorable, reasoning-capable memory infrastructure for AI agents.**

## OVERVIEW

TypeScript monorepo with two published npm packages and a web app:

- **`@mem-weave/server`** (bin: `memweave`) — Fastify + SQLite server + CLI. Exposes
  REST under `/api/v1/*` and an **embedded MCP server at `POST/GET/DELETE /mcp`**
  (Streamable HTTP, MCP 2025-03-26 spec, 10 `memory_*` tools).
- **`@mem-weave/opencode-plugin`** — OpenCode plugin loaded into the OpenCode
  process. Auto-injects memory summaries into the system prompt and **writes**
  every completed chat message back to the server so the consolidation worker
  can promote high-signal turns to long-term memories. The plugin **cannot**
  register the `mcp.memweave` MCP endpoint for the user — OpenCode does not
  call a plugin `config` hook, and the plugin's `.mcp.json` is only loaded
  by `oh-my-openagent` (which depends on Claude Code's plugin DB at
  `~/.claude/plugins/installed_plugins.json` — usually absent). Users must
  hand-add the `mcp.memweave` block to `opencode.json` with `type: "remote"`
  (the only type OpenCode's Effect schema accepts for remote MCP servers).
- **`packages/codex-plugin/`** — OpenAI Codex plugin (v0.5.3+). Pure-config
  plugin (no SDK, no runtime code) shipped as a directory installable via
  `codex plugin install`. Auto-exposes the 10 `memory_*` MCP tools through
  Codex's MCP HTTP transport (`.mcp.json` uses `type: "http"` — Codex's
  schema, NOT OpenCode's `type: "remote"`), and writes the last assistant
  message back to the server via a `Stop` lifecycle hook
  (`hooks/stop.mjs`, cross-platform Node; `.sh` / `.cmd` are thin wrappers).
  Idempotent on `(sessionId, messageId)` where `messageId = sha256(sessionId
  + "turn-" + turnId + assistantContent)`. Requires `@mem-weave/server@0.5.3+`
  (the `SourceClient` enum gained `'codex'` in v0.5.3).
- **`web/`** — React 18 + Vite admin UI ("Calm Memory Atlas"). Browsing,
  searching, debugging, and operating the memory system.

The previous standalone `@mem-weave/mcp` package (stdio MCP) was retired in
v0.4.0 in favour of the embedded Streamable HTTP endpoint. Do not reintroduce
it.

## STRUCTURE

```
memweave/
├── packages/
│   ├── server/                       # @mem-weave/server (npm, bin: memweave)
│   │   └── src/
│   │       ├── cli-entry.ts          # `memweave` bin entry
│   │       ├── cli.ts                # Argv parser → commands/
│   │       ├── commands/             # 11 subcommands (start, stop, init, …)
│   │       ├── core/                 # Zod enums + config loader + decay model
│   │       ├── db/                   # SQLite schema + 9 repositories
│   │       ├── retrieval/            # 4-layer search (BM25/vector/graph/causal) + RRF
│   │       ├── injection/            # XML/text bundler for LLM prompt injection
│   │       ├── rest/routes/          # Fastify routes (8 files, /api/v1/*)
│   │       ├── mcp/                  # **EMBEDDED MCP server** (Streamable HTTP, /mcp)
│   │       │   ├── index.ts          # Fastify → fetch bridge; POST/GET/DELETE /mcp
│   │       │   ├── service.ts        # In-process service (talks to repos/retrieval/workers)
│   │       │   ├── registry.ts       # Registers the 10 memory_* tools on a McpServer
│   │       │   └── tools/            # 10 tools (memory_save / memory_recall / …)
│   │       ├── prompts/              # Compression / edge-extract / value-gate templates
│   │       ├── workers/              # Consolidation pipeline (6 files)
│   │       ├── server/               # HTTP bootstrap + scheduler + auth + rate-limiter + logger
│   │       ├── providers/            # Embedding (openai/xenova/noop) + LLM (openai/noop)
│   │       └── types/                # Ambient .d.ts for optional deps (xenova)
│   └── opencode-plugin/              # @mem-weave/opencode-plugin (npm)
│       └── src/
│           ├── index.ts              # MemweaveInjectPlugin (4 hooks: config/event/system.transform/tool.before)
│           └── client.ts             # MemweaveInjectClient (POST /inject, /sessions, /observations)
│   └── codex-plugin/                 # @mem-weave/codex-plugin (directory, NOT published)
│       ├── .codex-plugin/
│       │   └── plugin.json           # Codex manifest
│       ├── .mcp.json                 # type: "http" → http://127.0.0.1:3131/mcp
│       ├── hooks/
│       │   ├── hooks.json            # Stop event binding
│       │   ├── stop.mjs              # Cross-platform Node: stdin → POST sessions + observations
│       │   ├── stop.sh               # Unix thin wrapper → stop.mjs
│       │   └── stop.cmd              # Windows thin wrapper → stop.mjs
│       ├── README.md                 # Install + usage
│       └── package.json              # Metadata only (private, not published)
├── scripts/
│   ├── publish.mjs                   # One-shot build + publish for the 2 npm packages
│   ├── sync-web-dist.cjs             # Sync web build → installed server dist (see "Web build sync" below)
│   └── playwright-verify-graph.mjs   # Playwright + msedge verifier for GraphPage layout
├── web/                              # React 18 + Vite admin UI (7 pages + 7 CSS modules)
│   └── src/{pages,components,api,lib,theme}/
├── tests/                            # Server vitest tests
├── web/tests/                        # Frontend vitest tests (happy-dom)
├── docs/                             # Design specs in docs/superpowers/specs/
├── dist/                             # Build output (tsc + Vite → dist/web/)
├── scripts/publish.mjs               # One-shot build + publish for the 2 npm packages
└── memweave.config.jsonc             # Generated by `memweave init`
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Add a new memory type / tier | `packages/server/src/core/types.ts` | Zod enum — single source of truth |
| Add a DB column | `packages/server/src/db/schema.ts` | Add via `ALTER TABLE` in `migrate` command; do not edit SCHEMA_SQL in place |
| Add a REST endpoint | `packages/server/src/rest/routes/` | One file per resource; register in `server/http.ts` |
| Add an MCP tool | `packages/server/src/mcp/tools/` | Implement, then register in `packages/server/src/mcp/registry.ts` |
| Add a CLI subcommand | `packages/server/src/commands/<name>.ts` | Export from `commands/index.ts` |
| Add a web page | `web/src/pages/` + `web/src/routes.tsx` | Co-locate `.module.css` |
| Change design tokens | `web/src/theme/tokens.css` | CSS custom properties; light + dark variants |
| Tune retrieval weights | `packages/server/src/retrieval/fusion.ts` | RRF K + per-layer weights |
| Extend consolidation pipeline | `packages/server/src/workers/` + `workers/consolidator.ts` | |
| Change the OpenCode plugin's hooks | `packages/opencode-plugin/src/index.ts` | `config` / `event` / `system.transform` / `tool.execute.before` |

## CODE MAP (key symbols)

| Symbol | File | Role |
|---|---|---|
| `loadConfig()` | `packages/server/src/core/config.ts` | Reads `memweave.config.jsonc`; env override `MEMWEAVE_CONFIG` |
| `SCHEMA_SQL` | `packages/server/src/db/schema.ts` | Idempotent DDL; `journal_mode=WAL`, FKs ON |
| `searchMemories()` | `packages/server/src/retrieval/search-engine.ts` | 4-layer fusion orchestrator |
| `fuseResults()` | `packages/server/src/retrieval/fusion.ts` | RRF (Reciprocal Rank Fusion) |
| `createHttpServer()` | `packages/server/src/server/http.ts` | Fastify app factory; mounts `/mcp` |
| `buildMcpHandler()` | `packages/server/src/mcp/index.ts` | Per-request MCP transport over Fastify |
| `McpService` | `packages/server/src/mcp/service.ts` | In-process service for the 10 tools |
| `startConsolidationScheduler()` | `packages/server/src/server/scheduler.ts` | 6h interval, runs on start |
| `MemweaveInjectPlugin` | `packages/opencode-plugin/src/index.ts` | 4-hook OpenCode plugin: config-injects `mcp.memweave` + auto-write closure |
| `MemweaveInjectClient` | `packages/opencode-plugin/src/client.ts` | HTTP client (`/inject`, `/sessions`, `/observations`) |
| `buildBundle()` | `packages/server/src/injection/bundler.ts` | Token-budgeted XML packager |
| `runCommand()` | `packages/server/src/commands/index.ts` | CLI dispatch |

## CONVENTIONS

- **TypeScript strict ESM** (`"type": "module"`, `module: NodeNext`). All imports use `.js` suffix even for `.ts` files.
- **Zod-first types**: every enum (`MemoryType`, `MemoryTier`, `EdgeType`, `SourceClient`, etc.) lives in `packages/server/src/core/types.ts` as a Zod schema; types are inferred.
- **One file per route/tool/command**: each REST route, MCP tool, and CLI subcommand is its own file. `index.ts` files re-export.
- **Idempotent schema**: `SCHEMA_SQL` uses `IF NOT EXISTS`. To migrate, add a `migrations/` step (currently a `migrate` command runs the schema verbatim).
- **No external LLM required**: `embedding.dimensions: 0` disables the vector layer; `providers/llm/noop.ts` makes consolidation a pure rule-based pass.
- **Multi-tenant by default**: every repository method takes `tenantId`; `auth.ts` middleware validates API key against `tenants.api_key_hash`.
- **Idempotent write endpoints**: the OpenCode plugin may retry (restarts, network blips). `POST /api/v1/sessions` is idempotent on `sessionId`; `POST /api/v1/observations` is idempotent on `(sessionId, messageId)` via the JSON envelope in `tool_input`.
- **Two publishable packages**: `@mem-weave/server` and `@mem-weave/opencode-plugin`. The standalone `@mem-weave/mcp` is **retired** — do not recreate it. The Codex plugin (`packages/codex-plugin/`) is a **directory**, not an npm package — install via `codex plugin install <path>`.

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** add `as any` / `@ts-ignore` — strict TS is enforced in CI-equivalent (`npm run typecheck`).
- **NEVER** edit `dist/` by hand — it's the tsc + Vite output. Run `npm run build` instead.
- **NEVER** call the SQLite DB outside `packages/server/src/db/repositories/*`. The rest of the codebase talks to repositories only.
- **NEVER** import from `dist/` — it's build output, not a dependency.
- **NEVER** run the OpenCode plugin (`packages/opencode-plugin/`) in the same process as the server — the plugin uses `@opencode-ai/plugin` which expects to run inside OpenCode's hook context.
- **NEVER** reach for a separate MCP package — the MCP server lives at `packages/server/src/mcp/` and is exposed at `/mcp` over Streamable HTTP. `POST /mcp` accepts a single JSON object **or** newline-delimited JSON (the Fastify bridge reads `req.raw` directly; the global content-type parser stays default for the REST routes).
- **NEVER** introduce a different web framework — Vite + React 18 is the only frontend stack.
- **NEVER** ship a plugin that spawns child processes. The plugin's `event` hook must stay in-process and call the server over HTTP. (The pre-v0.4 attempts to spawn `@mem-weave/mcp` were removed for compatibility reasons.)

## UNIQUE STYLES

- **"Calm Memory Atlas"** is the project's design language: warm-paper light theme (`#F7F4EE`) + sage-green accent (`#3B7C6E`). See `web/src/theme/tokens.css`.
- **Tier-based memory lifecycle**: `short` → `medium` → `long` via consolidation. Decay modeled in `packages/server/src/core/decay.ts` (tau + reinforcement_score).
- **Edge type vocabulary** (`packages/server/src/core/types.ts`): `causes`, `enables`, `contradicts`, `supersedes`, `references`, `related_to`, `before`, `after`, `duplicates`, `refines` — design §10.6 colors are defined in `tokens.css`.
- **RRF fusion** (not learned reranking): `packages/server/src/retrieval/fusion.ts` uses Reciprocal Rank Fusion with configurable K (default 60).
- **Plugin is fail-silent**: every network call in `packages/opencode-plugin/src/index.ts` is wrapped in `try/catch`; a MemWeave outage never breaks the agent.
- **Plugin does NOT register `mcp.memweave`**. OpenCode does not call a plugin `config` hook (see [opencode.ai/docs/plugins/](https://opencode.ai/docs/plugins/) — the documented hooks are `event`, `tool.execute.before` / `after`, `command.executed`, `shell.env`, `tool`, `experimental.session.compacting`; `config` is in the d.ts but never invoked). The user must hand-add the `mcp.memweave` block to `opencode.json` once. `type` **must** be `"remote"` — OpenCode's Effect schema only accepts `"remote"` (silently drops `"http"` / `"sse"`).
- **Plugin ships a `.mcp.json`** as a backup path via `oh-my-openagent`. Not reliable — oh-my-openagent's Claude Code plugin loader depends on `~/.claude/plugins/installed_plugins.json` (Claude Code's plugin DB), which most users don't have.
- **Plugin `event` hook is the write side**: every `message.updated` event triggers an `ocClient.session.messages()` reverse-query followed by `POST /sessions` + `POST /observations`. Idempotent at the server end.

## COMMANDS

```bash
# Setup
npm install
npm run cli -- init                # creates memweave.config.jsonc + data dir

# Dev
npm run dev                        # builds web + starts server on :3131
npm run web:dev                    # Vite HMR on :5173 (proxies /api → :3131)

# Build
npm run build                      # web → dist/web/ + tsc → dist/
npm run typecheck                  # tsc --noEmit (server + plugin)

# Test
npm test                           # server vitest (requires server autostart)
cd web && npm test                 # frontend vitest (happy-dom)

# CLI (after `npm install -g @mem-weave/server`)
memweave start                     # foreground
memweave stop                      # via PID file
memweave doctor                    # health self-check

# Background (Windows / PowerShell)
Start-Process -WindowStyle Hidden memweave start
```

## NOTES

- **Default port**: 3131 (configurable in `memweave.config.jsonc → server.port`).
- **Web UI 503?** Means the server can't find `dist/web/` — run `npm run web:build`.
- **Web build sync** (v0.5.3+): `npm run web:build` writes to **two**
  locations atomically: the source tree's `dist/web/` (used by
  `npm run dev`) AND the installed `@mem-weave/server`'s
  `dist/web/` (used by the globally-installed server). The
  `scripts/sync-web-dist.cjs` script does the second copy. This
  matters because the server resolves the static root as
  `resolve(here, '../../dist/web')` where `here` is its own
  installed location — NOT the source tree. If you skip the
  sync, browser refreshes will see the **old** bundle even after
  rebuilding. See commit `36c747c` for the bug history.
- **Vector layer optional**: `embedding.dimensions: 0` skips sqlite-vec entirely; falls back to BM25 + graph + causal.
- **MCP endpoint**: `POST/GET/DELETE http://127.0.0.1:3131/mcp` (Streamable HTTP). Any MCP client (OpenCode, Claude Desktop, custom) can connect.
- **Git history**: this is a fresh checkout; commit/branch conventions not yet established.
- **Docs**: design specs live in `docs/superpowers/specs/`. The README is the canonical feature overview; CHANGELOG.md tracks per-version deltas.
