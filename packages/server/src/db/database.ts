import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import { logger } from '../server/logger.js';

const _require = createRequire(import.meta.url);

export type Db = Database.Database;

/**
 * Default dimensions for the memory_vectors vec0 table. The actual configured
 * dimensions come from the EmbeddingConfig; the table is created lazily by
 * `openDatabase` and recreated when the configured dimensions change.
 */
export const VECTOR_DEFAULT_DIMENSIONS = 768;

function vecTableName(dimensions: number): string {
  return `memory_vectors_${dimensions}`;
}

function ensureVecTable(db: Db, dimensions: number): void {
  const tableName = vecTableName(dimensions);
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined;

  if (!exists) {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(
         memory_id TEXT PRIMARY KEY,
         tenant_id TEXT,
         embedding float[${dimensions}]
       )`
    );
  }
}

export interface OpenDatabaseOptions {
  /** When provided, creates the vec0 table for these dimensions (idempotent). */
  vectorDimensions?: number;
  /** When true, skip loading sqlite-vec (useful for unit tests that don't need vectors). */
  skipVectorExtension?: boolean;
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(SCHEMA_SQL);

  if (!options.skipVectorExtension) {
    try {
      // Load sqlite-vec (a no-op if the package isn't installed, but we install it
      // as a regular dependency so the binary is always present in production).
      // Use a dynamic import to avoid hard-failing test environments that
      // exercise only non-vector code paths.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sqliteVec = _require('sqlite-vec');
      sqliteVec.load(db);

      const dims = options.vectorDimensions ?? VECTOR_DEFAULT_DIMENSIONS;
      ensureVecTable(db, dims);
    } catch (err) {
      // sqlite-vec unavailable — vector search will be a no-op
      // (search engine handles missing vector layer gracefully).
      // We intentionally do not throw — rest of system must work without it.
      logger.warn({ err: (err as Error).message }, 'sqlite-vec not available, vector search disabled');
    }
  }

  return db;
}

export function getVecTableName(dimensions: number): string {
  return vecTableName(dimensions);
}

export function transaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
