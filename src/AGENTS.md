# src/ — MemWeave Server

**Fastify + SQLite memory backend. TypeScript strict ESM, NodeNext.**

## OVERVIEW

The server-side entry. Boots via `server/bootstrap.ts` (also the `npm run dev` target). Each subdirectory owns one slice of the system; this file points you at the contract.

## STRUCTURE

```
src/
├── cli-entry.ts        # `memweave` bin — argv → runCli
├── cli.ts              # Parser + dispatch
├── commands/           # 11 subcommands (start, stop, init, doctor, …)
├── core/               # Zod enums + config loader + decay model
├── db/                 # SQLite schema + 9 repositories
├── retrieval/          # 4-layer search engine + RRF fusion
├── injection/          # XML/text bundler (token-budgeted)
├── rest/routes/        # 8 Fastify routes under /api/v1/*
├── mcp/tools/          # 10 MCP tools via stdio
├── plugin/             # OpenCode plugin (auto-inject)
├── providers/          # Embedding (openai/xenova/noop) + LLM (openai/noop)
├── prompts/            # Compression / edge-extract / value-gate templates
├── workers/            # Consolidation pipeline (6 files)
└── server/             # HTTP bootstrap + scheduler + auth
```

## WHERE TO LOOK

| Task | Look in | Notes |
|---|---|---|
| Add a new feature module | top-level `src/<feature>/` + update root AGENTS.md | One file per concern |
| Change a domain enum | `core/types.ts` | All enums are Zod schemas; types inferred |
| Read or mutate memory data | `db/repositories/` | Never touch `better-sqlite3` outside repos |
| Add HTTP route | `rest/routes/<resource>.ts` + register in `server/http.ts` | One file per resource |
| Add MCP tool | `mcp/tools/<name>.ts` + register in `mcp/registry.ts` | Schema in/out via Zod |
| Add CLI subcommand | `commands/<name>.ts` + export from `commands/index.ts` | |
| Add background work | `workers/` + wire in `server/scheduler.ts` | |
| Swap embedding/LLM | `providers/<embedding|llm>/` + add adapter | Noop = no external dep |

## CONVENTIONS

- ESM imports use `.js` suffix even for `.ts` files.
- `import type` for type-only imports (required by `verbatimModuleSyntax` in some configs).
- Each subdirectory has an `index.ts` re-exporting its public surface; consumers import from the dir, not internal files.
- Errors thrown by repositories bubble as plain `Error` with a descriptive message; route handlers convert to HTTP status.
- Zod schemas define the wire contract for REST and MCP; types are inferred via `z.infer<typeof X>`.

## ANTI-PATTERNS

- **NEVER** import from `better-sqlite3` outside `src/db/`. Use repositories.
- **NEVER** hardcode a port / path / API key. Read from `loadConfig()` or env.
- **NEVER** call `app.listen()` outside `server/bootstrap.ts` — that's the only entry point.
- **NEVER** add a new top-level directory here without updating root `AGENTS.md` and removing the explicit ban.
