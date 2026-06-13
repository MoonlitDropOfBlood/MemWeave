import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { VectorRepo } from '../../packages/server/src/db/repositories/vector-repo.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { vectorSearch, similarityFromL2 } from '../../packages/server/src/retrieval/vector-search.js';

let db: ReturnType<typeof openDatabase>;
const DIM = 4;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-vec-'));
  db = openDatabase(join(dir, 'test.db'), { vectorDimensions: DIM });
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
});

afterEach(() => db.close());

describe('VectorRepo', () => {
  it('upserts and counts embeddings', () => {
    const repo = new VectorRepo(db, DIM);
    expect(repo.count()).toBe(0);
    repo.upsert('m1', 'tenant_default', [0.1, 0.2, 0.3, 0.4]);
    repo.upsert('m2', 'tenant_default', [0.5, 0.6, 0.7, 0.8]);
    expect(repo.count()).toBe(2);
  });

  it('replaces existing embedding on upsert', () => {
    const repo = new VectorRepo(db, DIM);
    repo.upsert('m1', 'tenant_default', [0.1, 0.2, 0.3, 0.4]);
    repo.upsert('m1', 'tenant_default', [0.9, 0.9, 0.9, 0.9]);
    expect(repo.count()).toBe(1);
  });

  it('deletes an embedding by memory_id', () => {
    const repo = new VectorRepo(db, DIM);
    repo.upsert('m1', 'tenant_default', [0.1, 0.2, 0.3, 0.4]);
    expect(repo.count()).toBe(1);
    repo.delete('m1');
    expect(repo.count()).toBe(0);
  });

  it('rejects dimension mismatches', () => {
    const repo = new VectorRepo(db, DIM);
    expect(() => repo.upsert('m1', 'tenant_default', [0.1, 0.2])).toThrow(/dimensions mismatch/);
  });
});

describe('vectorSearch', () => {
  let memRepo: MemoryRepo;
  let vecRepo: VectorRepo;

  beforeEach(() => {
    memRepo = new MemoryRepo(db);
    vecRepo = new VectorRepo(db, DIM);
  });

  it('returns memories ordered by distance to the query vector', () => {
    const m1 = memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m3 = memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'C', content: 'C', summary: 'C',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    // m1 is closest to query, m3 is farthest
    vecRepo.upsert(m1.id, 'tenant_default', [0.0, 0.0, 0.0, 0.0]);
    vecRepo.upsert(m2.id, 'tenant_default', [0.5, 0.5, 0.5, 0.5]);
    vecRepo.upsert(m3.id, 'tenant_default', [1.0, 1.0, 1.0, 1.0]);

    const results = vectorSearch(db, 'tenant_default', [0.1, 0.1, 0.1, 0.1], 3, DIM);
    expect(results.length).toBe(3);
    expect(results[0].memory.id).toBe(m1.id);
    expect(results[0].distance).toBeLessThan(results[1].distance);
    expect(results[1].distance).toBeLessThan(results[2].distance);
    expect(results[0].similarity).toBeGreaterThan(results[2].similarity);
  });

  it('respects limit', () => {
    const memRepo2 = memRepo;
    vecRepo.upsert('m1', 'tenant_default', [0.0, 0.0, 0.0, 0.0]);
    vecRepo.upsert('m2', 'tenant_default', [0.1, 0.1, 0.1, 0.1]);
    vecRepo.upsert('m3', 'tenant_default', [0.2, 0.2, 0.2, 0.2]);
    // Create memory rows for them
    for (let i = 1; i <= 3; i++) {
      memRepo2.create({
        tenantId: 'tenant_default', type: 'fact', title: `m${i}`, content: 'c', summary: 's',
        concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
        scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
      });
    }
    const results = vectorSearch(db, 'tenant_default', [0.05, 0.05, 0.05, 0.05], 2, DIM);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array for empty query', () => {
    const results = vectorSearch(db, 'tenant_default', [], 5, DIM);
    expect(results).toEqual([]);
  });

  it('returns empty array for dimension mismatch', () => {
    const results = vectorSearch(db, 'tenant_default', [0.1, 0.2, 0.3], 5, DIM);
    expect(results).toEqual([]);
  });
});

describe('similarityFromL2', () => {
  it('returns 1 for distance 0', () => {
    expect(similarityFromL2(0)).toBe(1);
  });
  it('returns < 1 for positive distance', () => {
    expect(similarityFromL2(1)).toBeLessThan(1);
    expect(similarityFromL2(1)).toBeGreaterThan(0);
  });
});
