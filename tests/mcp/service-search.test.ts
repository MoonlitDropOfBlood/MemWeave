import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import type { EmbeddingProvider } from '../../packages/server/src/providers/embedding/index.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { VectorRepo } from '../../packages/server/src/db/repositories/vector-repo.js';
import { McpService } from '../../packages/server/src/mcp/service.js';

let db: Db;
let dir: string;
let dbPath: string;
let repo: MemoryRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-mcp-search-'));
  dbPath = join(dir, 'test.db');
  db = openDatabase(dbPath);
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A fake embedding provider that returns a vector "close" to a target text's vector. */
function fakeEmbedding(): EmbeddingProvider {
  // Deterministic: map each char to a dimension. Two similar texts → similar vectors.
  const embed = async (text: string): Promise<number[]> => {
    const dim = 16;
    const vec = new Array(dim).fill(0);
    for (const ch of text.toLowerCase()) {
      const idx = (ch.charCodeAt(0) % dim);
      vec[idx] += 1;
    }
    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  };
  return {
    embed,
    async embedBatch(texts: string[]) { return Promise.all(texts.map((t) => embed(t))); },
    get dimensions() { return 16; },
    get model() { return 'fake'; }
  };
}

describe('McpService.searchMemories — query embedding wiring (batch D)', () => {
  it('generates a query embedding and runs the vector layer when an embedding provider is wired', async () => {
    const embedding = fakeEmbedding();
    const service = new McpService({ db, embeddingProvider: embedding });
    const vecRepo = new VectorRepo(db, 16);

    // Two memories with distinct content; embed both close to their text.
    const m1 = repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'TypeScript strict mode',
      content: 'Enable noImplicitAny and exactOptionalPropertyTypes for type safety.',
      summary: 'TS strict mode.', concepts: ['typescript', 'strict'], files: [],
      importance: 7, confidence: 0.9, source: 'user_explicit', scopeLevel: 'project',
      scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Postgres production DB',
      content: 'Production runs on Postgres 16 with connection pooling.',
      summary: 'Postgres prod.', concepts: ['postgres', 'database'], files: [],
      importance: 5, confidence: 0.8, source: 'user_explicit', scopeLevel: 'project',
      scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    vecRepo.upsert(m1.id, 'tenant_default', await embedding.embed('typescript strict mode typesafety'));
    vecRepo.upsert(m2.id, 'tenant_default', await embedding.embed('postgres database connection pooling'));

    // Query for typescript — expects the vector layer to contribute.
    const result = await service.searchMemories({
      query: 'typescript strict mode',
      limit: 5,
      vectorDimensions: 16,
      bm25Only: false,
      vectorMinSimilarity: 0 // don't filter out
    }) as { layerStats: { vector: number; bm25: number }; results: Array<{ candidate: { memory: { id: string } } }> };

    expect(result.layerStats.vector).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('does NOT generate an embedding when bm25Only is true', async () => {
    const embedding = fakeEmbedding();
    const service = new McpService({ db, embeddingProvider: embedding });
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Test memory',
      content: 'some content here', summary: 's', concepts: ['x'], files: [],
      importance: 5, confidence: 0.8, source: 'user_explicit', scopeLevel: 'project',
      scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await service.searchMemories({
      query: 'test', limit: 5, bm25Only: true, vectorDimensions: 16
    }) as { layerStats: { vector: number } };
    expect(result.layerStats.vector).toBe(0); // vector layer skipped
  });

  it('falls back to BM25-only when no embedding provider is wired', async () => {
    const service = new McpService({ db }); // no embeddingProvider
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite store',
      content: 'Data stored in SQLite.', summary: 'SQLite.', concepts: ['sqlite'], files: [],
      importance: 5, confidence: 0.8, source: 'user_explicit', scopeLevel: 'project',
      scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await service.searchMemories({
      query: 'SQLite', limit: 5, vectorDimensions: 16
    }) as { layerStats: { bm25: number; vector: number }; results: unknown[] };
    expect(result.layerStats.bm25).toBeGreaterThan(0);
    expect(result.layerStats.vector).toBe(0);
    expect(result.results.length).toBeGreaterThan(0);
  });
});