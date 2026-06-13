import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { searchMemories } from '../../packages/server/src/retrieval/search-engine.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-search-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('searchMemories', () => {
  it('returns top-K fused results from BM25 layer', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'decision', title: 'Use SQLite',
      content: 'MemWeave uses SQLite for v1 storage.', summary: 'Use SQLite.',
      concepts: ['sqlite'], files: [], importance: 8, confidence: 0.9, source: 'user_explicit',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await searchMemories(db, 'tenant_default', { query: 'SQLite', limit: 5 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].candidate.memory.title).toContain('SQLite');
  });

  it('respects scope filter', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Memory project fact',
      content: 'about memory project', summary: 'memory fact',
      concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Harmony project fact',
      content: 'about harmony project', summary: 'harmony fact',
      concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'harmony' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await searchMemories(db, 'tenant_default', { query: 'fact', limit: 5, scope: { project: 'memory' } });
    expect(result.results.every(r => r.candidate.memory.scopes.some(s => s.key === 'project' && s.value === 'memory'))).toBe(true);
  });

  it('returns empty result for empty query', async () => {
    const result = await searchMemories(db, 'tenant_default', { query: '', limit: 5 });
    expect(result.results).toEqual([]);
  });
});
