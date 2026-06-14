import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

const PID_FILENAME = 'memweave.pid';

/**
 * `memweave start` — load config, open DB, start HTTP server + schedulers.
 *
 * This delegates to the same `createHttpServer` + `startConsolidationScheduler`
 * used by the legacy `src/server/bootstrap.ts`, so behavior is identical.
 */
export const startCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const dbPath = expandPath(config.storage.path);

  // Lazy import to avoid pulling fastify in tests of the parser itself.
  const { createHttpServer } = await import('../server/http.js');
  const { startConsolidationScheduler } = await import('../server/scheduler.js');

  const app = await createHttpServer({ dbPath, configPath: ctx.configPath });
  if (config.consolidation.enabled) {
    startConsolidationScheduler({
      dbPath,
      intervalMs: config.consolidation.intervalHours * 60 * 60 * 1000,
      runOnStart: true
    });
  }
  await app.listen({ host: config.server.host, port: config.server.port });

  // Write a PID file so `memweave stop` can find us. Mirrors the legacy
  // server/bootstrap.ts behavior. We also clean up on exit so a stale file
  // never points at a dead process.
  const pidPath = join(tmpdir(), PID_FILENAME);
  writeFileSync(pidPath, String(process.pid), 'utf8');
  const cleanup = (): void => {
    try { unlinkSync(pidPath); } catch { /* already gone */ }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });

  return {
    ok: true,
    message: `memweave-server listening on ${config.server.host}:${config.server.port}`,
    data: { host: config.server.host, port: config.server.port, dbPath, pidPath, pid: process.pid }
  };
};
