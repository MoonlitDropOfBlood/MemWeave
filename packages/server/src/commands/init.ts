import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../core/config.js';
import { expandPath, expandEnv } from '../core/config.js';
import { openDatabase } from '../db/database.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

const DEFAULT_CONFIG_JSONC = `{
  // MemWeave config (JSONC: comments allowed)
  "server": {
    "host": "127.0.0.1",
    "port": 3131
  },
  "storage": {
    "path": "~/.memweave/data/memweave.db"
  },
  "auth": {
    "defaultTenantName": "default",
    "deviceApiKey": "REPLACE_WITH_RANDOM_KEY"
  }
}
`;

/**
 * `memweave init` — create the config dir, default config file (if missing),
 * the SQLite DB, and a default tenant + device with a random API key.
 *
 * Idempotent: re-running `init` won't clobber existing state. It only
 * creates things that don't already exist.
 */
export const initCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const configDir = join(homedir(), '.memweave');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'data'), { recursive: true });

  const configPath = ctx.configPath ?? join(configDir, 'config.jsonc');
  if (!existsSync(configPath)) {
    const apiKey = randomBytes(24).toString('hex');
    const body = DEFAULT_CONFIG_JSONC.replace('REPLACE_WITH_RANDOM_KEY', apiKey);
    writeFileSync(configPath, body, 'utf8');
  }

  const config = loadConfig(configPath);
  const dbPath = expandPath(config.storage.path);
  // Force env:// expansion in case the config uses placeholders
  void expandEnv(config.auth.deviceApiKey);

  // Open DB (applies schema) and ensure default tenant + device
  const db = openDatabase(dbPath);
  try {
    db.prepare('INSERT OR IGNORE INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('tenant_default', config.auth.defaultTenantName, config.auth.deviceApiKey, Date.now());
  } finally {
    db.close();
  }

  return {
    ok: true,
    message: `Initialized memweave at ${configDir}`,
    data: { configPath, dbPath }
  };
};
