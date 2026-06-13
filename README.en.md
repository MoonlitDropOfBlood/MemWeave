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
