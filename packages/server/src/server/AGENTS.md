# src/server/

**HTTP server bootstrap, scheduler, and auth. The process entry point.**

## OVERVIEW

This is where the server lives as a runnable process. `bootstrap.ts` is `npm run dev`; `http.ts` is the Fastify app factory; `scheduler.ts` runs the consolidation worker; `auth.ts` is the API-key middleware.

## WHERE TO LOOK

| File | Role |
|---|---|
| `bootstrap.ts` | Process entry. Loads config, opens DB, calls `createHttpServer()`, starts scheduler, calls `app.listen()`. |
| `http.ts` | `createHttpServer({ dbPath, configPath })` — builds the Fastify app, registers all REST routes, mounts static `/ui` from `dist/web/`. |
| `scheduler.ts` | `startConsolidationScheduler({ dbPath, intervalMs, runOnStart, onRun })` — runs `consolidator.runConsolidation()` every 6h; default `runOnStart: true`. |
| `auth.ts` | Fastify `onRequest` hook. Hashes `X-API-Key` and looks it up in `tenants` + `devices`. Sets `request.tenantId`. |

## CONVENTIONS

- `bootstrap.ts` is the **only** file that calls `app.listen()`. Tests use `app.inject()` or `app.ready()` instead.
- Config is read once in `bootstrap.ts`; do not re-read it elsewhere.
- Static web UI: `dist/web/` is served at `/ui/`. If missing, `/ui` returns 503 with a message telling the user to run `npm run web:build`.
- `MEMWEAVE_NO_SCHEDULER=1` disables the consolidation scheduler (useful for tests).

## ANTI-PATTERNS

- **NEVER** import this directory from `src/plugin/`. The plugin is a separate process.
- **NEVER** start the Fastify server from CLI commands (`start` is the only one that does, via bootstrap).
- **NEVER** add business logic in route files. Handlers call repositories/services.
