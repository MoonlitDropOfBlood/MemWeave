import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './schema.js';
import { logger } from '../server/logger.js';
import { DatabaseAdapter, type Db } from './driver-adapter.js';

export type { Db } from './driver-adapter.js';

/**
 * Default dimensions for the `memory_vectors` table. The actual configured
 * dimensions come from the EmbeddingConfig; the table is created lazily by
 * `openDatabase`.
 */
export const VECTOR_DEFAULT_DIMENSIONS = 768;

/**
 * Plain (non-virtual) table that stores one Float32Array embedding per memory.
 *
 * Replaces the previous `vec0` virtual table (sqlite-vec). We migrated off
 * sqlite-vec because `node:sqlite` does not support `loadExtension`, so the
 * loadable vec0 module cannot be used. At memory-system scale (thousands of
 * 768-dim vectors, not millions), brute-force L2 distance in pure JS over a
 * TypedArray cache is sub-millisecond — see `retrieval/vector-search.ts` and
 * the benchmark in `scripts/validate-node-sqlite.mjs`. No native vector
 * extension is needed.
 *
 * The `dimensions` column lets a single table hold vectors of different
 * embedding sizes (e.g. if the configured model changes); queries filter by
 * the active dimension.
 */
const VECTOR_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_vectors_tenant_dim
  ON memory_vectors(tenant_id, dimensions);
`;

export interface OpenDatabaseOptions {
  /** When provided, ensures the vectors table exists for these dimensions (idempotent). */
  vectorDimensions?: number;
  /**
   * When true, skip creating the vectors table (useful for unit tests that
   * don't exercise vector search).
   */
  skipVectorExtension?: boolean;
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseAdapter(path);
  db.exec(SCHEMA_SQL);

  // v0.5.4+ backfill: existing DBs created before observations.scopes_json
  // existed need the column added at startup. SQLite 3.35+ does NOT support
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so we check the schema first.
  // Idempotent: a DB that already has the column is a no-op.
  addColumnIfMissing(db, 'observations', 'scopes_json', "TEXT NOT NULL DEFAULT '[]'");

  if (!options.skipVectorExtension) {
    // Pure-JS vector store: a plain BLOB table, no native extension required.
    // (Previously this loaded sqlite-vec via loadExtension, which node:sqlite
    // does not support. Brute-force JS L2 search replaces it — see
    // retrieval/vector-search.ts.)
    db.exec(VECTOR_TABLE_SQL);
  }

  return db;
}

/**
 * Add a column to a table if it doesn't already exist. SQLite 3.35+
 * does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we
 * inspect `PRAGMA table_info` first. Used by `openDatabase` to backfill
 * columns added in schema revisions (e.g. observations.scopes_json in
 * v0.5.4). Idempotent.
 *
 * The caller is responsible for the `columnDef` matching the latest
 * `SCHEMA_SQL` declaration. If the column exists with a different
 * definition, this function does NOT migrate it (down-migrations are
 * out of scope; release notes cover renames).
 */
function addColumnIfMissing(
  db: Db,
  table: string,
  column: string,
  columnDef: string
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef}`);
  logger.info({ table, column, columnDef }, 'added missing column to existing table');
}

export function transaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
