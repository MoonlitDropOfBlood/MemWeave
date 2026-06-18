# MemWeave

> A local-first, memorable, reasoning-capable memory and context infrastructure for AI agents.
>
> **中文版本：** [README.md](./README.md)

---

## What is it

MemWeave is a local service that lets AI Agents **remember context without blowing up their context window**.

LLM context windows are limited. Stuffing full memory records into the system prompt wastes tokens—the agent may only need a line or two. MemWeave's answer is **Progressive Disclosure**:

> **Inject only summaries; pull full detail on demand.**

```
system prompt  →  memory id + title + summary    ← low token cost
Agent calls    →  memory_expand(id) → full body  ← tokens spent only when needed
```

Around this core design, MemWeave provides a complete memory infrastructure:

- **Structured memory**: facts, decisions, preferences, events, lessons… organized by `type` / `tier` in local SQLite.
- **Four-layer retrieval**: keyword (BM25) + vector semantics + graph relations + causal chains, fused on demand.
- **Consolidation ("Sleep")**: periodically promotes short-term → long-term, evicts cold items, discovers causal links.
- **Auto-injection** (OpenCode plugin): relevant summaries appended to the system prompt on every turn / file read, zero call overhead.
- **MCP tools** (v0.4+): 10 `memory_*` tools embedded in the server process and exposed via Streamable HTTP at the `/mcp` endpoint; closes the progressive-disclosure loop.
- **MCP tool set** (v0.4+): 10 `memory_*` tools embedded in the server process, exposed via Streamable HTTP at the `/mcp` endpoint; closes the progressive-disclosure loop.
- **Web UI** (Calm Memory Atlas): browse, search, debug, and operate the whole memory system in a browser.
- **REST API**: a complete HTTP interface for scripts and third-party tools.

All data lives in local SQLite. **No mandatory external dependencies** — runs end-to-end without any optional components installed.

---

## Progressive Disclosure — Core Design

MemWeave stores **full memory body** (`content`) but **injects only summaries** (`title` + `summary`) by default. The idea: given a limited context window, give the agent the most relevant "clues" first, and let it pull full details on demand.

### Three consumption granularities

| Level | Contains | When | Token cost |
|---|---|---|---|
| **Compact (default)** | `id` / `type` / `tier` / `title` / `summary` | Injection, search (`mode: "compact"`) | Low |
| **Full record** | Above + `content` / `concepts` / `importance` … | `GET /api/v1/memories/:id` / `MCP memory_expand` | Medium |
| **Plus neighbors** | Above + edges, sessions, causal chains | `MCP memory_expand` (with edges) | High |

### Injected XML

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

The LLM sees the summary and calls `memory_expand({ memoryId: "m_abc" })` to fetch the full `content`.

### Closing the loop

The plugin only injects summaries into the system prompt (step 1). The MCP tools (`memory_expand` etc.) are provided by the `/mcp` endpoint embedded in `@mem-weave/server` (see previous section). OpenCode connects to it via the `mcp: { memweave: { type: 'remote', url: 'http://127.0.0.1:3131/mcp' } }` block; other clients the same.

> **Design point**: Progressive disclosure is not "phased verbosity" — it's **always-summary, full-on-demand**. Every injection phase renders the same granularity; only the memory set and count differ.

---

## 5-minute quickstart

### Option A — global install (recommended; needed for OpenCode / IDE integration)

```bash
npm install -g @mem-weave/server @mem-weave/opencode-plugin
memweave init     # generate memweave.config.jsonc + data dir
memweave start    # foreground server on :3131
```

> **npm 10+ install-script note**: `@mem-weave/server@0.5.6+` and
> `@mem-weave/opencode-plugin@0.5.6+` declare
> `onlyBuiltDependencies: [better-sqlite3, sharp, protobufjs]` in
> their `package.json`. The post-install scripts for these three
> native modules run automatically without prompting. **You do
> not need** the `--allow-scripts=...` flag. If a future version
> of npm adds a new package with an install script you will see a
> new prompt; that is the desired behavior (explicit allow-list,
> not implicit trust).

Open [`http://127.0.0.1:3131/ui/`](http://127.0.0.1:3131/ui/) to see the **Calm Memory Atlas** Web UI.

#### Detached start (Windows / PowerShell)

```powershell
Start-Process -WindowStyle Hidden memweave start
memweave stop     # stop (requires the server to be a CLI-spawned process with a PID file)
```

OpenCode client — edit `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": ["@mem-weave/opencode-plugin"],
  "mcp": {
    "memweave": {
      "type": "remote",
      "url": "http://127.0.0.1:3131/mcp",
      "enabled": true
    }
  }
}
```

> **The `mcp` block is required.** OpenCode does not call a plugin
> `config` hook (see the [plugins docs](https://opencode.ai/docs/plugins/)).
> The `type` field **must** be `"remote"` — OpenCode's Effect schema only
> accepts `"remote"`; `"http"` / `"sse"` are silently dropped.
>
> The plugin **also** ships a `.mcp.json` at its package root as a
> backup path via [`oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent),
> but oh-my-openagent depends on `~/.claude/plugins/installed_plugins.json`
> (Claude Code's plugin DB) — most users don't have Claude Code, so
> `.mcp.json` is **not** a reliable path. Hand-editing `mcp.memweave`
> is the main path.

### Option B — npx try-out (no install)

```bash
npx @mem-weave/server init     # generate memweave.config.jsonc + data dir
npx @mem-weave/server start    # foreground server
```

**Try-out only.** OpenCode / IDE integration needs the server to be globally installed (Option A), otherwise the `http://127.0.0.1:3131/mcp` endpoint disappears the moment the npx process exits.

### Option C — from source (development)

```bash
git clone <repo-url> memweave
cd memweave
npm install
npm run dev                   # builds web + starts server on :3131
```

### Health check

```bash
curl http://127.0.0.1:3131/api/v1/health
# → {"ok":true,"service":"memweave-server"}
```

---

## Architecture at a glance

```
┌────────────────────────────────────────────────────────────┐
│                      Clients                                │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│   │  Web UI │  │   CLI    │  │ MCP/IDE  │  │ OpenCode   │  │
│   │         │  │          │  │          │  │  Plugin    │  │
│   └────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬──────┘  │
└────────┼─────────────┼─────────────┼─────────────┼──────────┘
         │  HTTP        │  stdio     │  stdio      │  HTTP
         │              │            │             │  (POST /injection/preview)
         └──────────────┴─────┬──────┴─────────────┘
                              ▼
              ┌────────────────────────────┐
              │      memweave-server       │
              │   (Fastify + TypeScript)   │
              └────────────┬───────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  Retrieval Engine (4-layer fusion)   │
        │  ┌────────┐ ┌────────┐ ┌──────┐ ┌──┐  │
        │  │  BM25  │ │ Vector │ │Graph │ │Caus│ │
        │  └────────┘ └────────┘ └──────┘ └──┘  │
        └────────────────┬─────────────────────┘
                         ▼
              ┌─────────────────────┐
              │  SQLite + sqlite-vec│
              │   (local, embedded) │
              └─────────────────────┘
                         ▲
                         │
              ┌─────────────────────┐
              │  Consolidation Worker│
              │   (periodic "sleep") │
              └─────────────────────┘
```

See [`docs/`](./docs/) for full design docs.

---

## Core concepts

| Concept | Description |
|---|---|
| **Tenant** | Multi-tenant isolation unit (default `tenant_default`), each with its own API key. |
| **Memory** | A structured record with `type` (fact / decision / preference / event / project_context / lesson / code_pattern / bug / workflow), `tier` (short / medium / long), `summary`, `details`, `scopes`, etc. |
| **Session** | An Agent session, linked to a chain of observations. |
| **Observation** | A single user/tool/assistant interaction. |
| **Edge** | A relation between memories (causal / temporal / entity). |
| **Consolidation Run** | A snapshot of a single "sleep" cycle: promotions, evictions, discovered causal links. |

---

## CLI cheatsheet

The `memweave` global command is installed by `@mem-weave/server`.

```bash
memweave <command>
```

| Command | Description |
|---|---|
| `init` | Generate default config and data dir |
| `start` | Start the service (foreground) |
| `stop` | Stop the background service |
| `status` | Show service status |
| `migrate` | Run database migrations |
| `doctor` | Self-check (DB / config / port) |
| `backup` | Back up the SQLite database |
| `version` | Print version |
| `help` | Show help |

> The standalone `mcp` subcommand and `@mem-weave/mcp` package were retired in v0.4. The 10 MCP tools are now embedded in `@mem-weave/server` and served at the `/mcp` endpoint (Streamable HTTP). No separate install or `mcp` invocation is needed.

---

## REST API overview

All routes are prefixed `/api/v1/`. See `packages/server/src/rest/routes/` for the full set.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check |
| `/memories` | GET / POST | Search + write memories |
| `/memories/:id` | GET / PATCH / DELETE | Memory detail / edit / delete |
| `/memories/:id/edges` | GET | Relation graph of a memory |
| `/injection/preview` | POST | Generate an injection bundle (XML) |
| `/stats` | GET | Dashboard stats (KPIs, distributions) |
| `/sessions` | GET | Session list |
| `/sessions/:id/observations` | GET | Session observation log |
| `/consolidation/runs` | GET | "Sleep" history |
| `/consolidation/runs/:id` | GET | Run detail |
| `/consolidation/runs/latest` | GET | Most recent run |
| `/consolidation/run` | POST | Trigger a manual run |
| `/devices` | GET / POST / DELETE | Device registration & management |
| `/settings` | GET | View server config (secrets masked) |

---

## MCP tools

As of v0.4 the 10 `memory_*` MCP tools are **embedded in the `@mem-weave/server` process** and exposed over **Streamable HTTP** at the `/mcp` endpoint. The standalone `@mem-weave/mcp` package has been retired.

Any MCP client that supports Streamable HTTP (the 2025-03-26 spec) can connect directly:

```json
{
  "mcpServers": {
    "memweave": {
      "url": "http://127.0.0.1:3131/mcp"
    }
  }
}
```

OpenCode configuration (`mcp` section of `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "memweave": {
      "type": "remote",
      "url": "http://127.0.0.1:3131/mcp",
      "enabled": true
    }
  }
}
```

**The 10 registered tools:**

| Tool | Description |
|---|---|
| `memory_save` | Persist an insight, decision, or fact as a long-term memory; supports type, title, concepts, files, scopes, importance |
| `memory_recall` | Keyword search over past observations and memories |
| `memory_smart_search` | Smart search: keyword + vector + graph + causal, four-layer fusion |
| `memory_expand` | Expand a single memory: pull related edges, sessions, causal chains |
| `memory_graph_query` | Run a graph query around an anchor (BFS / causal / entity) |
| `memory_file_history` | Query all memories and observations related to a file path |
| `memory_sessions` | List recent sessions with observation count and time range |
| `memory_patterns` | Discover recurring patterns (frequent n-grams, concept clusters) |
| `memory_consolidate` | Manually trigger a "sleep" consolidation run |
| `memory_forget` | Soft-delete a memory (sets `deleted_at`) |

All tools call the server's REST API through `MemweaveClient`. Override the server address via `MEMWEAVE_URL` (default `http://127.0.0.1:3131`).

---

## OpenCode plugin (auto-injection + auto-write + write-side closure)

`@mem-weave/opencode-plugin` ships an OpenCode plugin called `MemweaveInjectPlugin` that closes the **read and write loop** with the MemWeave server:

1. **Read side** — automatically injects relevant memory summaries into the system prompt (LLM doesn't have to call any tool to see context).
2. **Write side (v0.4+)** — listens to OpenCode's `message.updated` event and pushes every completed user + assistant message to the server as a Session + Observation. The consolidation worker promotes high-signal observations into long-term memories on the next tick.
3. **MCP endpoint** — the 10 `memory_*` tools come from `@mem-weave/server`'s built-in `/mcp` (Streamable HTTP). They are reached via the `mcp.memweave` block in `~/.config/opencode/opencode.json` that **you must hand-add once** (see below). The `type` field **must** be `"remote"` — OpenCode's Effect schema only accepts `"remote"`.

**Enable it:**

```bash
npm install -g @mem-weave/opencode-plugin
```

Then in `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": ["@mem-weave/opencode-plugin"],
  "mcp": {
    "memweave": {
      "type": "remote",
      "url": "http://127.0.0.1:3131/mcp",
      "enabled": true
    }
  }
}
```

> **The `mcp` block is required** with `type: "remote"`. Other `type` values
> (`"http"`, `"sse"`, etc.) are silently dropped by OpenCode's schema validator.
>
> The plugin also ships a `.mcp.json` at its package root as a backup path
> via [`oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent) —
> but oh-my-openagent's Claude Code plugin loader depends on
> `~/.claude/plugins/installed_plugins.json` (Claude Code's plugin DB) which
> most users don't have. So `.mcp.json` is **not** reliable; hand-editing
> `mcp.memweave` is the main path.

**What it does (hooks actually called by OpenCode):**

1. `event` (v0.4+) — on `message.updated`, reverse-queries the OpenCode SDK for the message's `Part[]` text, then `POST /api/v1/sessions` + `POST /api/v1/observations` on the server (both idempotent on `(sessionId, messageId)`).
2. `experimental.chat.system.transform` — asks the server for a `session_start` / `prompt_delta` context pack (based on session ID, user identity, tenant) and appends it to the system prompt.
3. `tool.execute.before` — on file-reading tool calls (`Read` / `Edit` / `Write` / `Glob` / `Grep`), extracts file paths and requests a `file_pack` of file-related memories.

**Write-side data flow:**

```
OpenCode  user message complete
   ↓
Plugin  event hook fires → OpenCode SDK reverse query → text + messageId
   ↓
Plugin  POST /api/v1/sessions     → server upserts session
         POST /api/v1/observations → server upserts observation
                                    (tool_output = text, tool_input = JSON{messageId})
   ↓
Server  consolidation worker (every 6h) → promotes high-signal observations to memory
   ↓
Next system.transform injection  → LLM sees summary → calls memory_expand for detail
```

**Injection format** — the server returns `contextXml` like:

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

Sort order: `tier` (long > medium > short) → `strength × importance`. The server-side `injection/` module handles querying, trimming, and token-budget enforcement.

**Configuration:**

| Env var | Default | Meaning |
|---|---|---|
| `MEMWEAVE_URL` | `http://127.0.0.1:3131` | Server URL |
| `MEMWEAVE_PLUGIN_TIMEOUT` | `10000` (ms, hardcoded) | Per-injection request timeout |

> The plugin **silently swallows server-unavailable errors** (try/catch) so a MemWeave outage never breaks the agent.

## Write-side dedup (server-side, zero token cost)

The read side is closed — but what about the write side? `memory_save` will **not** create duplicates of memories the LLM just saw in the injected XML, because dedup runs server-side automatically. **The LLM never knows, and there is zero token cost.**

**Mechanism**: `MemoryRepo.create` runs a dedup gate before any INSERT:

1. BM25 query on the FTS5 index using the new input's `concepts` field (same tenant, exclude soft-deleted) — sub-millisecond, zero embedding cost
2. Take top-5 candidates, compute **Jaccard similarity** on the concepts set (|A ∩ B| / |A ∪ B|) for each
3. If the best Jaccard is **≥ 0.8** AND `type` matches → it's a duplicate. **Reinforce the existing memory** instead of inserting a new row.

**Reinforcement has two behaviors** based on whether the new content is richer:

| Scenario | Action |
|---|---|
| New content is similar (length delta < 25%) | Just `recordAccess`: bump `access_count` / `reinforcement_score` / `strength` / `last_reinforced_at` |
| New content is meaningfully richer (length > 1.25× or higher importance) | **Merge**: upgrade content, union concepts, union files, take `max` of importance |

**Design points**:

- **Zero LLM tokens** — pure server-side BM25 + set similarity
- **Zero added latency** — FTS5 is sub-millisecond on SQLite
- **Type must match** — a `fact` is never a duplicate of a `decision`
- **Callers don't need to change** — `create()` still returns `MemoryRecord`. Use `createDetailed()` if you want the dedup signal: it returns `CreateResult { memory, deduped, reinforcedId }`
- **REST routes unchanged** — `POST /api/v1/memories` still calls `create()`; behavior is fully transparent to API consumers

> **No "LLM-side dedup"**: that approach (asking the LLM to first `memory_smart_search` before every `memory_save`) burns ~1000 defensive tokens per save even when there's no duplicate. This scheme only spends server CPU **when a duplicate actually exists**, and the LLM never has to think about it.

### Write-side companion: input limits + rate limiting + background merge + structured logging

- **Hard limits in `CreateMemoryInputSchema`** (`packages/server/src/core/types.ts`): `content` ≤ 100,000 chars, `concepts` ≤ 50, `files` ≤ 50. A buggy or malicious LLM cannot insert 10MB of body or 10k concept tags.
- **Write rate limit** (`packages/server/src/server/rate-limiter.ts`): one token bucket per API key, 30 writes/minute burst, 2/sec sustained. `POST /api/v1/memories` returns `429 Too Many Requests` + `Retry-After` header when over quota.
- **Background merge stage** (`packages/server/src/workers/consolidator.ts`): in addition to evict + promote, the consolidation pipeline now has a **Jaccard merge stage** that reuses the same formula and threshold as the live write-side dedup. Scans all same-tenant same-type memory pairs and absorbs near-duplicates. Two-layer defense: live dedup + background merge.
- **Process-wide consolidation mutex**: the `consolidationInFlight` boolean inside `runConsolidation` guarantees only one run per tenant. Background scheduler and manual `POST /api/v1/consolidate` never collide.
- **pino structured logging** (`packages/server/src/server/logger.ts`): replaces 14 `console.*` error sites across the codebase. `LOG_LEVEL` env var tunes verbosity (default: `info`). JSON output is log-shipper-friendly (Loki, ELK, etc).
- **Dedup reinforce writes an audit log row** (`packages/server/src/db/repositories/memory-repo.ts`): when `reinforceExisting` fires, it inserts a `source: 'dedup_reinforce'` row in `access_logs` so "this memory was reinforced" is auditable alongside regular retrievals.

---

## Local embeddings (optional)

MemWeave's vector layer is **fully optional**. Three embedding providers, pick one:

| Provider | Config key | External dep | When to use |
|---|---|---|---|
| **`noop`** (default) | `embedding.provider: "noop"` | none | Zero-config startup / no vector layer |
| **`local-xenova`** | `embedding.provider: "local-xenova"` | `@xenova/transformers` (opt-in install) | Real semantic vectors, no API bill |
| **`openai-compatible`** | `embedding.provider: "openai-compatible"` | any OpenAI-compatible `/v1/embeddings` endpoint | You already have OpenAI / Voyage / a self-hosted endpoint |

**Enabling `local-xenova`:**

```bash
npm install @xenova/transformers
```

`memweave.config.jsonc`:

```jsonc
{
  "embedding": {
    "provider": "local-xenova",
    "model": "Xenova/nomic-embed-text-v1",
    "dimensions": 768
  }
}
```

**Key behaviors:**

- The first `embed()` call dynamically loads the model and pulls weights from the Hugging Face Hub (~30MB), then caches them under `node_modules/@xenova/transformers/.cache/`.
- Subsequent calls **reuse** the loaded pipeline (concurrent callers share the same load).
- **Automatic degradation**: if `@xenova/transformers` is not installed, the model fails to load, or inference times out (default 60s), the provider falls back to a SHA-256 hash-based vector and emits a one-time `console.warn`, so the system never breaks.
- Pass `fallbackOnError: false` to disable the fallback (let errors bubble up for debugging).
- If the model's output dimension doesn't match the configured `dimensions`, the vector is **truncated or zero-padded** to match (consistent with the graceful-degrade style of `vector-search.ts`).

See [`packages/server/src/providers/embedding/local-xenova.ts`](./packages/server/src/providers/embedding/local-xenova.ts) and [`packages/server/src/types/xenova.d.ts`](./packages/server/src/types/xenova.d.ts) for details.

---

## Web UI tour

Visit `/ui/`. Five top-level pages + memory detail + graph:

| Route | Name | Purpose |
|---|---|---|
| `/ui/` | **Atlas** | Dashboard: KPI cards, tier/type distributions, active projects, last consolidation |
| `/ui/memories` | **Memories** | Three-pane: filter rail + list + detail (search, type filter, strength sort) |
| `/ui/injection` | **Injection** | Form to preview the injection bundle (clipped to token budget) |
| `/ui/sleep` | **Sleep** | Consolidation run history + git-diff view of promotions/evictions |
| `/ui/settings` | **Settings** | Server config viewer, device list, API key reveal toggle |
| `/ui/memories/:id` | **Memory Detail** | Memory detail (body / relation graph / access log) |
| `/ui/graph/:id` | **Graph** | Relation graph (radial layout) |

Light / dark theme toggle in the top-right.

---

## Development

### Directory layout

Starting with v0.2, the repo is a monorepo. Each `packages/<name>/` is an independent npm package:

```
packages/
├── server/              # @mem-weave/server           — Fastify + SQLite + CLI
│   └── src/
│       ├── cli.ts, cli-entry.ts
│       ├── commands/    # 9 memweave subcommands
│       ├── core/        # config, Zod enums, decay model
│       ├── db/          # SQLite schema + 9 repositories
│       ├── injection/   # injection bundler
│       ├── prompts/     # prompt templates
│       ├── providers/   # Embedding (noop/openai/xenova) / LLM (noop/openai)
│       ├── rest/        # HTTP API (8 route files)
│       ├── retrieval/   # 4-layer retrieval engine + RRF
│       ├── server/      # HTTP bootstrap + scheduler
│       ├── workers/     # Consolidation background tasks
│       ├── types/       # ambient .d.ts
│       └── mcp/         # embedded MCP server (Streamable HTTP, /mcp endpoint)
│           ├── index.ts, service.ts, registry.ts
│           └── tools/   # 10 memory_* tools
└── opencode-plugin/     # @mem-weave/opencode-plugin  — OpenCode plugin
    └── src/
        ├── index.ts, client.ts

web/                     # React 18 + Vite frontend (separate subproject, not in packages/)
├── src/
│   ├── pages/           # 7 pages
│   ├── components/      # AppShell + common components
│   ├── api/             # typed fetch wrapper
│   ├── lib/             # formatters / utils
│   └── theme/           # CSS variables (design tokens)
├── tests/               # vitest + happy-dom
└── vite.config.ts

tests/                   # cross-monorepo vitest integration + unit tests
docs/                    # design docs
scripts/publish.mjs      # one-shot build + publish all 3 npm packages
```

### Common scripts

**In the monorepo (development):**

| Command | Description |
|---|---|
| `npm test` | Run all Vitest tests (server integration + units) |
| `npm run typecheck` | TypeScript type check (entire monorepo) |
| `npm run build` | Build frontend + both server packages (tsc) |
| `npm run dev` | Build frontend + start server (foreground) |
| `npm run web:dev` | Frontend Vite dev server (HMR, port 5173) |
| `npm run web:build` | Build frontend into `dist/web/` |

**Per-package (used by the publish script):**

```bash
cd packages/server && npm run build             # server only (includes embedded MCP)
cd packages/opencode-plugin && npm run build    # opencode-plugin only
```

**Publish to npm** (requires `$NPM_TOKEN` in your env or `~/.npmrc`):

```bash
node scripts/publish.mjs --dry-run    # inspect tarball contents
node scripts/publish.mjs --publish    # actually publish (server -> opencode-plugin order)
```

> Frontend unit tests live in `web/`: `cd web && npm test`.

### Quality gate

After making changes, verify:

```bash
npm test           # all pass
npm run typecheck  # 0 errors
npm run build      # succeeds
```

---

## FAQ

**Q: Where is the data stored?**
A: A SQLite file. See `storage.path` in `memweave.config.jsonc`; defaults to `<dataDir>/memweave.db`.

**Q: Can it run without an external LLM / Embedding service?**
A: Yes. Three fallback paths, in order of cost:

1. **Fully local + hash vectors** — `embedding.provider: "noop"` (default). No external service. When `embedding.dimensions: 0` the server skips the vector layer entirely; retrieval falls back to BM25 + graph + causal.
2. **Fully local + real embeddings** — `embedding.provider: "local-xenova"` + `npm install @xenova/transformers`. On the first call, the model weights (~30MB) are pulled from the Hugging Face Hub and cached under `node_modules/@xenova/transformers/.cache/`. If the package is missing or model loading fails, the provider **automatically degrades** to hash-based vectors and emits a one-time `console.warn`.
3. **External API** — `embedding.provider: "openai-compatible"`, against any OpenAI-compatible `/v1/embeddings` endpoint.

**Q: Port already in use?**
A: Change `server.port` in `memweave.config.jsonc`.

**Q: How do I wipe all data?**
A: Stop the service → remove the directory pointed to by `dataDir` → re-run `init`.

**Q: Web UI returns 503?**
A: The server can't find `dist/web/`. Run `npm run web:build`.

---

## Roadmap

- [x] **Local ONNX embeddings** — implemented `LocalXenovaEmbeddingProvider` (built on `@xenova/transformers`, dynamic import + automatic noop fallback)
- [ ] Multi-provider embedding adapters (OpenAI / Voyage / more local models)
- [ ] Federation / sync protocol (device-to-device E2E-encrypted sync)
- [ ] Automatic knowledge-graph extraction
- [ ] "Right to be forgotten" (GDPR compliance)

---

## License

No open-source license declared yet. Contact the author before use.

---

## Acknowledgements

- [Fastify](https://fastify.io/) — high-performance HTTP server
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — synchronous SQLite client
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — embedded vector search
- [Model Context Protocol](https://modelcontextprotocol.io/) — agent tool-calling standard
- [Vite](https://vitejs.dev/) + [React](https://react.dev/) — frontend
