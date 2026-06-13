import type { Db } from '../database.js';
import { getVecTableName, VECTOR_DEFAULT_DIMENSIONS } from '../database.js';

export class VectorRepo {
  constructor(
    private readonly db: Db,
    private readonly dimensions: number = VECTOR_DEFAULT_DIMENSIONS
  ) {}

  /**
   * Upsert a single embedding. Inserts a new row or replaces an existing one
   * (matching by memory_id).
   */
  upsert(memoryId: string, tenantId: string, vector: number[]): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`
      );
    }
    const tableName = getVecTableName(this.dimensions);
    const exists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName) as { name: string } | undefined;
    if (!exists) {
      // Vec table not present (sqlite-vec unavailable); silently no-op.
      return;
    }
    // sqlite-vec's vec0 primary-key behavior is rowid-based; use a manual
    // delete-then-insert to guarantee a clean replacement. We wrap in a
    // transaction for atomicity.
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${tableName} WHERE memory_id = ?`).run(memoryId);
      this.db.prepare(`
        INSERT INTO ${tableName} (memory_id, tenant_id, embedding)
        VALUES (?, ?, ?)
      `).run(memoryId, tenantId, new Float32Array(vector));
    });
    tx();
  }

  /** Remove the embedding for a memory. */
  delete(memoryId: string): void {
    const tableName = getVecTableName(this.dimensions);
    this.db.prepare(`
      DELETE FROM ${tableName} WHERE memory_id = ?
    `).run(memoryId);
  }

  /** Count embeddings in the vec table. */
  count(): number {
    const tableName = getVecTableName(this.dimensions);
    const exists = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName) as { name: string } | undefined;
    if (!exists) return 0;
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
    return row.cnt;
  }
}
