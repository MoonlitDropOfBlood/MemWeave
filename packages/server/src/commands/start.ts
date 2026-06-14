import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

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
  return {
    ok: true,
    message: `memweave-server listening on ${config.server.host}:${config.server.port}`,
    data: { host: config.server.host, port: config.server.port, dbPath }
  };
};
