import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import { openDatabase } from '../db/database.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * `memweave doctor` — environment / configuration health check.
 *
 * Checks:
 *  - config loads cleanly
 *  - DB file is reachable and the schema applies
 *  - port is free
 *  - sqlite-vec extension loads (when used)
 *  - LLM provider has a usable API key (when not noop)
 *  - Embedding provider has a usable config (when not noop)
 */
export const doctorCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const results: CheckResult[] = [];

  // 1. Config loads
  let config;
  try {
    config = loadConfig(ctx.configPath);
    results.push({ name: 'config', ok: true, detail: 'loaded' });
  } catch (err) {
    return { ok: false, message: 'Config load failed', data: { results, error: (err as Error).message } };
  }

  const dbPath = expandPath(config.storage.path);

  // 2. DB open + schema
  try {
    const db = openDatabase(dbPath, { vectorDimensions: config.embedding.dimensions });
    try {
      const tables = db.prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'`).get() as { c: number };
      results.push({ name: 'database', ok: true, detail: `${tables.c} tables; path=${dbPath}` });
    } finally {
      db.close();
    }
  } catch (err) {
    results.push({ name: 'database', ok: false, detail: (err as Error).message });
  }

  // 3. Port available
  try {
    const probe = await fetch(`http://127.0.0.1:${config.server.port}/api/v1/health`, {
      signal: AbortSignal.timeout(500)
    });
    if (probe.ok) {
      results.push({ name: 'port', ok: true, detail: `port ${config.server.port} already serving (likely already running)` });
    } else {
      results.push({ name: 'port', ok: true, detail: `port ${config.server.port} responding but not OK` });
    }
  } catch {
    results.push({ name: 'port', ok: true, detail: `port ${config.server.port} appears free` });
  }

  // 4. sqlite-vec
  try {
    const db = openDatabase(dbPath, { vectorDimensions: config.embedding.dimensions });
    try {
      const v = (db.prepare(`SELECT vec_version() AS v`).get() as { v: string });
      results.push({ name: 'sqlite-vec', ok: true, detail: v.v });
    } catch (err) {
      results.push({ name: 'sqlite-vec', ok: false, detail: (err as Error).message });
    } finally {
      db.close();
    }
  } catch {
    results.push({ name: 'sqlite-vec', ok: false, detail: 'extension failed to load' });
  }

  // 5. LLM
  if (config.llm.provider === 'openai-compatible') {
    const hasKey = Boolean(config.llm.apiKey);
    results.push({ name: 'llm', ok: hasKey, detail: hasKey ? 'apiKey set' : 'apiKey missing' });
  } else {
    results.push({ name: 'llm', ok: true, detail: 'noop' });
  }

  // 6. Embedding
  if (config.embedding.provider === 'openai-compatible') {
    const ok = Boolean(config.embedding.apiKey) && Boolean(config.embedding.baseUrl);
    results.push({ name: 'embedding', ok, detail: ok ? 'configured' : 'apiKey or baseUrl missing' });
  } else if (config.embedding.provider === 'local-xenova') {
    results.push({ name: 'embedding', ok: true, detail: 'local-xenova (stub in v1)' });
  } else {
    results.push({ name: 'embedding', ok: true, detail: 'noop' });
  }

  // 7. PID file existence (informational)
  const pidPath = join(tmpdir(), 'memweave.pid');
  results.push({
    name: 'pid-file',
    ok: true,
    detail: existsSync(pidPath) ? `${pidPath} present` : 'none (server not started via CLI)'
  });

  const allOk = results.every((r) => r.ok);
  return {
    ok: allOk,
    message: allOk ? 'All checks passed.' : 'Some checks failed.',
    data: { results }
  };
};
