import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';

export interface CreateDeviceInput {
  tenantId: string;
  name: string;
  /** Client identifier (open-ended: 'opencode', 'zcode', 'rest', etc.). */
  type: string;
  apiKeyHash: string;
}

export interface DeviceRecord {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  apiKeyHash: string;
  lastSeenAt: number | null;
  registeredAt: number;
}

interface DeviceRow {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  api_key_hash: string;
  last_seen_at: number | null;
  registered_at: number;
}

export class DeviceRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateDeviceInput): DeviceRecord {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO devices (id, tenant_id, name, type, api_key_hash, last_seen_at, registered_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(id, input.tenantId, input.name, input.type, input.apiKeyHash, now);

    return {
      id,
      tenantId: input.tenantId,
      name: input.name,
      type: input.type,
      apiKeyHash: input.apiKeyHash,
      lastSeenAt: null,
      registeredAt: now
    };
  }

  getById(tenantId: string, id: string): DeviceRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM devices WHERE tenant_id = ? AND id = ?
    `).get(tenantId, id) as DeviceRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  findByKeyHash(apiKeyHash: string): DeviceRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM devices WHERE api_key_hash = ? LIMIT 1
    `).get(apiKeyHash) as DeviceRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  list(tenantId: string): DeviceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM devices WHERE tenant_id = ?
      ORDER BY registered_at DESC, rowid DESC
    `).all(tenantId) as DeviceRow[];
    return rows.map((r) => this.mapRow(r));
  }

  touch(id: string): void {
    this.db.prepare(`
      UPDATE devices SET last_seen_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
  }

  private mapRow(row: DeviceRow): DeviceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      type: row.type,
      apiKeyHash: row.api_key_hash,
      lastSeenAt: row.last_seen_at,
      registeredAt: row.registered_at
    };
  }
}
