import { expandPath, loadConfig } from '../core/config.js';
import { createHttpServer } from './http.js';
import { startConsolidationScheduler } from './scheduler.js';
import { logger } from './logger.js';

const configPath = process.env.MEMWEAVE_CONFIG;
const config = loadConfig(configPath);
const dbPath = expandPath(config.storage.path);
const app = await createHttpServer({ dbPath, configPath });

// Background consolidation: every 6 hours, also run once on startup so any
// pending promotions/evictions are applied. Disable by setting MEMWEAVE_NO_SCHEDULER=1.
if (process.env.MEMWEAVE_NO_SCHEDULER !== '1') {
  const scheduler = startConsolidationScheduler({
    dbPath,
    intervalMs: 6 * 60 * 60 * 1000,
    runOnStart: true,
    onRun: (r) => {
      logger.info({ event: 'consolidation', ...r }, r.summary);
    }
  });

  // Stop the scheduler gracefully on process exit
  const shutdown = (): void => {
    scheduler.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

await app.listen({ host: config.server.host, port: config.server.port });
logger.info({ host: config.server.host, port: config.server.port }, 'memweave server listening');
