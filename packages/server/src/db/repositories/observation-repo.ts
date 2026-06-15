import { randomUUID } from 'node:crypto';
import type { Db } from '../database.js';

export interface CreateObservationInput {
  sessionId: string;
  tenantId: string;
  hookType: string;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  memoryId: string | null;
}

export interface ObservationRecord {
  id: string;
  sessionId: string;
  tenantId: string;
  hookType: string;
  toolName: string | null;
  toolInput: string | null;
  toolOutput: string | null;
  timestamp: number;
  memoryId: string | null;
  processed: boolean;
}

interface ObservationRow {
  id: string;
  session_id: string;
  tenant_id: string;
  hook_type: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  timestamp: number;
  memory_id: string | null;
  processed: number;
}

export class ObservationRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateObservationInput): ObservationRecord {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO observations (id, session_id, tenant_id, hook_type, tool_name, tool_input, tool_output, timestamp, memory_id, processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, input.sessionId, input.tenantId, input.hookType, input.toolName, input.toolInput, input.toolOutput, now, input.memoryId);

    return {
      id,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      hookType: input.hookType,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
      timestamp: now,
      memoryId: input.memoryId,
      processed: false
    };
  }

  /**
   * Idempotent: returns the existing record if (sessionId, messageId) is
   * already present, otherwise creates a new one. We use `tool_input` to
   * stash the message id JSON for chat.* observations — the column is
   * already in the schema and not used for chat-only hook types.
   */
  createOrGetByMessageId(input: CreateObservationInput & { messageId: string }): {
    record: ObservationRecord;
    created: boolean;
  } {
    const existing = this.findByMessageId(input.tenantId, input.sessionId, input.messageId);
    if (existing) return { record: existing, created: false };
    const record = this.create(input);
    return { record, created: true };
  }

  /** Find an observation by the (sessionId, messageId) pair encoded into `tool_input`. */
  findByMessageId(tenantId: string, sessionId: string, messageId: string): ObservationRecord | null {
    // tool_input is JSON: { messageId: "msg_xyz", role: "user" | "assistant" } for chat.* hooks
    // Use LIKE with a deterministic prefix to avoid JSON parse overhead on the hot path.
    const tag = `"messageId":"${messageId.replace(/"/g, '')}"`;
    const row = this.db.prepare(`
      SELECT * FROM observations
      WHERE tenant_id = ? AND session_id = ? AND tool_input LIKE ?
      LIMIT 1
    `).get(tenantId, sessionId, `%${tag}%`) as ObservationRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  getById(tenantId: string, id: string): ObservationRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM observations WHERE tenant_id = ? AND id = ?
    `).get(tenantId, id) as ObservationRow | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  listUnprocessed(tenantId: string, limit: number): ObservationRecord[] {
    if (limit <= 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM observations
      WHERE tenant_id = ? AND processed = 0
      ORDER BY timestamp ASC, rowid ASC
      LIMIT ?
    `).all(tenantId, limit) as ObservationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  markProcessed(id: string, memoryId: string | null): void {
    this.db.prepare(`
      UPDATE observations SET processed = 1, memory_id = ? WHERE id = ?
    `).run(memoryId, id);
  }

  private mapRow(row: ObservationRow): ObservationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      hookType: row.hook_type,
      toolName: row.tool_name,
      toolInput: row.tool_input,
      toolOutput: row.tool_output,
      timestamp: row.timestamp,
      memoryId: row.memory_id,
      processed: row.processed === 1
    };
  }
}
