import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { bm25Search } from '../../src/retrieval/bm25-search.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-bm25-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('bm25Search', () => {
  it('returns memories matching the query', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite is the default store',
      content: 'MemWeave stores v1 data in SQLite.', summary: 'SQLite is the default store.',
      concepts: ['sqlite'], files: [], importance: 6, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const results = await bm25Search(db, 'tenant_default', 'SQLite', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.title).toContain('SQLite');
  });

  it('returns empty array for no match', async () => {
    const results = await bm25Search(db, 'tenant_default', 'nonexistent_query_xyz', 5);
    expect(results).toEqual([]);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      repo.create({
        tenantId: 'tenant_default', type: 'fact', title: `Test ${i}`,
        content: 'shared keyword alpha', summary: 'Test.',
        concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
        scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
      });
    }
    const results = await bm25Search(db, 'tenant_default', 'shared', 3);
    expect(results.length).toBe(3);
  });
});
