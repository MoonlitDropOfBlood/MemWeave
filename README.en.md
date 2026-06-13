# MemWeave

> A local-first, memorable, reasoning-capable memory and context infrastructure for AI agents.
>
> **中文版本：** [README.md](./README.md)

---

## What is it

MemWeave is a local service that lets AI Agents **remember you, your projects, and history**. It provides:

- **Structured memory**: persist facts, decisions, preferences, events, lessons, etc. as working memory in a local SQLite database.
- **Four-layer retrieval**: keyword (BM25) + vector semantics + graph relations + causal chains, fused on demand.
- **Context injection**: package relevant memories into an agent-friendly XML format and feed them to the LLM.
- **Consolidation ("Sleep")**: periodically mimics "sleep" — promotes short-term memories to long-term, evicts cold ones, discovers causal links.
- **Web UI** (Calm Memory Atlas): browse, search, debug, and operate the whole memory system in a browser.
- **MCP integration**: connect to Claude / Cursor / OpenCode via the Model Context Protocol (10 tools).
- **OpenCode plugin**: zero call cost — relevant memories are appended to the system prompt on every turn / file read.
- **REST API**: a complete HTTP interface for scripts and third-party tools.

All data lives in a local SQLite file. **No mandatory external dependencies** (besides two optional components: the `sqlite-vec` vector extension, and `@xenova/transformers` for local embeddings). The system runs end-to-end with neither installed.

---

## 5-minute quickstart

### 1. Install

```bash
git clone <repo-url> memweave
cd memweave
npm install
```

### 2. Initialize config

```bash
npm run cli -- init
```

This generates `memweave.config.jsonc` in the current directory (data dir, port, tenant API key, etc.).

### 3. Start the service

```bash
npm run dev
```

The service listens on `http://127.0.0.1:3131` by default.

Open [`http://127.0.0.1:3131/ui/`](http://127.0.0.1:3131/ui/) in your browser to see the **Calm Memory Atlas** Web UI.

### 4. Health check

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

```bash
npm run cli -- <command>
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

> **Tip:** after `npm run build && npm link`, `memweave` and `memweave-mcp` become global commands.

---

## REST API overview

All routes are prefixed `/api/v1/`. See `src/rest/routes/` for the full set.

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

Launch via `npm run mcp` (stdio transport). Plug into Claude Desktop / Cursor / OpenCode or any MCP-compatible client.

**Example config** (Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memweave": {
      "command": "npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "/path/to/memweave",
      "env": { "MEMWEAVE_URL": "http://127.0.0.1:3131" }
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

## OpenCode plugin (auto-injection)

`src/plugin/` ships an OpenCode plugin called `MemweaveInjectPlugin` that **automatically injects relevant memory** into the prompt sent to the LLM — the agent doesn't have to call any tool.

**Enable it** (in `~/.config/opencode/opencode.json`):

```json
{
  "plugins": ["/path/to/memweave/src/plugin/index.ts"]
}
```

**What it does:**

1. **At session start** — hooks `experimental.chat.system.transform`, asks the server to produce a `session_start` context pack (based on session ID, user identity, tenant), and appends it to the end of the system prompt.
2. **After every new prompt** — switches phase to `prompt_delta` and only appends incremental memories, avoiding duplicates.
3. **On file-reading tool calls** (`Read` / `Edit` / `Write` / `Glob` / `Grep`) — hooks `tool.execute.before`, extracts file paths from args, and requests a `file_pack` of file-related memories.

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

---

## Progressive disclosure

MemWeave's search results include the **full memory body** (`content` field), but what gets **injected into the LLM by default contains only summaries** (`title` + `summary`). This is the "progressive disclosure" principle explicitly required by design spec §5.5 — given the LLM's limited context window, hand it the most important "hooks" first, and let the agent *proactively* call `memory_expand(memoryId)` to pull full details.

### Three consumption granularities

| Granularity | Includes | Returned by | Token cost |
|---|---|---|---|
| **Compact (default)** | `id` / `type` / `tier` / `title` / `summary` | `POST /api/v1/inject` (all 4 phases), `POST /api/v1/memories/search` (`mode: "compact"`) | Low |
| **Full record** | Above + `content` / `concepts` / `files` / `importance` / `confidence` / `strength` / `scopes` etc. | `GET /api/v1/memories/:id` / `MCP memory_expand` | Medium-high |
| **Plus neighbors** | Above + related edges, adjacent sessions, causal chains | `MCP memory_expand` (default returns related edges) / `MCP memory_graph_query` | High |

### What the injected XML looks like

The server (in `src/injection/formatter.ts` and `src/plugin/injector.ts`) renders each `<memory>` block with `<title>` + `<summary>` only — **never** with `<content>`:

```xml
<memory-context phase="session_start" count="12">
  <memory id="m_abc" type="fact" tier="long" strength="0.92" importance="8">
    <title>User prefers strict TypeScript</title>
    <summary>Always use noImplicitAny, exactOptionalPropertyTypes.</summary>
  </memory>
  ...
</memory-context>
```

When the LLM sees this block and needs more detail (e.g., "how exactly does this preference land in the codebase?"), it **proactively** calls `memory_expand({ memoryId: "m_abc" })` to get the full `content` field and related edges.

### Search also supports compact / full

`POST /api/v1/memories/search` takes a `mode` parameter (`"compact"` | `"full"`). Default is `compact`:

- `mode: "compact"` (default; used by MCP `memory_smart_search`) — returns `id` / `type` / `tier` / `title` / `summary` / `finalScore` / `sources`
- `mode: "full"` — also includes `content` / `concepts` / `files` / `importance` / `confidence` / `strength` / `scopes` etc.

The server **defaults to `compact`** so list rendering and bulk-preview endpoints don't blow up the response body with large `content` fields.

### Sort order and token budget

In compact mode, the injection sort order is: **tier** (`long` > `medium` > `short`) → **`strength × importance`**. The server trims to the per-phase token budget (`session_start: 1200` / other phases: `800`), so the LLM only ever sees the top-K most relevant memories within budget.

> **Design note**: progressive disclosure is not "vary detail by phase" — it's "**always summary, fetch full text on demand**". All injection phases (`session_start` / `prompt_delta` / `file_pack` / `failure_delta`) render XML at the **same** summary granularity; they differ only in *which* memories and *how many*. When the LLM wants detail, it calls `memory_expand`.

### How the loop actually closes

Can the LLM *really* call `memory_expand` and get the full body? **In OpenCode, yes** — the OpenCode plugin (`src/plugin/index.ts`) uses the **`config` hook** to register the bundled MemWeave MCP server (`src/mcp/index.ts`, 10 tools) with OpenCode at plugin-load time. OpenCode auto-connects, the 10 `memory_*` tools appear in the LLM's tool list, and the LLM can call them like any built-in.

The full round-trip:

1. **Plugin loads** → `config` hook runs → OpenCode registers `mcp["memweave"]` = `npx tsx <repo>/src/mcp/index.ts`
2. **OpenCode auto-connects** to the MCP server → the 10 `memory_*` tools become available to the LLM
3. **LLM starts** → `experimental.chat.system.transform` fires → summary-only `<memory-context>` XML is appended to the system prompt
4. **LLM sees `m_abc` is relevant** → calls `memory_expand({ memoryId: "m_abc" })` → MCP server proxies to REST `/api/v1/memories/:id` → LLM gets the full `content`

Outside OpenCode (Claude Desktop, Cursor, etc.) the same loop is available via the `memweave-mcp` bin — same server, same 10 tools, identical behavior.

### Write-side dedup (server-side, zero token cost)

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

See [`src/providers/embedding/local-xenova.ts`](./src/providers/embedding/local-xenova.ts) and [`src/types/xenova.d.ts`](./src/types/xenova.d.ts) for details.

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

```
src/
├── cli/                 # CLI entry
├── commands/            # memweave subcommands
├── core/                # core (config, Zod enums, memory decay model)
├── db/                  # SQLite schema + repositories
│   └── repositories/    # Memory / Session / Edge / Device / Stats / ConsolidationRun
├── injection/           # injection packaging (XML / text)
├── mcp/                 # Model Context Protocol tools
│   └── tools/           # 10 MCP tool implementations
├── plugin/              # OpenCode plugin (auto-injects memories into the prompt)
├── prompts/             # prompt templates (compression / edge extraction / value-gate)
├── providers/           # Embedding (noop/openai/xenova) / LLM (noop/openai) adapters
│   ├── embedding/       # NoopEmbeddingProvider / OpenaiCompatible / LocalXenova (opt-in dep)
│   └── llm/             # NoopLlmProvider / OpenaiLlmProvider
├── rest/                # HTTP API (Fastify)
│   └── routes/          # one file per route
├── retrieval/           # retrieval engine
│   ├── bm25-search.ts
│   ├── vector-search.ts
│   ├── graph-traversal.ts
│   ├── causal-chain.ts
│   ├── fusion.ts
│   └── search-engine.ts
├── server/              # HTTP server + scheduler
└── workers/             # consolidation background tasks

web/                     # React 18 + Vite frontend
├── src/
│   ├── pages/           # 7 pages
│   ├── components/      # AppShell + common components
│   ├── api/             # typed fetch wrapper
│   ├── lib/             # formatters / utils
│   └── theme/           # CSS variables (design tokens)
├── tests/               # vitest + happy-dom
└── vite.config.ts

docs/                    # design docs
tests/                   # server-side vitest unit tests
```

### Common scripts

| Command | Description |
|---|---|
| `npm test` | Run all server-side Vitest tests |
| `npm run typecheck` | TypeScript type check (server) |
| `npm run build` | Build frontend + server (incl. tsc) |
| `npm run dev` | Build frontend + start server (foreground) |
| `npm run web:dev` | Frontend Vite dev server (HMR, port 5173) |
| `npm run web:build` | Build frontend into `dist/web/` |
| `npm run cli` | Run the CLI |
| `npm run mcp` | Run the MCP server |

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
