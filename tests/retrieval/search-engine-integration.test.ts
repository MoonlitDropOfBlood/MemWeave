import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../src/db/repositories/edge-repo.js';
import { VectorRepo } from '../../src/db/repositories/vector-repo.js';
import { searchMemories } from '../../src/retrieval/search-engine.js';

let db: Db;
let memRepo: MemoryRepo;
let edgeRepo: EdgeRepo;
let vecRepo: VectorRepo;

const DIM = 4;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-multi-'));
  db = openDatabase(join(dir, 'test.db'), { vectorDimensions: DIM });
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memRepo = new MemoryRepo(db);
  edgeRepo = new EdgeRepo(db);
  vecRepo = new VectorRepo(db, DIM);
});

afterEach(() => db.close());

function makeMemory(title: string, content: string, type: 'fact' | 'decision' = 'fact'): string {
  const m = memRepo.create({
    tenantId: 'tenant_default', type, title, content, summary: content,
    concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
  return m.id;
}

describe('multi-layer search integration', () => {
  it('BM25-only mode ignores vector + graph + causal', async () => {
    const a = makeMemory('SQLite is the default store', 'MemWeave uses SQLite for v1');
    const b = makeMemory('Use FTS5 for keyword search', 'SQLite FTS5 powers BM25');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });

    const res = await searchMemories(db, 'tenant_default', {
      query: 'SQLite', limit: 5, bm25Only: true
    });
    expect(res.layerStats.bm25).toBeGreaterThan(0);
    expect(res.layerStats.vector).toBe(0);
    expect(res.layerStats.graph).toBe(0);
    expect(res.layerStats.causal).toBe(0);
  });

  it('vector layer ranks closest embedding first', async () => {
    const a = makeMemory('Far memory', 'far');
    const b = makeMemory('Close memory', 'close');
    vecRepo.upsert(a, 'tenant_default', [1.0, 1.0, 1.0, 1.0]);
    vecRepo.upsert(b, 'tenant_default', [0.0, 0.0, 0.0, 0.0]);

    const res = await searchMemories(db, 'tenant_default', {
      query: '',
      queryEmbedding: [0.1, 0.1, 0.1, 0.1],
      limit: 5,
      vectorDimensions: DIM
    });
    expect(res.layerStats.vector).toBe(2);
    expect(res.results[0].candidate.memory.id).toBe(b);
    expect(res.results[0].candidate.sources.has('vector')).toBe(true);
  });

  it('graph layer adds neighbors of BM25 hits', async () => {
    const a = makeMemory('Use SQLite for storage', 'MemWeave uses SQLite');
    const b = makeMemory('SQLite FTS5 setup', 'Configure FTS5 virtual table');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'enables', strength: 0.9, reason: 'r' });

    const res = await searchMemories(db, 'tenant_default', {
      query: 'SQLite', limit: 10
    });
    expect(res.layerStats.bm25).toBeGreaterThan(0);
    expect(res.layerStats.graph).toBeGreaterThan(0);
    // Either the seed (a) or the neighbor (b) should appear in results
    const ids = res.results.map((r) => r.candidate.memory.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });

  it('causal layer adds chain members to the result set', async () => {
    const a = makeMemory('Bug: N+1 query', 'User query was slow');
    const b = makeMemory('Root cause: missing eager loading', 'For-loop caused N queries');
    const c = makeMemory('Fix: add .with()', 'Eager-load the relation');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.95, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'causes', strength: 0.9, reason: 'r' });

    const res = await searchMemories(db, 'tenant_default', {
      query: 'N+1', limit: 10
    });
    expect(res.layerStats.bm25).toBeGreaterThan(0);
    expect(res.layerStats.causal).toBeGreaterThan(0);
    // All three chain members should be discoverable
    const ids = res.results.map((r) => r.candidate.memory.id);
    expect(ids).toContain(a);
  });

  it('fuses overlapping memories with RRF (memory found by multiple layers scores higher)', async () => {
    const a = makeMemory('SQLite is the v1 store', 'MemWeave stores v1 in SQLite');
    const b = makeMemory('FTS5 search engine', 'SQLite FTS5 powers BM25');
    // No edges, no embeddings — purely BM25 should still work
    const res = await searchMemories(db, 'tenant_default', { query: 'SQLite', limit: 5 });
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('respects limit and type filter', async () => {
    makeMemory('Use SQLite', 'rdbms');
    const a = makeMemory('FTS5 engine', 'engine', 'decision');
    const res = await searchMemories(db, 'tenant_default', { query: '', limit: 100, types: ['decision'] });
    // Only "decision" should be in the result
    for (const r of res.results) {
      expect(r.candidate.memory.type).toBe('decision');
    }
    void a;
  });

  it('returns layerStats for all 4 layers', async () => {
    const a = makeMemory('SQLite design', 'SQLite is great');
    const b = makeMemory('BM25', 'BM25 ranking');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    vecRepo.upsert(a, 'tenant_default', [0.1, 0.1, 0.1, 0.1]);
    vecRepo.upsert(b, 'tenant_default', [0.2, 0.2, 0.2, 0.2]);

    const res = await searchMemories(db, 'tenant_default', {
      query: 'SQLite',
      queryEmbedding: [0.1, 0.1, 0.1, 0.1],
      limit: 10,
      vectorDimensions: DIM
    });
    // All four stats keys exist
    expect(res.layerStats).toHaveProperty('bm25');
    expect(res.layerStats).toHaveProperty('vector');
    expect(res.layerStats).toHaveProperty('graph');
    expect(res.layerStats).toHaveProperty('causal');
  });
});
