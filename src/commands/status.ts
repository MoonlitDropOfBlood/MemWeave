import { loadConfig } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

/**
 * `memweave status` — probe the running memweave-server's health endpoint.
 */
export const statusCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const url = `http://${config.server.host}:${config.server.port}/api/v1/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { ok: false, message: `Health check returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, message: 'memweave-server is up.', data };
  } catch (err) {
    return { ok: false, message: `Cannot reach ${url}: ${(err as Error).message}` };
  }
};
