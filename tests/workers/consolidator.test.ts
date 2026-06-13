import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { runConsolidation } from '../../src/workers/consolidator.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-cons-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('runConsolidation', () => {
  it('evicts short-term memories with zero strength and old age', () => {
    const now = Date.now();
    const oldTimestamp = now - 8 * 24 * 60 * 60 * 1000;
    // Create a memory with zero strength and old age
    db.prepare(`
      INSERT INTO memories (id, tenant_id, tier, type, title, content, summary, concepts_json, concepts_text, files_json, importance, confidence, strength, source, scope_level, tau, access_count, last_decay_at, reinforcement_score, created_at, updated_at)
      VALUES (?, 'tenant_default', 'short', 'event', 'Old memory', 'old', 'old', '[]', '', '[]', 1, 0.5, 0.01, 'system_inferred', 'project', 1, 0, ?, 0, ?, ?)
    `).run('mem_evict', oldTimestamp, oldTimestamp, now);

    const result = runConsolidation(db, 'tenant_default', { dryRun: true });
    expect(result.evicted).toBeGreaterThanOrEqual(1);
  });
});
