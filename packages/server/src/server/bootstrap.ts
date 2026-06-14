import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { expandPath, loadConfig } from '../core/config.js';
import { createHttpServer } from './http.js';
import { startConsolidationScheduler } from './scheduler.js';
import { logger } from './logger.js';

// Resolution order for the config file:
//   1. $MEMWEAVE_CONFIG (explicit override)
//   2. ~/.memweave/config.jsonc (the default `memweave init` target)
// Without step 2, a global `npm i -g @mem-weave/server` install would silently
// fall back to schema defaults (llm/embedding = noop) and the user has no
// signal that their config file was ignored.
const explicit = process.env.MEMWEAVE_CONFIG;
const fallback = join(homedir(), '.memweave', 'config.jsonc');
const configPath = explicit ?? (existsSync(fallback) ? fallback : undefined);
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
