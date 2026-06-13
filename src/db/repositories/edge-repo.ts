import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';
import type { EdgeType } from '../../core/types.js';

export interface CreateEdgeInput {
  tenantId: string;
  fromMemoryId: string;
  toMemoryId: string;
  type: EdgeType;
  strength: number;
  reason: string;
}

export interface EdgeRecord {
  id: string;
  tenantId: string;
  fromMemoryId: string;
  toMemoryId: string;
  type: EdgeType;
  strength: number;
  reason: string;
  createdAt: number;
}

export interface NeighborEdge {
  edgeId: string;
  type: EdgeType;
  strength: number;
  reason: string;
  direction: 'out' | 'in';
  neighborId: string;
  createdAt: number;
}

interface EdgeRow {
  id: string;
  tenant_id: string;
  from_memory_id: string;
  to_memory_id: string;
  type: EdgeType;
  strength: number;
  reason: string;
  created_at: number;
}

export class EdgeRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateEdgeInput): EdgeRecord {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO edges (id, tenant_id, from_memory_id, to_memory_id, type, strength, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.tenantId, input.fromMemoryId, input.toMemoryId, input.type, input.strength, input.reason, now);
    return {
      id,
      tenantId: input.tenantId,
      fromMemoryId: input.fromMemoryId,
      toMemoryId: input.toMemoryId,
      type: input.type,
      strength: input.strength,
      reason: input.reason,
      createdAt: now
    };
  }

  getOutgoing(tenantId: string, memoryId: string): EdgeRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM edges
      WHERE tenant_id = ? AND from_memory_id = ?
      ORDER BY created_at DESC
    `).all(tenantId, memoryId) as EdgeRow[];
    return rows.map(this.mapRow);
  }

  getIncoming(tenantId: string, memoryId: string): EdgeRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM edges
      WHERE tenant_id = ? AND to_memory_id = ?
      ORDER BY created_at DESC
    `).all(tenantId, memoryId) as EdgeRow[];
    return rows.map(this.mapRow);
  }

  getNeighbors(
    tenantId: string,
    memoryId: string,
    direction: 'in' | 'out' | 'both' = 'both',
    edgeTypes?: EdgeType[]
  ): NeighborEdge[] {
    const typeFilter = edgeTypes && edgeTypes.length > 0
      ? `AND type IN (${edgeTypes.map(() => '?').join(',')})`
      : '';
    const params: unknown[] = [tenantId, memoryId];
    if (edgeTypes && edgeTypes.length > 0) params.push(...edgeTypes);

    const results: NeighborEdge[] = [];

    if (direction === 'out' || direction === 'both') {
      const outRows = this.db.prepare(`
        SELECT id, type, strength, reason, to_memory_id, created_at
        FROM edges
        WHERE tenant_id = ? AND from_memory_id = ? ${typeFilter}
        ORDER BY created_at DESC
      `).all(...params) as Array<{ id: string; type: EdgeType; strength: number; reason: string; to_memory_id: string; created_at: number }>;
      for (const r of outRows) {
        results.push({
          edgeId: r.id,
          type: r.type,
          strength: r.strength,
          reason: r.reason,
          direction: 'out',
          neighborId: r.to_memory_id,
          createdAt: r.created_at
        });
      }
    }

    if (direction === 'in' || direction === 'both') {
      const inRows = this.db.prepare(`
        SELECT id, type, strength, reason, from_memory_id, created_at
        FROM edges
        WHERE tenant_id = ? AND to_memory_id = ? ${typeFilter}
        ORDER BY created_at DESC
      `).all(...params) as Array<{ id: string; type: EdgeType; strength: number; reason: string; from_memory_id: string; created_at: number }>;
      for (const r of inRows) {
        results.push({
          edgeId: r.id,
          type: r.type,
          strength: r.strength,
          reason: r.reason,
          direction: 'in',
          neighborId: r.from_memory_id,
          createdAt: r.created_at
        });
      }
    }

    return results;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM edges WHERE id = ?').run(id);
  }

  private mapRow(row: EdgeRow): EdgeRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      fromMemoryId: row.from_memory_id,
      toMemoryId: row.to_memory_id,
      type: row.type,
      strength: row.strength,
      reason: row.reason,
      createdAt: row.created_at
    };
  }
}
