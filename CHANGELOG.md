# Changelog

All notable changes to MemWeave will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Published packages (since v0.2.0):

- [`@mem-weave/server`](https://www.npmjs.com/package/@mem-weave/server) — Fastify + SQLite server + CLI + **embedded MCP** at `/mcp` (Streamable HTTP) + 10 `memory_*` tools
- [`@mem-weave/opencode-plugin`](https://www.npmjs.com/package/@mem-weave/opencode-plugin) — OpenCode plugin (auto-injection + auto MCP registration + **write-side closure**)

> **Note**: the standalone `@mem-weave/mcp` package was retired in v0.4.0.
> The MCP server is now embedded in `@mem-weave/server` and exposed at
> `/mcp` over Streamable HTTP — no separate package to install.

Tags next to a bullet name the affected package(s) when only a subset of the
two changed: `[server]`, `[opencode-plugin]`. Untagged bullets
touch both (or core/shared infrastructure).

---

## [Unreleased]

_No changes yet._

---

## [0.4.3] — 2026-06-16

### Changed — [@mem-weave/opencode-plugin]

- **`.mcp.json` `type` reverted to `"remote"`** (was `"http"` in 0.4.2). The
  `type: "http"` value worked in the Claude Code / oh-my-openagent
  `.mcp.json` convention but is silently dropped by OpenCode's own Effect
  schema, which only accepts `"remote"` for remote MCP servers. v0.4.2's
  `type: "http"` therefore produced no error but also no MCP registration
  when the plugin was used standalone. With `type: "remote"`, oh-my-openagent
  (when installed) reads the file and registers the endpoint.
- **README, AGENTS, and plugin AGENTS updated** to be explicit that the
  *reliable* MCP setup is the user hand-adding `mcp.memweave = { type: "remote", url }`
  to `~/.config/opencode/opencode.json`. The plugin's `.mcp.json` is kept
  as a backup path for users with oh-my-openagent + Claude Code's plugin
  DB installed, but most users won't have that.

### Migration from v0.4.2

If you already have `mcp.memweave = { type: "remote", ... }` in
`opencode.json`, you do not need to change anything. The user-actionable
fix is the type field — if you tried `type: "http"`, change it to
`type: "remote"` and restart OpenCode.

---

## [0.4.2] — 2026-06-15

### Added — [@mem-weave/opencode-plugin]

- **`.mcp.json` at the package root** so `oh-my-openagent` auto-registers
  the MemWeave remote MCP endpoint. oh-my-openagent's
  `loadPluginMcpServers()` reads each plugin's `<installPath>/.mcp.json`
  and registers the `mcpServers` block as
  `${pluginName}:${serverName}` (e.g.
  `@mem-weave/opencode-plugin:memweave`). This eliminates the need for
  users to hand-edit `~/.config/opencode/opencode.json` to add an `mcp`
  block — the standard Claude Code plugin contract for shipping MCP
  servers with a plugin, supported by oh-my-openagent's
  claude-code-plugin-loader.

### Migration from v0.4.1

If you have oh-my-openagent installed: no changes required. Restart
OpenCode and the MemWeave MCP server will be auto-registered. You can
optionally **remove** the hand-added `mcp.memweave` block from
`opencode.json` since the plugin now ships its own.

If you don't have oh-my-openagent: continue to hand-add the
`mcp.memweave` block to `opencode.json` — this version doesn't help
those users (they need either oh-my-openagent or a hand-edit).

---

## [0.4.1] — 2026-06-15

### Fixed — [@mem-weave/opencode-plugin]

- **The plugin's `config` hook was dead code.** OpenCode's documented
  plugin hooks ([opencode.ai/docs/plugins/](https://opencode.ai/docs/plugins/))
  do NOT include `config` — only `event`, `tool.execute.before` /
  `after`, `command.executed`, `shell.env`, `tool` (custom tool), and
  `experimental.session.compacting`. The `Hooks.config` field exists in
  the `@opencode-ai/plugin` types but is never invoked by the runtime.
  As a result, the v0.4.0 "force-inject `mcp.memweave = remote`"
  behavior never actually mutated OpenCode's config, and OpenCode
  reported `server unavailable key=memweave type=local status=failed`
  because it tried to spawn the plugin as a stdio MCP server (it has
  no `bin` field).
- **Plugin now warns at boot** via `client.app.log({ level: 'warn' })`
  if the user has not added the `mcp.memweave` block to
  `~/.config/opencode/opencode.json`. The warning includes the exact
  JSON snippet to add.
- **The plugin no longer tries to write `mcp.memweave` from a `config`
  hook** — that hook is no longer exported from the plugin. Users
  MUST hand-add the `mcp` block to `opencode.json` (this is the same
  workflow the README documents).

### Migration from v0.4.0

No code changes are required from users who already have `mcp.memweave`
in `opencode.json`. Users who relied on the (non-functional) v0.4.0
"auto-inject" promise need to hand-add the `mcp` block once:

```jsonc
"mcp": {
  "memweave": {
    "type": "remote",
    "url": "http://127.0.0.1:3131/mcp",
    "enabled": true
  }
}
```

---

## [0.5.0] — 2026-06-15

### Breaking changes

- **[server] Standalone `@mem-weave/mcp` package retired.** The MCP
  server is now embedded inside `@mem-weave/server` and exposed at
  `/mcp` over Streamable HTTP (MCP 2025-03-26). Users no longer
  install a separate MCP package; clients point at the running
  server's `/mcp` endpoint. The old `@mem-weave/mcp` package was
  unpublished from npm.
- **[opencode-plugin] `mcp.memweave` is now force-injected.** The
  plugin's `config` hook overwrites any user-supplied `mcp.memweave`
  entry. Users no longer hand-edit `~/.config/opencode/opencode.json`
  to add an `mcp` block — the plugin does it on every OpenCode boot.
  Other MCP servers in the `mcp` block are preserved.

### Added

- **[server] `POST /api/v1/sessions`** (`packages/server/src/rest/routes/sessions.ts`).
  Idempotent on `sessionId`: returns `201 + { created: true }` the first
  time, `200 + { created: false }` thereafter. Body:
  `{ sessionId, source: "opencode"|"cursor"|"claude_code"|"rest_api", title, deviceId? }`.
  Lets the OpenCode plugin (and any other client) safely retry a session
  upsert without growing duplicates.
- **[server] `POST /api/v1/observations`** (`packages/server/src/rest/routes/observations.ts`).
  Idempotent on `(sessionId, messageId)`. Body:
  `{ sessionId, messageId, hookType: "chat.user"|"chat.assistant"|"chat.tool", text, toolName?, toolInput?, toolOutput? }`.
  `messageId` is stashed in the existing `tool_input` column as a JSON
  envelope (`{ "messageId": "...", "toolName": "..." }`) so the lookup
  can use a deterministic `LIKE '%"messageId":"..."%'` — no schema
  migration needed. The chat body lives in `tool_output`.
- **[server] `SessionRepo.findOrCreate()`** and **`ObservationRepo.createOrGetByMessageId()`**
  (idempotency helpers). The latter is backed by a new
  `findByMessageId()` method that does the LIKE search; no new
  index required.
- **[opencode-plugin] `event` hook closes the write loop.** The
  plugin now listens to OpenCode's `message.updated` event bus,
  reverse-queries the OpenCode SDK (`input.client.session.messages`)
  for the full `Part[]` text of the message, and POSTs both a session
  upsert and an observation upsert to the server. Every completed
  user + assistant turn lands in `observations` automatically.
  High-signal observations are promoted to long-term memories by the
  consolidation worker on its next tick.
- **[opencode-plugin] `MemweaveInjectClient.reportSession()` and
  `reportObservation()`** (`packages/opencode-plugin/src/client.ts`).
  Plain `fetch` wrappers with the same `AbortSignal.timeout` as
  `requestInjection()`. No new error type — failures fall through to
  the plugin's `try/catch` and silently no-op.
- **[opencode-plugin] `config` hook force-injects the remote MCP**
  (`packages/opencode-plugin/src/index.ts`). The plugin captures the
  host OpenCode's `client` from `PluginInput` and uses it both to
  force-register `mcp.memweave = { type: "remote", url: MEMWEAVE_URL
  + "/mcp", enabled: true }` and to reverse-query session messages
  in the `event` hook.

### Changed

- **[server] README rewritten for v0.5.** Both `README.md` (Chinese) and
  `README.en.md` (English) now document: the `npx`-based and global
  install paths side-by-side, the new `Start-Process -WindowStyle Hidden
  memweave start` for Windows background, the obsolete-package warning
  about `@mem-weave/mcp`, and the opencode.json snippet reduced to just
  `"plugin": ["@mem-weave/opencode-plugin"]` (the `mcp` block is now
  plugin-managed).
- **[server] `packages/server/README.md` and `packages/server/README.en.md`**
  also updated. `scripts/publish.mjs` ships `README.md` + `README.en.md`
  inside the npm tarball so users discover the docs after `npm i`.

### Fixed

- **[server] Global `application/json` content-type parser regression
  (`packages/server/src/server/http.ts`)** — the MCP permissive
  parser previously installed at the Fastify level (so the `/mcp`
  bridge could accept NDJSON) was clobbering the default JSON parser
  for **all** REST routes, so Zod validation saw `string` instead of
  `object` for every `POST` body. The MCP handler now reads
  `req.raw` directly; the global parser is back to the Fastify
  default, and the regression is gone.

### Internal

- End-to-end verified by importing the **real compiled**
  `dist/index.js` of `@mem-weave/opencode-plugin@0.4.0` and driving
  it with a mock OpenCode SDK client that emits
  `message.updated` events. The plugin's `event` hook
  successfully POSTs `POST /api/v1/sessions` and
  `POST /api/v1/observations`; rows appear in the SQLite
  `observations` and `sessions` tables. Idempotency verified by
  re-firing the same `message.updated` event and confirming no
  duplicate row is created.

---

## [0.4.0] — 2026-06-15

### Added — [@mem-weave/opencode-plugin]

- **MCP server embedded in `@mem-weave/server` (Streamable HTTP).** The
  old `@mem-weave/mcp` npm package (10 `memory_*` tools over stdio)
  was **unpublished** in favour of an in-process MCP server exposed
  at `POST/GET/DELETE /mcp` (Streamable HTTP, MCP 2025-03-26 spec).
  Any client that supports Streamable HTTP can now connect to the
  running server with no separate install.
- **`config` hook force-injects `mcp.memweave = { type: "remote", url,
  enabled }`**. The plugin no longer relies on the user hand-editing
  `~/.config/opencode/opencode.json` to wire up the MCP endpoint —
  it does it on every OpenCode boot.
- **`@modelcontextprotocol/sdk@^1.29.0` added as a runtime
  dependency of `@mem-weave/server`**.

---

## [0.3.0] — 2026-06-14

### Added

- **[server] Web UI bundled into the npm tarball.** `scripts/publish.mjs`
  runs `npm run web:build` and copies `dist/web/` into
  `packages/server/dist/web/`, so `npm install -g @mem-weave/server`
  gives you the full "Calm Memory Atlas" UI on `/ui/` without a
  separate clone.
- **[opencode-plugin] Auto-install of the (since-retired) `@mem-weave/mcp`
  package** on first run, via `npm install --prefix <tmpdir>/memweave-mcp`.
  Removed in v0.4.0 when the standalone MCP package was retired.
- **[opencode-plugin] Plugin self-installs mcp to `<tmpdir>/memweave-mcp`
  on first use.** Removed in v0.4.0 for the same reason.

---

## [0.2.0] — 2026-06-13

## [0.2.0] — 2026-06-13

First release of the monorepo + the three published npm packages. This is
the version that ships `v0.2.0` of all three `@mem-weave/*` packages.

### Breaking changes

- **Repository restructured into a monorepo.** The single `src/` tree was
  moved into three independent packages under `packages/`. `tests/`,
  `web/`, `docs/`, and `scripts/` stay at the repo root.
  - `packages/server/`  → `@mem-weave/server` (bin `memweave`)
  - `packages/mcp/`     → `@mem-weave/mcp` (bin `memweave-mcp`)
  - `packages/opencode-plugin/` → `@mem-weave/opencode-plugin` (loaded by OpenCode)
- **[server] `memweave mcp` subcommand removed.** It used to delegate to the
  in-process MCP server. The MCP server is now a separate package — install
  `@mem-weave/mcp` and run its `memweave-mcp` bin directly. Running the old
  command now throws a clear migration error pointing at the new package.
- **[server] `CliCommand` enum no longer includes `'mcp'`.** The
  `Record<CliCommand, CommandHandler>` map in `commands/index.ts` is one
  key shorter.
- **Install instructions changed.** `npm run dev` / `npm run cli` /
  `npm run mcp` still work for in-repo development, but end users now
  `npm install -g @mem-weave/server @mem-weave/mcp` and run the global
  `memweave` / `memweave-mcp` bins.

### Added

- **Published npm packages** (the headline feature of v0.2.0):
  - `@mem-weave/server@0.2.0` — 52.5 kB tarball
  - `@mem-weave/mcp@0.2.0` — 5.4 kB tarball
  - `@mem-weave/opencode-plugin@0.2.0` — 4.7 kB tarball
- **One-shot publish script** `scripts/publish.mjs`: builds all three
  packages with `tsc`, runs `npm pack --dry-run` by default; pass
  `--publish` to actually run `npm publish` (in `server → mcp → opencode-plugin`
  order). Reads `NPM_TOKEN` from env or `~/.npmrc`; never stores the token
  in the script or in the repo.
- **Per-package `tsconfig.json`** with isolated `outDir` / `rootDir` /
  `include` so each package's `dist/` is a clean, ready-to-publish tree.
- **Per-package `README.md`** with install + usage + config examples for
  each of the three npm packages.
- **Progressive-disclosure closed loop** (the headline design change):
  the OpenCode plugin's `config` hook now registers `@mem-weave/mcp` with
  OpenCode at plugin-load time. OpenCode auto-connects, the 10 `memory_*`
  tools become available to the LLM as built-ins, and the LLM can call
  `memory_expand({ memoryId })` to fetch the full `content` field of a
  memory it saw in the injected summary-only XML. The closed loop is
  verifiable in OpenCode: any IDE/client that supports MCP gets the same
  behavior via the `memweave-mcp` bin.
- **Server-side write deduplication** in `MemoryRepo.create()`:
  1. BM25 query on the FTS5 index using the new input's `concepts`
     (same tenant, exclude soft-deleted) — sub-millisecond, zero
     embedding cost.
  2. Top-5 candidates → **Jaccard similarity** on concepts sets.
  3. Best Jaccard **≥ 0.8** AND `type` matches → it's a duplicate.
     Reinforce the existing memory instead of inserting a new row.
  Two reinforcement modes:
  - similar (length delta < 25%): bump `access_count` /
    `reinforcement_score` / `strength` / `last_reinforced_at`
  - meaningfully richer (length > 1.25× or higher importance): merge —
    upgrade content, union concepts, union files, take `max` of importance.
  `create()` still returns `MemoryRecord`; the dedup signal is exposed via
  a new `createDetailed()` returning
  `CreateResult { memory, deduped, reinforcedId }`.
- **Jaccard merge stage in the consolidation pipeline** (`workers/consolidator.ts`):
  in addition to evict + promote, the "sleep" cycle now has a merge stage
  that reuses the **same** Jaccard formula and threshold as the live
  write-side dedup. Two-layer defense: live dedup + background merge.
- **Process-wide consolidation mutex** (`workers/consolidator.ts`):
  `consolidationInFlight` boolean inside `runConsolidation` guarantees
  only one run per tenant. Background scheduler and manual
  `POST /api/v1/consolidate` never collide.
- **Input limits in `CreateMemoryInputSchema`** (`core/types.ts`):
  - `content` ≤ 100,000 chars
  - `concepts` ≤ 50
  - `files` ≤ 50

  A buggy or malicious LLM cannot insert 10 MB of body or 10k concept tags.
- **Write rate limiter** (`server/rate-limiter.ts`): one token bucket per
  API key, 30 writes/minute burst, 2/sec sustained.
  `POST /api/v1/memories` returns `429 Too Many Requests` + `Retry-After`
  header when over quota.
- **[opencode-plugin] Configurable plugin timeout**: `MEMWEAVE_PLUGIN_TIMEOUT`
  env var (was hard-coded to 10s). Default unchanged.
- **[opencode-plugin] MCP name collision guard** in the `config` hook:
  refuses to overwrite an existing `mcp["memweave"]` entry to avoid
  clobbering a user's hand-rolled config.
- **[opencode-plugin] Pending-file-packs + injected-cache TTL** (1 hour):
  the in-process maps that gate `file_pack` injection and the LRU that
  prevents re-injecting the same memory in a single session are now
  pruned on a timer so a long-running OpenCode session doesn't grow
  unbounded.
- **[mcp] Typed Zod response schemas** for all 8 user-facing tools
  (`SearchResponseSchema`, `MemoryResponseSchema`, `SaveResponseSchema`,
  `ExpandResponseSchema`, `GraphQueryResponseSchema`, `FileHistoryResponseSchema`,
  `SessionsResponseSchema`, `PatternsResponseSchema`, `ConsolidateResponseSchema`,
  `ForgetResponseSchema`). Tool outputs are now `z.infer<...>`-typed, so
  the IDE / tests can see the exact shape, and `safeParse` at the tool
  boundary catches schema drift between server and MCP client.
- **[mcp] UUID collision handling** in `save.ts`: if the LLM-provided
  `id` collides with an existing row, fall back to a fresh UUIDv4
  instead of 500-ing.
- **[opencode-plugin] Plugin smoke test** (`tests/plugin/index.test.ts`):
  loads the plugin's index module with a fake OpenCode client and
  asserts the `config` hook registers `mcp["memweave"]` + the
  `experimental.chat.system.transform` hook appends summary-only XML.
- **pino structured logging** (`server/logger.ts`): replaces 14
  `console.*` error sites across the codebase. `LOG_LEVEL` env var
  tunes verbosity (default `info`). JSON output is log-shipper-friendly
  (Loki, ELK, etc).
- **Dedup-reinforce audit log** (`db/repositories/memory-repo.ts`):
  when `reinforceExisting` fires, inserts a `source: 'dedup_reinforce'`
  row in `access_logs` so "this memory was reinforced" is auditable
  alongside regular retrievals.
- **Local ONNX embeddings** (`providers/embedding/local-xenova.ts`):
  `LocalXenovaEmbeddingProvider` built on `@xenova/transformers`, with
  dynamic import + automatic noop fallback (hash-based vector + one-time
  `console.warn`) if the model fails to load or inference times out.
  Marked as **optional dependency** in `@mem-weave/server`'s
  `optionalDependencies` so the npm install doesn't pull 30 MB of model
  weights by default.
- **Ambient type declarations** for `@xenova/transformers`
  (`packages/server/src/types/xenova.d.ts`) so the optional dep is
  typed when present and doesn't break `tsc` when absent.

### Changed

- **README rewritten** for the v0.2 monorepo layout. Both `README.md`
  (Chinese) and `README.en.md` (English) now document the three npm
  packages, the `memweave` / `memweave-mcp` global bins, and the
  `npx -y @mem-weave/mcp` Claude Desktop config snippet.
- **Root `package.json` rewritten as a private monorepo orchestrator.**
  `private: true`. Scripts now: `build:server`, `build:mcp`,
  `build:opencode-plugin`, `publish`, `publish:dry-run`. The old
  `npm run mcp` / `npm run cli` shims are gone (the proper way is now
  the published bins).
- **Root `tsconfig.json` updated**: `include` now covers
  `packages/**/*.ts` + `tests/**/*.ts` + `vitest.config.ts`.
- **`tests/global-setup.ts`**: bootstrap path updated to
  `packages/server/src/server/bootstrap.ts`. All test imports rewritten
  to point at the new `packages/<name>/src/...` layout.
- **[mcp] `MEMORY_LIMITS` constant inlined** in
  `packages/mcp/src/tools/save.ts` (was a stale import across package
  boundaries). The constant is duplicated by hand to keep
  `@mem-weave/mcp` from depending on `@mem-weave/server` (which would
  pull in `better-sqlite3` and other native deps into the lightweight
  MCP deployment).

### Removed

- **[server] `src/commands/mcp.ts`** — see "Breaking changes" above.
- **[server] `src/mcp/`** — moved to `packages/mcp/src/`.
- **[server] `src/plugin/`** — moved to `packages/opencode-plugin/src/`.

### Internal

- 144 files changed (+777 / −171) in the monorepo restructure commit.
- 25 files changed (+943 / −146) in the audit-gaps close commit.
- Tests: 37 files / 237 tests pass (up from 217 in v0.1; +20 tests for
  the audit gap fixes and +1 for the `mcp` removed-in-v0.2 error path).

---

## [0.1.0] — 2026-06-08

Initial public release. Pre-monorepo: a single Fastify + SQLite + MCP
server + OpenCode plugin, all in one `src/` tree. Features:

- 4-layer retrieval (BM25 + vector + graph + causal) with RRF fusion.
- Token-budgeted XML injection (4 phases: `session_start`,
  `prompt_delta`, `file_pack`, `failure_delta`).
- 10 MCP tools via stdio.
- OpenCode plugin (summary-only XML injection).
- 6-hour consolidation scheduler.
- React 18 + Vite "Calm Memory Atlas" web UI (7 pages).
- Multi-tenant with API-key auth.
- 217 tests across server + web (vitest + happy-dom).

The full v0.1 commit history is preserved in git; the v0.1 → v0.2
diffs are the two commits immediately above this entry
(`Restructure to monorepo with 3 publishable @mem-weave/* packages`
+ the audit-gap / progressive-disclosure / write-dedup /
typed-Zod-schemas chain).

[Unreleased]: https://github.com/Duke-Bit/mem-weave/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Duke-Bit/mem-weave/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Duke-Bit/mem-weave/releases/tag/v0.1.0

---

## Release process

```bash
# 1. Make sure NPM_TOKEN is set in your shell or ~/.npmrc.
# 2. Run the publish script (dry-run first).
node scripts/publish.mjs --dry-run
node scripts/publish.mjs --publish
# 3. Tag the release in git.
git tag -a v0.X.Y -m "v0.X.Y"
git push origin v0.X.Y
# 4. Append a new section to this file with the date, and update
#    the [Unreleased] link at the bottom.
```
