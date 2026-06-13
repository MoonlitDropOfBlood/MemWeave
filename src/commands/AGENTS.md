# src/commands/

**11 CLI subcommands. One file each. Dispatch lives in `index.ts`.**

## OVERVIEW

The `memweave` bin (`src/cli-entry.ts`) parses argv and calls `runCommand('start', ctx)` etc. Each command is a pure async function returning `{ ok, message, data? }`.

## STRUCTURE

```
src/commands/
├── index.ts          # runCommand(name, ctx) — the dispatcher
├── start.ts          # Foreground server (calls server/bootstrap.ts)
├── stop.ts           # PID file → kill
├── status.ts         # Probe /api/v1/health
├── init.ts           # Generate memweave.config.jsonc + data dir
├── doctor.ts         # Health self-check (DB / config / port / providers)
├── mcp.ts            # Start the stdio MCP shim
├── migrate.ts        # Run SCHEMA_SQL (idempotent)
├── backup.ts         # Copy SQLite to snapshot
├── version.ts        # Print version from package.json
└── help.ts           # Usage
```

## CONVENTIONS

- **One file per command.** Each exports `async function run(ctx: CliContext): Promise<CommandResult>`.
- `CommandResult = { ok: boolean; message?: string; data?: unknown }`. The CLI entry prints `message` to stdout/stderr and `data` as JSON.
- Subcommands never edit `bootstrap.ts`. `start` just calls into the existing bootstrap.
- `init` is the only command that creates the data dir + config; others assume they exist.

## ANTI-PATTERNS

- **NEVER** add a long-running side effect to a command other than `start` / `mcp`. `doctor` and `status` must exit promptly.
- **NEVER** mutate config without an explicit `--yes` / `--force` flag. (Future-proofing; no flags yet, so just be careful.)
- **NEVER** throw a raw `Error` to the user. Always wrap as `CommandResult { ok: false, message: '...' }`.
