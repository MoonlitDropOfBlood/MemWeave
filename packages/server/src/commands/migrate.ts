import { loadConfig } from '../core/config.js';
import { expandPath } from '../core/config.js';
import { openDatabase } from '../db/database.js';
import { runConsolidation } from '../workers/consolidator.js';
import type { CliContext, CommandResult, CommandHandler } from './index.js';

/**
 * `memweave migrate` — apply the schema (idempotent: CREATE TABLE IF NOT EXISTS)
 * and run a one-shot consolidation pass.
 */
export const migrateCommand: CommandHandler = async (ctx: CliContext): Promise<CommandResult> => {
  const config = loadConfig(ctx.configPath);
  const dbPath = expandPath(config.storage.path);
  const db = openDatabase(dbPath);
  try {
    const tables = db.prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'`).get() as { c: number };
    const consolidation = runConsolidation(db, 'tenant_default', { dryRun: true });
    return {
      ok: true,
      message: `Schema applied. ${tables.c} tables present.`,
      data: { dbPath, tableCount: tables.c, consolidationPreview: consolidation }
    };
  } finally {
    db.close();
  }
};
