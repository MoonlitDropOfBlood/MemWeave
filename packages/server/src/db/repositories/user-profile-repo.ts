import type { Db } from '../database.js';

export interface UserProfile {
  tenantId: string;
  userKey: string;
  traits: string[];
  summary: string;
  updatedAt: number;
}

export interface UpsertProfileInput {
  tenantId: string;
  userKey: string;
  /** New traits to ADD (merged with existing, deduped — never overwritten). */
  traits?: string[];
  /** New summary text. When provided, REPLACES the old summary. */
  summary?: string;
}

/**
 * Repository for the per-tenant user profile (batch F).
 *
 * The profile is keyed by (tenant_id, user_key). `user_key` defaults to
 * 'default' — the v1 single-user case — but is extensible to multi-user
 * tenants later without schema changes. `traits` is an additive list
 * (upsert MERGES new traits into the existing set, deduped); `summary` is
 * a replaceable natural-language paragraph.
 */
export class UserProfileRepo {
  constructor(private readonly db: Db) {}

  get(tenantId: string, userKey: string = 'default'): UserProfile | null {
    const row = this.db.prepare(`
      SELECT tenant_id, user_key, traits_json, summary, updated_at
      FROM user_profiles
      WHERE tenant_id = ? AND user_key = ?
    `).get(tenantId, userKey) as {
      tenant_id: string; user_key: string; traits_json: string;
      summary: string; updated_at: number;
    } | undefined;
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      userKey: row.user_key,
      traits: JSON.parse(row.traits_json) as string[],
      summary: row.summary,
      updatedAt: row.updated_at
    };
  }

  /**
   * Additively upsert a profile. Traits are MERGED into the existing set
   * (union, deduped, case-insensitive); summary REPLACES when provided.
   * Creates the row if absent.
   */
  upsert(input: UpsertProfileInput): UserProfile {
    const existing = this.get(input.tenantId, input.userKey);
    const existingTraits = existing?.traits ?? [];
    const newTraits = (input.traits ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
    // Merge + dedupe (case-insensitive).
    const seen = new Set(existingTraits.map((t) => t.toLowerCase()));
    const merged = [...existingTraits];
    for (const t of newTraits) {
      if (!seen.has(t.toLowerCase())) {
        merged.push(t);
        seen.add(t.toLowerCase());
      }
    }
    const summary = input.summary !== undefined ? input.summary : (existing?.summary ?? '');
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_profiles (tenant_id, user_key, traits_json, summary, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_key) DO UPDATE SET
        traits_json = excluded.traits_json,
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `).run(input.tenantId, input.userKey, JSON.stringify(merged), summary, now);
    return { tenantId: input.tenantId, userKey: input.userKey, traits: merged, summary, updatedAt: now };
  }

  /** Replace the entire trait list (for the LLM merge path that rewrites traits). */
  replace(tenantId: string, userKey: string, traits: string[], summary: string): UserProfile {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_profiles (tenant_id, user_key, traits_json, summary, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_key) DO UPDATE SET
        traits_json = excluded.traits_json,
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `).run(tenantId, userKey, JSON.stringify(traits), summary, now);
    return { tenantId, userKey, traits, summary, updatedAt: now };
  }

  list(tenantId: string): UserProfile[] {
    const rows = this.db.prepare(`
      SELECT tenant_id, user_key, traits_json, summary, updated_at
      FROM user_profiles WHERE tenant_id = ? ORDER BY updated_at DESC
    `).all(tenantId) as Array<{
      tenant_id: string; user_key: string; traits_json: string;
      summary: string; updated_at: number;
    }>;
    return rows.map((r) => ({
      tenantId: r.tenant_id, userKey: r.user_key,
      traits: JSON.parse(r.traits_json) as string[],
      summary: r.summary, updatedAt: r.updated_at
    }));
  }
}