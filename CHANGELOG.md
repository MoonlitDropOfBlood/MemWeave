# Changelog

All notable changes to MemWeave will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Published packages (since v0.2.0):

- [`@mem-weave/server`](https://www.npmjs.com/package/@mem-weave/server) — Fastify + SQLite server + CLI
- [`@mem-weave/mcp`](https://www.npmjs.com/package/@mem-weave/mcp) — stdio MCP server (10 `memory_*` tools)
- [`@mem-weave/opencode-plugin`](https://www.npmjs.com/package/@mem-weave/opencode-plugin) — OpenCode plugin (auto-injection + auto MCP registration)

Tags next to a bullet name the affected package(s) when only a subset of the
three changed: `[server]`, `[mcp]`, `[opencode-plugin]`. Untagged bullets
touch all three (or core/shared infrastructure).

---

## [Unreleased]

_No changes yet._

---

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
