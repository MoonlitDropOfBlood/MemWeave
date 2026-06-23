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

### Added — Mavis plugin + Codex plugin parity

- **MemWeave for Mavis (mavis)** — `packages/mavis-plugin/` (new package, v0.5.0)
  - Pure-config directory-style CC marketplace plugin (no build step, no
    npm publish). Mirrors the opencode-plugin / codex-plugin feature
    surface: 10 `memory_*` MCP tools auto-loaded via `.mcp.json`, plus
    three hooks — `UserPromptSubmit` (user message writeback +
    `prompt_delta` injection), `PreToolUse` (file-touching tools →
    `file_pack` injection), `Stop` (assistant message writeback).
  - Install: copy or symlink into the Mavis plugin loader. Locally:
    `mavis plugin install /path/to/MemWeave/packages/mavis-plugin`. The
    daemon's `mavis plugin list` shows `memweave@memweave-local` once
    installed. See `packages/mavis-plugin/README.md` for the agent-side
    hook wiring (Mavis loads hooks from
    `~/.mavis/agents/mavis/hooks/*.md`, not from the CC marketplace
    `hooks/hooks.json`).
  - Server's `SourceClient` enum gained `'mavis'` (gated by
    `@mem-weave/server` v0.6.0; the `POST /api/v1/sessions` route's
    zod schema was updated in lockstep).

- **Codex plugin upgrade** — `packages/codex-plugin/` v0.5.4 → v0.6.0
  - Adds `UserPromptSubmit` (user message writeback + `prompt_delta`
    injection) and `PreToolUse` (file_pack injection) hooks, bringing
    feature parity with the opencode-plugin and the new mavis-plugin.
  - `Stop` hook unchanged in behaviour but now shares `hooks/_lib.mjs`
    with the new hooks (HTTP client + helpers deduplicated).
  - New test fixtures: `fixtures/user-prompt.json`,
    `fixtures/pretool-read.json`, plus matching `package.json` scripts
    (`test:prompt-inject`, `test:file-pack`, `test:writeback`).

### Added — Codex plugin

- **MemWeave for OpenAI Codex** — `packages/codex-plugin/`
  - Ships `.codex-plugin/plugin.json` manifest + `.mcp.json` pointing
    at the running `@mem-weave/server`'s `http://127.0.0.1:3131/mcp`
    endpoint, so Codex auto-loads the 10 `memory_*` tools
  - `Stop` lifecycle hook (`hooks/stop.mjs`, cross-platform Node;
    `hooks/stop.sh` / `hooks/stop.cmd` are thin wrappers) that
    upserts the session and writes the last assistant message as an
    idempotent observation
  - Install: `codex plugin install /path/to/MemWeave/packages/codex-plugin`
  - Full design spec: `docs/superpowers/specs/2026-06-16-codex-plugin-design.md`
  - **v0.5.4**: Stop hook now stamps `scopes: [{ key: 'project', value: cwd }]`
    on every observation, so the consolidation worker inherits the
    project tag onto the promoted memory. Cross-project isolation
    now works for Codex just like it does for OpenCode.

---

## [0.6.0] — 2026-06-23

### Added — [@mem-weave/server]

- **`SourceClient` enum gained `'mavis'`** — the
  `POST /api/v1/sessions` route's zod schema (and the underlying
  `SourceClientSchema` in `core/types.ts`) now accepts `mavis` as a
  valid `source` value. Required by the new
  [`packages/mavis-plugin/`](../packages/mavis-plugin/) (a CC
  marketplace directory-style plugin for the Mavis `mavis` agent)
  which tags every session row with `source: 'mavis'`. Rollback:
  revert the enum to its v0.5.7 list — the route's validation
  error messages enumerate the current valid set, so the source of
  truth is in the schema.

---

## [0.5.7] — 2026-06-18

### Changed — [@mem-weave/server]

- **`memweave start` is now a background (daemon) command.**
  The default `start` invocation detaches to a child process and
  exits immediately; closing the parent terminal does **not** stop
  the server. This replaces the legacy
  `Start-Process -WindowStyle Hidden memweave start` workaround
  documented in earlier READMEs (it was a Windows-only hack and
  didn't survive some shell teardown paths).

  **New behavior:**

  - `memweave start` — spawns a detached child, writes its PID to
    the system temp dir, returns the PID + log path, exits. The
    child runs under its own process group, so closing the
    launching terminal does not affect it (verified on Windows
    + Powershell + cmd).
  - `memweave start -f` / `memweave start --foreground` — run
    inline in the current terminal; useful for `tail -f` style
    debugging. Output still goes to the log file.
  - `MEMWEAVE_FOREGROUND=1` env var — same as `--foreground`.
  - `MEMWEAVE_FOREGROUND=0` env var — force daemonize even if
    `--foreground` is in argv (the detached child sets this
    internally to keep its own behavior deterministic).

  **Already-running guard:** `start` reads the PID file, checks
  if the recorded PID is alive (`process.kill(pid, 0)`), and
  refuses to start a second instance with a clear error pointing
  at the existing PID. Stale PID files are cleaned up
  automatically.

  **New log file:** `<dataDir>/memweave.log` (default
  `~/.memweave/data/memweave.log`). The child's pino logger
  and the cli-entry's banner write go there in append mode. The
  parent's stdout only gets a one-line status message — the
  heavy log stream lives in the file.

  **Implementation notes:**

  - Self-spawn via `child_process.spawn(process.execPath, [...],
    { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true })`
    followed by `child.unref()`. No new dependencies; pure Node stdlib.
  - The child re-execs the same `dist/cli-entry.js start
    --foreground` so the actual server bootstrap is identical to
    the pre-v0.5.7 code path.
  - On Windows, `detached: true` puts the child in a new process
    group; `windowsHide: true` suppresses the brief console flash.
    On POSIX, `detached: true` + `unref()` is the standard idiom
    for a true daemon.

### Migration from v0.5.6

If you previously launched with `Start-Process -WindowStyle Hidden
memweave start` (or relied on `start` running inline), nothing
breaks — `start` still does what you want, but in a more
predictable way. Scripts that did:

```powershell
Start-Process -WindowStyle Hidden memweave start
```

can be simplified to just:

```powershell
memweave start
```

If you need the inline behavior (e.g., for a debugger to attach),
add `-f`:

```powershell
memweave start -f
```

If you have a `tail -f` workflow on the server's stderr, point it
at `~/.memweave/data/memweave.log` instead.

---

## [0.5.6] — 2026-06-18

### Changed — [@mem-weave/server], [@mem-weave/opencode-plugin]

- **Move `onlyBuiltDependencies` to per-package `package.json`.**
  The list of native packages allowed to run install scripts
  (`better-sqlite3`, `sharp`, `protobufjs`) is now declared in
  each published package's `package.json`, **not** the root
  monorepo `package.json`. This is the version of the config
  that npm consults when the user runs
  `npm install -g @mem-weave/server` or
  `npm install -g @mem-weave/opencode-plugin` directly,
  so the `--allow-scripts=...` warning no longer fires for
  the standard install command.

  `npm install` from the source tree still works the same way
  (root `package.json` also has the list, so the workspace-level
  install is a no-op for these three packages).

### Migration from v0.5.5

No action required. The new install command is just:

```bash
npm install -g @mem-weave/server @mem-weave/opencode-plugin
```

No more `--allow-scripts=...` flag.

---

## [0.5.5] — 2026-06-18

### Fixed — [@mem-weave/server]

- **The `event` type is no longer auto-promoted from raw chat
  turns.** v0.5.4 added two value-gate rules that auto-promoted
  any `chat.user` message > 50 chars and any `chat.assistant`
  message > 200 chars to a memory with `type: 'event'` and
  `source: 'agent_capture'`. As a result, every plugin-written
  message in 0.5.4 was promoted to a memory — and the memory
  table was 98% `event` rows (117 / 119 active memories in the
  user DB).

  This was a **category error**. An `event` memory should
  describe a discrete thing that happened in the world (a
  release, a build failure, a config change), not "the user
  said X" or "the assistant said Y". Raw conversation turns
  are not events. The right surface for converting a
  conversation into memories is the **agent itself**, calling
  the `memory_save` MCP tool with a proper `type`
  (`fact` / `decision` / `preference` / `lesson` / etc.).

  Fix: removed the two buggy rules from
  `workers/value-gate.ts`. The remaining gates (explicit
  "remember this" in the user message, architectural-decision
  patterns in the user message, tool failures for
  `post_tool_use` Bash) are kept — those *are* the kind of
  signal that justifies an auto-promoted memory.

  A one-time fix script is shipped:
  `scripts/fix-v054-event-bug.cjs`. It soft-deletes the
  0.5.4-era `event / agent_capture` memories, unlinks the
  associated observations, and resets them to
  `processed = 0`. A single consolidation run after the
  upgrade marks them `processed = 1` (the value-gate now
  rejects them). `--dry-run` shows the affected rows before
  the delete. After running, the only memories left in the
  user DB are the two `fact / user_explicit` rows the user
  had typed explicitly via the MCP tool.

  End-to-end verified: 117 buggy memories soft-deleted, 117
  observations marked `processed = 1` (none promoted), only
  2 `fact / user_explicit` memories remain (the only ones
  the user actually typed via the MCP tool).

### Migration from v0.5.4

```bash
# One-time, after upgrading to v0.5.5:
node scripts/fix-v054-event-bug.cjs --dry-run    # see what would be removed
node scripts/fix-v054-event-bug.cjs             # actually remove
node scripts/sync-web-dist.cjs                   # if you serve the Web UI from the installed server
POST /api/v1/consolidate                         # drain the unlinked observations
```

---

## [0.5.4] — 2026-06-17

### Fixed — [@mem-weave/server]

- **The consolidation worker now actually promotes observations to
  memories.** Prior to v0.5.4, the OpenCode and Codex plugins wrote
  to the `observations` table on every message, and the README +
  CHANGELOG claimed "the consolidation worker promotes
  high-signal observations to long-term memories" — but that path
  **was never wired up**. The consolidator only ran
  evict / promote-tier / merge against the `memories` table. After
  a long session, the user would see 200+ observations and 2
  memories, and `memory_recall` returned nothing because it
  searches `memories` not `observations`.

  Fix: new `promoteObservationsToMemories()` phase 0 in the
  consolidator pipeline. Runs before evict/promote/merge, so
  newly-created memories participate in the same eviction +
  merge passes on the same run. Marks every observation it
  touches as `processed = 1` (including rejected ones) so the
  next run does not re-evaluate noise. Uses `MemoryRepo.create()`
  so the write-side dedup gate (BM25 + Jaccard + verbatim match)
  applies — duplicate observations collapse to a single
  reinforced memory.

  Also fixed the value-gate (`workers/value-gate.ts`):
  - Recognized `chat.user` / `chat.assistant` hook types (the
    names the v0.4+ plugins actually emit). The old code only
    matched `prompt_submit` / `post_tool_use` (Claude Code
    legacy names) so 100% of plugin observations were rejected.
  - Promotes `chat.assistant` with `tool_output >= 200 chars`
    (the long-form assistant responses that are worth keeping).

### Added — [@mem-weave/server]

- **`observations.scopes_json` column + migration helper.**
  Project scoping for memories is now end-to-end:
  - Schema gets `scopes_json TEXT NOT NULL DEFAULT '[]'`
  - `openDatabase()` runs `addColumnIfMissing` for DBs created
    before v0.5.4 (SQLite 3.35+ does NOT support
    `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so the
    existence check is in code)
  - `POST /api/v1/observations` accepts a `scopes` array
  - Consolidator **inherits** observation scopes onto the
    promoted memory + auto-detects `scope_level: 'project'`
    when any scope tag is `key: 'project'`
  - `GET /api/v1/memories?scope.project=...` already worked
    (search engine's `matchesScope`); now there are actually
    scoped memories to find

### Added — [@mem-weave/opencode-plugin]

- **Observations now carry a `project` scope tag** derived from
  `process.cwd()`. Different projects in different directories
  will produce memories tagged with different `project` values,
  so the Web UI's project filter (and the search engine's
  `scope.project=...` query param) can keep them apart. Same
  process cwd = same project; OpenCode restarts in the same
  cwd produce idempotent observations (still keyed on
  `(sessionId, messageId)`).

### Migration

- Existing DBs: `openDatabase` adds `observations.scopes_json`
  with default `'[]'`, so existing observations appear
  un-scoped (global). No re-classification.
- Existing memories: untouched. New plugin-write cycle will
  create project-scoped memories from this point on.
- The v0.5.4 consolidator will mark **all** pre-existing
  unprocessed observations as processed in 1-2 runs
  (LIMIT 200/run), so the first time you trigger consolidation
  after upgrading, expect a large `promoted` count. After that
  it settles to whatever the plugin emits per session.

---

### Added — [@mem-weave/server]

- **New `source` value: `codex`.** The `SourceClient` enum
  (`packages/server/src/core/types.ts`) now includes `'codex'`
  alongside `'opencode' | 'cursor' | 'claude_code' | 'rest_api'`.
  This is required by the new Codex plugin so that
  `POST /api/v1/sessions` with `{ source: "codex" }` passes Zod
  validation. No DB schema change (the `sessions.source` column is
  `TEXT` with no CHECK constraint), no migration needed.

### Migration from v0.5.2

No action required. The new value is purely additive — existing
callers using any of the original four source values still work
unchanged.

---

## [0.5.2] — 2026-06-16

### Fixed — [@mem-weave/server]

- **Memory dedup now catches the empty-concepts case.** The previous
  dedup gate (FTS5 BM25 + Jaccard on concepts) **silently bypassed**
  any call to `memory_save` that passed `concepts: []` — which is the
  default for the MCP `memory_save` tool, the OpenCode plugin's
  write-side closure, and any scripted automation. Result: the same
  memory could be inserted N times verbatim.

  The dedup logic now has two tiers:
  1. **Tier 1 (new)**: exact content match after whitespace
     normalization, scoped to the same tenant + type. Catches the
     "same fact re-saved verbatim" case regardless of concepts.
  2. **Tier 2 (unchanged)**: BM25 over `memory_fts` using the input's
     concepts as the query, then Jaccard >= 0.8 on the candidate
     concepts set. Still the smart path for clients that supply
     good concepts.

  Both tiers require the same `type` (a "fact" is never a
  duplicate of a "decision").

### Migration from v0.5.1

No action required. The behavior change is purely additive: any
caller that was already supplying good concepts still gets
Jaccard-based dedup; callers that were bypassing dedup entirely
(usually because `concepts: []`) now get exact-content dedup.

End-to-end verified: 3 consecutive `memory_save` calls with the
same `content` and `concepts: []` now all return the same memory id
(tier-1 hit, the existing memory is reinforced). The
@mem-weave/opencode-plugin@0.4.2 write-side closure therefore
no longer creates duplicate observations on OpenCode restart.

### Database cleanup

Existing duplicate memories can be soft-deleted with the script
`scripts/cleanup-duplicates.js` (or by running the equivalent
SQL UPDATE). Duplicates are detected by exact content match
within the same `type`; the oldest row is kept, the rest are
soft-deleted (`deleted_at = now`).

---

## [0.5.1] — 2026-06-16

### Fixed — [@mem-weave/server]

- **MCP `/mcp` handler now accepts any `Accept` header** (defensive
  fix for clients that send only one of `application/json` /
  `text/event-stream`, or no Accept header at all). The MCP SDK's
  `WebStandardStreamableHTTPServerTransport` returns HTTP 406 +
  JSON-RPC error -32000 ("Not Acceptable: Client must accept
  text/event-stream") when the Accept header doesn't list both
  content types. The Fastify → Web-Standard transport bridge now
  augments the Accept header with the missing tokens before
  dispatching the request, so the bridge is forgiving without
  breaking strict clients (their original Accept header values
  are preserved).

  Symptom this fixes: OpenCode users with `mcp.memweave = { type: "remote" }`
  in their `opencode.json` see "MCP error -32000: Connection closed"
  in the LLM when the OpenCode build's Streamable HTTP client sends
  a single Accept token (instead of the SDK-standard
  `application/json, text/event-stream`). The server 0.5.0
  strictly required the standard pair; 0.5.1 accepts any single
  or paired Accept.

### Verified

- `Accept: application/json, text/event-stream` (OpenCode SDK default) → 200 ✅
- `Accept: application/json` only → 200 ✅ (was 406)
- `Accept: text/event-stream` only → 200 ✅ (was 406)
- No Accept header → 200 ✅ (was 406)
- Full end-to-end (`initialize` + `tools/list` + `memory_save` +
  `memory_recall`) all return 200 with 10 `memory_*` tools

---

## [0.4.3] — 2026-06-16

### Documentation — no plugin code changes

This release is **docs-only** and does **not** bump the published
`@mem-weave/opencode-plugin` package on npm. Investigation during
v0.4.2 release feedback revealed that:

- **The plugin's `.mcp.json` shipped in npm `@mem-weave/opencode-plugin@0.4.2`**
  is correct (`type: "remote"`). Verified by downloading the
  0.4.2 tarball and inspecting it.
- **OpenCode's Effect schema for the mcp section** silently drops
  `type: "http"` and `type: "sse"` — it only accepts `type: "remote"`.
  The "is already set to a non-local server; skipping registration"
  message that the user saw during v0.4.1 testing was actually the
  plugin's `config` hook from a much earlier release (0.2.x), not
  from the current 0.4.2 plugin.
- **`oh-my-openagent`'s Claude Code plugin loader** (which would
  auto-register `mcp.memweave` from the plugin's `.mcp.json`) depends
  on `~/.claude/plugins/installed_plugins.json` (Claude Code's plugin
  DB) which most users don't have. So even with the plugin's
  `.mcp.json` correctly written, the auto-registration path is
  unreliable for most users.

The reliable path is the **user hand-adding** the `mcp.memweave` block
to `~/.config/opencode/opencode.json` with `type: "remote"`. This
release updates README, AGENTS.md, and the plugin's AGENTS.md to be
explicit about this.

### Why no code change / no npm publish

The previous v0.4.2 release was already correct on the plugin
side. The v0.4.1 issue ("server unavailable key=memweave type=local")
the user hit was caused by the OpenCode cache still holding the
0.2.1 install of the plugin (which had the now-removed `config` hook
and the `is already set` log) — *not* by anything wrong with 0.4.2.
The fix is to hand-edit `opencode.json`; no plugin bump is needed.

If the user later finds that the plugin's `.mcp.json` would be
useful for oh-my-openagent + Claude Code users specifically, a
follow-up release can ship a `0.4.4` with a more sophisticated
`.mcp.json` (e.g. with `claude_code` metadata). For now, v0.4.2
is the recommended install.

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
