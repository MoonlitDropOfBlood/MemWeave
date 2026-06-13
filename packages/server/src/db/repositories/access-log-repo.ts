import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';
import type { AccessSource } from '../../core/types.js';

export interface RecordAccessInput {
  tenantId: string;
  memoryId: string;
  sessionId: string | null;
  deviceId: string | null;
  source: AccessSource;
  query: string | null;
  rank: number | null;
  score: number | null;
  usedInContext: boolean;
}

export interface AccessLogRecord {
  id: string;
  tenantId: string;
  memoryId: string;
  sessionId: string | null;
  deviceId: string | null;
  source: AccessSource;
  query: string | null;
  rank: number | null;
  score: number | null;
  usedInContext: boolean;
  accessedAt: number;
}

interface AccessLogRow {
  id: string;
  tenant_id: string;
  memory_id: string;
  session_id: string | null;
  device_id: string | null;
  source: AccessSource;
  query: string | null;
  rank: number | null;
  score: number | null;
  used_in_context: number;
  accessed_at: number;
}

export class AccessLogRepo {
  constructor(private readonly db: Db) {}

  record(input: RecordAccessInput): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO access_logs (id, tenant_id, memory_id, session_id, device_id, source, query, rank, score, used_in_context, accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.tenantId,
      input.memoryId,
      input.sessionId,
      input.deviceId,
      input.source,
      input.query,
      input.rank,
      input.score,
      input.usedInContext ? 1 : 0,
      now
    );
    return id;
  }

  listForMemory(tenantId: string, memoryId: string, limit: number): AccessLogRecord[] {
    if (limit <= 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM access_logs
      WHERE tenant_id = ? AND memory_id = ?
      ORDER BY accessed_at DESC, rowid DESC
      LIMIT ?
    `).all(tenantId, memoryId, limit) as AccessLogRow[];
    return rows.map((r) => this.mapRow(r));
  }

  listSince(tenantId: string, sinceMs: number, limit: number): AccessLogRecord[] {
    if (limit <= 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM access_logs
      WHERE tenant_id = ? AND accessed_at >= ?
      ORDER BY accessed_at DESC, rowid DESC
      LIMIT ?
    `).all(tenantId, sinceMs, limit) as AccessLogRow[];
    return rows.map((r) => this.mapRow(r));
  }

  purgeOlderThan(cutoffMs: number): number {
    const result = this.db.prepare(`
      DELETE FROM access_logs WHERE accessed_at < ?
    `).run(cutoffMs);
    return Number(result.changes);
  }

  private mapRow(row: AccessLogRow): AccessLogRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      memoryId: row.memory_id,
      sessionId: row.session_id,
      deviceId: row.device_id,
      source: row.source,
      query: row.query,
      rank: row.rank,
      score: row.score,
      usedInContext: row.used_in_context === 1,
      accessedAt: row.accessed_at
    };
  }
}
