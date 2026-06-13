# src/rest/

**Fastify HTTP API. All routes prefixed `/api/v1/`.**

## OVERVIEW

The server's public HTTP surface. One file per resource under `routes/`. Handlers are thin: parse (via Zod), call repositories/services, serialize, return.

## STRUCTURE

```
src/rest/
└── routes/
    ├── health.ts          # GET /api/v1/health
    ├── memories.ts        # GET/POST /memories, GET/PATCH/DELETE /memories/:id, GET /memories/:id/edges
    ├── injection.ts       # POST /injection/preview
    ├── stats.ts           # GET /stats
    ├── sessions.ts        # GET /sessions, GET /sessions/:id/observations
    ├── consolidation.ts   # GET /consolidation/runs[/...], POST /consolidation/run
    ├── devices.ts         # GET/POST/DELETE /devices
    └── settings.ts        # GET /settings (secrets masked)
```

## WHERE TO LOOK

| File | Registers | Notable behavior |
|---|---|---|
| `server/http.ts` | All routes + middleware | Where the Fastify app is built; this is where new routes get registered |
| `server/auth.ts` | `onRequest` hook | Validates `X-API-Key` against `tenants.api_key_hash`; injects `request.tenantId` |

## CONVENTIONS

- **One file per resource.** A resource is a noun: `memories`, `sessions`, `devices`. Sub-paths are exported from the same file.
- **Zod first**: every request body / query string is `z.object({...}).parse(...)`d at the route boundary. Never trust the input.
- Handlers are `async`; throw `AppError(statusCode, message)` for non-2xx.
- Responses are JSON: `{ ok: true, data: ... }` on success; `{ ok: false, error: ... }` on failure.
- Tenant isolation: `request.tenantId` is set by the auth hook; pass it as the first argument to every repository call.

## ANTI-PATTERNS

- **NEVER** read the API key from `process.env` here. Use the auth middleware's `request.tenantId`.
- **NEVER** call SQLite directly. Always go through a repository.
- **NEVER** add a new top-level route outside the `routes/` directory.
- **NEVER** leak secrets in `/settings` — mask API keys (`****`).
