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

/**
 * Result of a `create` call. When a near-duplicate is detected, the existing
 * memory is reinforced (not duplicated) and returned with `deduped: true`.
 * Callers can use this flag to skip the "your memory was saved" UI prompt
 * and instead show "your memory reinforced an existing one".
 */
export interface CreateResult {
  memory: MemoryRecord;
  deduped: boolean;
  /** ID of the existing memory that was reinforced (only set when deduped=true). */
  reinforcedId?: string;
}

const DEDUP_JACCARD_THRESHOLD = 0.8;

export class MemoryRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateMemoryInput): MemoryRecord {
    return this.createDetailed(input).memory;
  }

  /**
   * Same as `create`, but also reports whether the insert was a dedup
   * hit. REST routes that want to show "merged with X" UI should use this.
   */
  createDetailed(input: CreateMemoryInput): CreateResult {
    // ── Dedup gate (server-side, LLM never knows) ─────────────────────────
    // BM25 against the FTS5 index using title + summary + concepts. Zero
    // embedding cost. Top-3 candidates are scored by Jaccard similarity on
    // the concepts set. A hit means "this is a near-duplicate of an
    // existing memory" → reinforce the existing one instead of inserting
    // a new row. The existing memory's `last_reinforced_at` bumps, its
    // `access_count` increments, and if the new content is richer we
    // upgrade importance + content.
    const dup = this.findNearDuplicate(input);
    if (dup) {
      const reinforced = this.reinforceExisting(dup, input);
      return { memory: reinforced, deduped: true, reinforcedId: dup.id };
    }

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
    return { memory: created, deduped: false };
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

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Find a near-duplicate of `input` already in the DB. Returns the
   * candidate memory, or `null` if none qualifies.
   *
   * Strategy (two-tier):
   *   Tier 1: exact content hash match (for callers that pass
   *     `concepts: []` — typically MCP tools / scripted automation).
   *     If a memory with the same `type` AND content (after
   *     whitespace-normalization) exists, that's a duplicate. This
   *     is cheap (indexed `id` lookup on a per-type scan) and catches
   *     the "same fact re-saved verbatim" case.
   *   Tier 2: Jaccard on concepts (for callers that pass proper
   *     concepts — the typical LLM-driven path). BM25 over
   *     `memory_fts` using the input's concepts as the query, then
   *     Jaccard >= 0.8 on the candidate concepts set.
   *
   * Both tiers require same `type` (a "fact" is never a duplicate of a
   * "decision").
   *
   * Why this two-tier approach? Before this change, callers that
   * passed `concepts: []` (e.g. the MCP `memory_save` tool when invoked
   * from a custom client, the OpenCode plugin's write-side closure,
   * or test scripts) bypassed dedup entirely — they could create
   * the same memory 3, 10, 100 times. Tier 1 catches the verbatim case
   * without any client cooperation. Tier 2 remains the smart path
   * for clients that supply good concepts.
   */
  private findNearDuplicate(input: CreateMemoryInput): MemoryRecord | null {
    // ── Tier 1: exact content match (whitespace-normalized) ───────────
    // Catches the "I called memory_save 5 times with the same text"
    // case regardless of concepts. Whitespace-normalize so a few
    // stray spaces don't bypass dedup. Skip if the input has zero
    // content (nothing to compare).
    const normalized = normalizeContent(input.content);
    if (normalized.length > 0) {
      // SQLite LIKE with normalized text — no FTS5 needed for an exact
      // string match, and we have to scan all rows of the same type
      // anyway because we're matching on the post-normalize form.
      // Limit scan to the same tenant + type to keep the scan bounded.
      const candidates = this.db.prepare(`
        SELECT id, content
        FROM memories
        WHERE tenant_id = ? AND type = ? AND deleted_at IS NULL
      `).all(input.tenantId, input.type) as Array<{ id: string; content: string }>;
      for (const row of candidates) {
        if (normalizeContent(row.content) === normalized) {
          return this.getById(input.tenantId, row.id) ?? null;
        }
      }
    }

    // ── Tier 2: Jaccard on concepts (only when concepts are supplied) ──
    const queryTokens = input.concepts
      .map((c) => c.toLowerCase())
      .filter((t) => t.length > 0 && /^[a-z0-9_-]+$/.test(t));
    if (queryTokens.length === 0) return null;

    // OR-join: any concept matching is enough to surface a candidate.
    const ftsQuery = queryTokens.map((t) => `"${t}"`).join(' OR ');

    let rows: Array<{ id: string; type: string; concepts: string }>;
    try {
      rows = this.db.prepare(`
        SELECT m.id AS id, m.type AS type, m.concepts_json AS concepts
        FROM memory_fts f
        JOIN memories m ON m.rowid = f.rowid
        WHERE memory_fts MATCH ?
          AND m.tenant_id = ?
          AND m.deleted_at IS NULL
        ORDER BY rank
        LIMIT 5
      `).all(ftsQuery, input.tenantId) as Array<{ id: string; type: string; concepts: string }>;
    } catch {
      // FTS5 syntax error (shouldn't happen with our sanitized query, but
      // defend anyway). Fall through to "no dedup hit".
      return null;
    }

    if (rows.length === 0) return null;

    const inputConcepts = new Set(input.concepts.map((c) => c.toLowerCase()));
    let bestMatch: { memory: MemoryRecord; score: number } | null = null;

    for (const row of rows) {
      // Type must match — a "fact" is never a duplicate of a "decision".
      if (row.type !== input.type) continue;

      const existingConcepts = new Set(
        (JSON.parse(row.concepts) as string[]).map((c) => c.toLowerCase())
      );
      const jaccard = jaccardSimilarity(inputConcepts, existingConcepts);
      if (jaccard >= DEDUP_JACCARD_THRESHOLD && (!bestMatch || jaccard > bestMatch.score)) {
        const mem = this.getById(input.tenantId, row.id);
        if (mem) bestMatch = { memory: mem, score: jaccard };
      }
    }

    return bestMatch?.memory ?? null;
  }

  /**
   * Bump an existing memory's reinforcement signals and, if the incoming
   * input carries more information (longer content, higher importance),
   * upgrade the existing record's content + importance. Returns the
   * updated memory.
   *
   * Writes an `access_logs` row with `source: 'dedup_reinforce'` so the
   * audit trail is consistent with `recordAccess()` — operators can
   * see "this memory was reinforced by a dedup hit" the same way they
   * see regular retrievals.
   */
  private reinforceExisting(existing: MemoryRecord, incoming: CreateMemoryInput): MemoryRecord {
    const now = Date.now();
    const boost = reinforcementBoost({
      usedInContext: true,  // LLM just saw it via injection → count as used
      explicitReference: false,
      userConfirmed: false
    });

    // Decide whether to merge content. If incoming is strictly longer and
    // has higher importance, upgrade. Otherwise just bump reinforcement
    // and keep the existing content (it's already good enough).
    const incomingIsRicher =
      incoming.content.length > existing.content.length * 1.25 ||
      incoming.importance > existing.importance;

    const tx = this.db.transaction(() => {
      if (incomingIsRicher) {
        // Merge: take the longer content + the max importance + the union of concepts + files
        const mergedConcepts = Array.from(new Set([...existing.concepts, ...incoming.concepts]));
        const mergedFiles = Array.from(new Set([...existing.files, ...incoming.files]));
        const newImportance = Math.max(existing.importance, incoming.importance);

        this.db.prepare(`
          UPDATE memories
          SET content = ?,
              concepts_json = ?,
              concepts_text = ?,
              files_json = ?,
              importance = ?,
              access_count = access_count + 1,
              last_accessed_at = ?,
              last_reinforced_at = ?,
              reinforcement_score = min(1, reinforcement_score + ?),
              strength = min(1, strength + ?),
              updated_at = ?
          WHERE tenant_id = ? AND id = ?
        `).run(
          incoming.content,
          JSON.stringify(mergedConcepts),
          mergedConcepts.join(' '),
          JSON.stringify(mergedFiles),
          newImportance,
          now,
          now,
          boost,
          boost,
          now,
          existing.tenantId,
          existing.id
        );
      } else {
        this.db.prepare(`
          UPDATE memories
          SET access_count = access_count + 1,
              last_accessed_at = ?,
              last_reinforced_at = ?,
              reinforcement_score = min(1, reinforcement_score + ?),
              strength = min(1, strength + ?),
              updated_at = ?
          WHERE tenant_id = ? AND id = ?
        `).run(now, now, boost, boost, now, existing.tenantId, existing.id);
      }

      // Audit log row — same shape as recordAccess() emits, so the
      // /api/v1/memories/:id/access-logs endpoint surfaces dedup
      // reinforcements uniformly with retrieval accesses.
      this.db.prepare(`
        INSERT INTO access_logs (
          id, tenant_id, memory_id, session_id, device_id,
          source, query, rank, score, used_in_context, accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        existing.tenantId,
        existing.id,
        incoming.sourceSessionId,
        incoming.sourceDeviceId,
        'dedup_reinforce',
        null,
        null,
        null,
        1,  // usedInContext = true (the LLM was about to use it)
        now
      );
    });
    tx();

    const updated = this.getById(existing.tenantId, existing.id);
    if (!updated) throw new Error(`Failed to reinforce memory ${existing.id}`);
    return updated;
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

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 if both sets are empty
 * (we treat "no concepts" as "not similar to anything").
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize a memory's content for exact-match dedup comparison.
 * Collapses all whitespace to a single space, trims, and lower-cases.
 * This catches the common case where a re-save differs only in
 * trailing newline or extra spaces — and keeps the comparison
 * deterministic for the verbatim dedup path.
 */
function normalizeContent(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
