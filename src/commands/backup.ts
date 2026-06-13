import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

/**
 * `memweave backup [path]` — copy the SQLite DB to a snapshot file.
 *
 * Uses SQLite's recommended "backup" semantics: a simple file copy. For
 * very large DBs a proper `.backup` would be safer, but file copy is
 * acceptable for v1 since we use WAL mode.
 */
export const backupCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const dbPath = expandPath(config.storage.path);
  if (!existsSync(dbPath)) {
    return { ok: false, message: `Database file not found: ${dbPath}` };
  }

  const dest = ctx.args[0] ?? `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(dbPath, dest);

  const srcSize = statSync(dbPath).size;
  return {
    ok: true,
    message: `Backed up ${dbPath} (${srcSize} bytes) to ${dest}`,
    data: { source: dbPath, dest, size: srcSize }
  };
};
