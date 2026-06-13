/**
 * Shared structured logger. Built on pino (already a dependency). The
 * Fastify server has its own pino instance internally (`logger: false`
 * in `http.ts` disables it for now; can be enabled later). This module
 * is for *operational* logging from CLI, scheduler, workers, and the
 * OpenCode plugin.
 *
 * Why pino and not console.*?
 *   - Structured (JSON) output — operators can pipe to jq / log aggregators
 *   - Level filtering via LOG_LEVEL env (default: info)
 *   - Child loggers for per-tenant / per-run context
 *   - Benchmarks ~5x faster than console.* under load
 *
 * Usage:
 *   import { logger } from './logger.js';
 *   logger.info({ memoryId, action: 'reinforced' }, 'memory reinforced');
 *   logger.warn({ err }, 'consolidation failed');
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const options: LoggerOptions = {
  level: LOG_LEVEL,
  // Pretty-print only in dev; in production, leave as JSON for log shippers.
  // We avoid pino-pretty as a hard dep to keep install lean.
  base: { service: 'memweave' },
  timestamp: pino.stdTimeFunctions.isoTime
};

export const logger: Logger = pino(options);

/**
 * Create a child logger with a fixed context (e.g., tenantId, runId).
 * Use this for sub-operations that should share context across multiple
 * log lines.
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
