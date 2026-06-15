import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';
import type { SourceClient } from '../../core/types.js';

export interface CreateSessionInput {
  tenantId: string;
  deviceId: string | null;
  source: SourceClient;
  title: string;
}

export interface SessionRecord {
  id: string;
  tenantId: string;
  deviceId: string | null;
  source: SourceClient;
  title: string;
  summary: string | null;
  startedAt: number;
  endedAt: number | null;
  observationCount: number;
}

export interface SessionMemorySummary {
  id: string;
  type: string;
  tier: string;
  title: string;
  summary: string;
  strength: number;
  importance: number;
  createdAt: number;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  device_id: string | null;
  source: SourceClient;
  title: string;
  summary: string | null;
  started_at: number;
  ended_at: number | null;
  observation_count: number;
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateSessionInput): SessionRecord {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, tenant_id, device_id, source, title, summary, started_at, ended_at, observation_count)
      VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0)
    `).run(id, input.tenantId, input.deviceId, input.source, input.title, now);

    return {
      id,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      source: input.source,
      title: input.title,
      summary: null,
      startedAt: now,
      endedAt: null,
      observationCount: 0
    };
  }

  /**
   * Idempotent: returns the existing session for `sessionId` if present,
   * otherwise creates a new one. Lets clients (e.g. the OpenCode plugin)
   * POST the same session many times without growing duplicates.
   *
   * NOTE: when a record already exists, the new `title` is NOT applied
   * — the original is preserved. We may want to update title in a
   * follow-up.
   */
  findOrCreate(input: CreateSessionInput & { sessionId: string }): {
    record: SessionRecord;
    created: boolean;
  } {
    const existing = this.getById(input.tenantId, input.sessionId);
    if (existing) return { record: existing, created: false };
    // SessionRepo.create() generates its own UUID — to honour the
    // caller-supplied id we build the row directly here.
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, tenant_id, device_id, source, title, summary, started_at, ended_at, observation_count)
      VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0)
    `).run(input.sessionId, input.tenantId, input.deviceId, input.source, input.title, now);

    return {
      record: {
        id: input.sessionId,
        tenantId: input.tenantId,
        deviceId: input.deviceId,
        source: input.source,
        title: input.title,
        summary: null,
        startedAt: now,
        endedAt: null,
        observationCount: 0,
      },
      created: true,
    };
  }

  getById(tenantId: string, id: string): SessionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions WHERE tenant_id = ? AND id = ?
    `).get(tenantId, id) as SessionRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listRecent(tenantId: string, limit: number): SessionRecord[] {
    if (limit <= 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE tenant_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?
    `).all(tenantId, limit) as SessionRow[];
    return rows.map((r) => this.mapRow(r));
  }

  end(id: string): void {
    this.db.prepare(`
      UPDATE sessions SET ended_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  listMemories(tenantId: string, sessionId: string): SessionMemorySummary[] {
    const rows = this.db.prepare(`
      SELECT id, type, tier, title, summary, strength, importance, created_at
      FROM memories
      WHERE tenant_id = ? AND source_session_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `).all(tenantId, sessionId) as Array<{
      id: string;
      type: string;
      tier: string;
      title: string;
      summary: string;
      strength: number;
      importance: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      tier: r.tier,
      title: r.title,
      summary: r.summary,
      strength: r.strength,
      importance: r.importance,
      createdAt: r.created_at
    }));
  }

  private mapRow(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      deviceId: row.device_id,
      source: row.source,
      title: row.title,
      summary: row.summary,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      observationCount: row.observation_count
    };
  }
}
