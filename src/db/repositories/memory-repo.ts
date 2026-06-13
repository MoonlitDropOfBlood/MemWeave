import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';
import type { AccessLogInput, CreateMemoryInput, MemoryRecord, ScopeTag } from '../../core/types.js';
import { initialStrengthFromImportance, reinforcementBoost, tauFor } from '../../core/decay.js';

interface MemoryRow {
  id: string;
  tenant_id: string;
  tier: 'short' | 'medium' | 'long';
  type: MemoryRecord['type'];
  title: string;
  content: string;
  summary: string;
  concepts_json: string;
  files_json: string;
  importance: number;
  confidence: number;
  strength: number;
  source: MemoryRecord['source'];
  scope_level: MemoryRecord['scopeLevel'];
  source_client: MemoryRecord['sourceClient'];
  source_device_id: string | null;
  source_session_id: string | null;
  tau: number;
  access_count: number;
  last_accessed_at: number | null;
  last_reinforced_at: number | null;
  last_decay_at: number | null;
  reinforcement_score: number;
  promoted_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  eviction_reason: string | null;
}

export class MemoryRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateMemoryInput): MemoryRecord {
    const now = Date.now();
    const id = randomUUID();
    const tier = input.importance >= 10 ? 'long' : input.importance >= 7 && input.confidence > 0.75 ? 'medium' : 'short';
    const strength = initialStrengthFromImportance(input.importance);
    const tau = tauFor(tier, input.importance);
    const conceptsJson = JSON.stringify(input.concepts);
    const filesJson = JSON.stringify(input.files);
    const conceptsText = input.concepts.join(' ');

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memories (
          id, tenant_id, tier, type, title, content, summary,
          concepts_json, concepts_text, files_json, importance, confidence,
          strength, source, scope_level, source_client, source_device_id,
          source_session_id, tau, access_count, last_accessed_at,
          last_reinforced_at, last_decay_at, reinforcement_score,
          promoted_at, created_at, updated_at, deleted_at, eviction_reason
        ) VALUES (
          @id, @tenantId, @tier, @type, @title, @content, @summary,
          @conceptsJson, @conceptsText, @filesJson, @importance, @confidence,
          @strength, @source, @scopeLevel, @sourceClient, @sourceDeviceId,
          @sourceSessionId, @tau, 0, NULL, NULL, @now, 0,
          NULL, @now, @now, NULL, NULL
        )
      `).run({ ...input, id, tier, strength, tau, conceptsJson, conceptsText, filesJson, now });

      const scopeStmt = this.db.prepare(`
        INSERT INTO memory_scopes (memory_id, tenant_id, key, value, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const scope of input.scopes) scopeStmt.run(id, input.tenantId, scope.key, scope.value, now);
    });
    tx();

    const created = this.getById(input.tenantId, id);
    if (!created) throw new Error(`Failed to create memory ${id}`);
    return created;
  }

  getById(tenantId: string, id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL')
      .get(tenantId, id) as MemoryRow | undefined;
    if (!row) return null;
    const scopes = this.db.prepare('SELECT key, value FROM memory_scopes WHERE tenant_id = ? AND memory_id = ? ORDER BY key, value')
      .all(tenantId, id) as ScopeTag[];
    return this.mapRow(row, scopes);
  }

  recordAccess(input: AccessLogInput): void {
    const now = Date.now();
    const id = randomUUID();
    const boost = reinforcementBoost({
      usedInContext: input.usedInContext,
      explicitReference: false,
      userConfirmed: false
    });

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO access_logs (
          id, tenant_id, memory_id, session_id, device_id,
          source, query, rank, score, used_in_context, accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      this.db.prepare(`
        UPDATE memories
        SET access_count = access_count + 1,
            last_accessed_at = ?,
            last_reinforced_at = CASE WHEN ? >= 0.1 THEN ? ELSE last_reinforced_at END,
            reinforcement_score = min(1, reinforcement_score + ?),
            strength = min(1, strength + ?),
            updated_at = ?
        WHERE tenant_id = ? AND id = ?
      `).run(now, boost, now, boost, boost, now, input.tenantId, input.memoryId);
    });
    tx();
  }

  private mapRow(row: MemoryRow, scopes: ScopeTag[]): MemoryRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      tier: row.tier,
      type: row.type,
      title: row.title,
      content: row.content,
      summary: row.summary,
      concepts: JSON.parse(row.concepts_json) as string[],
      files: JSON.parse(row.files_json) as string[],
      importance: row.importance,
      confidence: row.confidence,
      strength: row.strength,
      source: row.source,
      scopeLevel: row.scope_level,
      scopes,
      sourceClient: row.source_client,
      sourceDeviceId: row.source_device_id,
      sourceSessionId: row.source_session_id,
      tau: row.tau,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      lastReinforcedAt: row.last_reinforced_at,
      lastDecayAt: row.last_decay_at,
      reinforcementScore: row.reinforcement_score,
      promotedAt: row.promoted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      evictionReason: row.eviction_reason
    };
  }
}
