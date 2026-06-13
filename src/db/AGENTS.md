# src/db/

**SQLite schema + 9 repositories. The ONLY layer that talks to `better-sqlite3`.**

## OVERVIEW

Persistent state. `schema.ts` exports `SCHEMA_SQL` (idempotent DDL with `IF NOT EXISTS`); `database.ts` opens a single `Db` connection and runs the schema on init. All mutation goes through one of the 9 repositories under `repositories/`.

## STRUCTURE

```
src/db/
├── database.ts        # openDatabase() → Db, runs SCHEMA_SQL, returns singleton
├── schema.ts          # SCHEMA_SQL constant
└── repositories/
    ├── memory-repo.ts
    ├── session-repo.ts
    ├── observation-repo.ts
    ├── edge-repo.ts
    ├── device-repo.ts
    ├── consolidation-run-repo.ts
    ├── access-log-repo.ts
    ├── stats-repo.ts
    └── vector-repo.ts
```

## WHERE TO LOOK

| Symbol | File | Role |
|---|---|---|
| `SCHEMA_SQL` | `schema.ts` | All DDL; tenant/device/session/memory/edge/scope tables + vec virtual table |
| `openDatabase()` | `database.ts` | Opens SQLite, sets `journal_mode=WAL`, `foreign_keys=ON`, busy_timeout=5000 |
| `type Db` | `database.ts` | The exported `better-sqlite3` type alias used everywhere |

## REPOSITORY CONTRACT

Every repo method takes `tenantId: string` as the **first parameter after the implicit `db`**. SQL queries filter by `tenant_id` — there is no global query. This is the multi-tenant invariant.

| Repo | Responsibility |
|---|---|
| `memory-repo.ts` | CRUD on `memories` + `memory_scopes`; tier promotion queries; **write-side dedup** (BM25 + Jaccard) |
| `session-repo.ts` | Session lifecycle + observation count |
| `observation-repo.ts` | Append-only observation log per session |
| `edge-repo.ts` | Edges between memories (causal/temporal/entity) |
| `device-repo.ts` | Per-tenant device API keys |
| `consolidation-run-repo.ts` | Run snapshots (promotions, evictions, new edges) |
| `access-log-repo.ts` | Read events for analytics |
| `stats-repo.ts` | Aggregates for the Atlas dashboard |
| `vector-repo.ts` | sqlite-vec wrapper; skipped when `embedding.dimensions=0` |

## CONVENTIONS

- Schema changes: edit `SCHEMA_SQL` (it is idempotent). For non-trivial migrations, add a step to the `migrate` command instead of editing the constant.
- Timestamps are **integers** (Unix epoch ms), never ISO strings.
- JSON columns (`concepts_json`, `files_json`, `settings_json`) are TEXT; serialize via `JSON.stringify` in the repo, parse on read.
- Soft delete: set `deleted_at`; never `DELETE FROM`.
- Use prepared statements (`db.prepare(...).get/all/run`) for hot paths.
- **`memory-repo.create` auto-dedups via FTS5 + Jaccard** (see `CreateResult`). LLM never knows about dedup; `create()` returns just the (possibly-reinforced) `MemoryRecord` for backward compat. Callers that need the dedup signal use `createDetailed()`.

## ANTI-PATTERNS

- **NEVER** import `better-sqlite3` outside `src/db/`. Everything else goes through a repository.
- **NEVER** write `SELECT *` in production paths — enumerate columns.
- **NEVER** drop a column by editing `SCHEMA_SQL`; that would be a destructive migration. Add a real migration step.
- **NEVER** join across tenants in a single query. Every `WHERE` includes `tenant_id = ?`.
