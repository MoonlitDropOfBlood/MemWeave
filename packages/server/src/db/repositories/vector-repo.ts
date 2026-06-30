import type { Db } from '../database.js';
import { VECTOR_DEFAULT_DIMENSIONS } from '../database.js';

/**
 * Name of the plain (non-virtual) table that stores memory embeddings as
 * Float32Array BLOBs. Defined centrally here so the repo and the search
 * layer agree; the table itself is created by `openDatabase` (VECTOR_TABLE_SQL).
 */
export const VECTOR_TABLE_NAME = 'memory_vectors';

export class VectorRepo {
  constructor(
    private readonly db: Db,
    private readonly dimensions: number = VECTOR_DEFAULT_DIMENSIONS
  ) {}

  /**
   * Upsert a single embedding. Inserts a new row or replaces an existing one
   * (matching by memory_id). The vector is stored as a Float32Array BLOB.
   */
  upsert(memoryId: string, tenantId: string, vector: number[]): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`
      );
    }
    const exists = this.tableExists();
    if (!exists) {
      // Vectors table not present (opened with skipVectorExtension); no-op.
      return;
    }
    const now = Date.now();
    const buf = Buffer.from(new Float32Array(vector).buffer);
    // UPSERT on memory_id (primary key).
    this.db.prepare(`
      INSERT INTO ${VECTOR_TABLE_NAME} (memory_id, tenant_id, dimensions, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `).run(memoryId, tenantId, this.dimensions, buf, now);
  }

  /** Remove the embedding for a memory. */
  delete(memoryId: string): void {
    if (!this.tableExists()) return;
    this.db.prepare(`DELETE FROM ${VECTOR_TABLE_NAME} WHERE memory_id = ?`).run(memoryId);
  }

  /** Count embeddings for this dimension. */
  count(): number {
    if (!this.tableExists()) return 0;
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM ${VECTOR_TABLE_NAME} WHERE dimensions = ?`)
      .get(this.dimensions) as { cnt: number };
    return row.cnt;
  }

  private tableExists(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(VECTOR_TABLE_NAME) as { name: string } | undefined;
    return !!row;
  }
}
