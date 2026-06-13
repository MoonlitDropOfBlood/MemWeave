import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../packages/server/src/server/http.js';

let app: FastifyInstance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-mem-rest-'));
  app = await createHttpServer({ dbPath: join(dir, 'test.db') });
});

afterEach(async () => app.close());

async function createMemory(payload: Record<string, unknown>): Promise<{ memoryId: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/memories', payload });
  return res.json() as { memoryId: string };
}

describe('GET /api/v1/memories (list)', () => {
  it('returns empty list when no memories exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/memories' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { memories: unknown[]; total: number };
    expect(body.memories).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns memories ordered by createdAt DESC', async () => {
    await createMemory({
      type: 'fact', title: 'First', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    await createMemory({
      type: 'fact', title: 'Second', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/memories' });
    const body = res.json() as { memories: Array<{ title: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.memories[0].title).toBe('Second');
    expect(body.memories[1].title).toBe('First');
  });

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await createMemory({
        type: 'fact', title: `m${i}`, content: 'c', summary: 's', concepts: [], files: [],
        importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
      });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/memories?limit=2&offset=0' });
    const body = res.json() as { memories: unknown[]; total: number };
    expect(body.memories.length).toBe(2);
    expect(body.total).toBe(5);
  });
});

describe('POST /api/v1/memories/search', () => {
  it('returns matching memories for a query', async () => {
    await createMemory({
      type: 'decision', title: 'Use SQLite for storage', content: 'MemWeave stores v1 data in SQLite.',
      summary: 'SQLite is the v1 store.', concepts: ['sqlite'], files: [],
      importance: 8, confidence: 0.9, source: 'user_explicit', scopeLevel: 'project', scopes: []
    });
    const res = await app.inject({
      method: 'POST', url: '/api/v1/memories/search',
      payload: { query: 'SQLite', limit: 5 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ title: string }>; totalCandidates: number };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].title).toContain('SQLite');
  });

  it('returns empty results for empty query', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/memories/search',
      payload: { query: '', limit: 5 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('returns 200 with empty results for missing query', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/memories/search',
      payload: { limit: 5 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});

describe('PATCH /api/v1/memories/:id', () => {
  it('updates title and content of a memory', async () => {
    const { memoryId } = await createMemory({
      type: 'fact', title: 'Old title', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/memories/${memoryId}`,
      payload: { title: 'New title', content: 'new content' }
    });
    expect(res.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: `/api/v1/memories/${memoryId}` });
    const body = read.json() as { title: string; content: string };
    expect(body.title).toBe('New title');
    expect(body.content).toBe('new content');
  });

  it('returns 404 for nonexistent memory', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/v1/memories/nonexistent',
      payload: { title: 'x' }
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/memories/:id (soft delete)', () => {
  it('soft-deletes a memory and hides it from getById', async () => {
    const { memoryId } = await createMemory({
      type: 'fact', title: 'T', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/memories/${memoryId}` });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/v1/memories/${memoryId}` });
    expect(get.statusCode).toBe(404);
  });

  it('returns 404 when deleting nonexistent memory', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/memories/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/memories/:id/graph', () => {
  it('returns the source memory as a node with no edges when no graph exists', async () => {
    const { memoryId } = await createMemory({
      type: 'fact', title: 'T', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/memories/${memoryId}/graph` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nodes: Array<{ id: string }>; edges: unknown[] };
    expect(body.nodes.length).toBe(1);
    expect(body.nodes[0].id).toBe(memoryId);
    expect(body.edges).toEqual([]);
  });

  it('returns 404 for nonexistent memory', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/memories/nonexistent/graph' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/memories/:id/access-logs', () => {
  it('returns empty list for memory with no access logs', async () => {
    const { memoryId } = await createMemory({
      type: 'fact', title: 'T', content: 'c', summary: 's', concepts: [], files: [],
      importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/memories/${memoryId}/access-logs` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { logs: unknown[]; total: number };
    expect(body.logs).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('POST /api/v1/memories — write-side dedup (E2E via HTTP)', () => {
  it('returns 201 with same id when second save is a near-duplicate (jaccard=1)', async () => {
    const first = await createMemory({
      type: 'preference',
      title: 'User prefers strict TypeScript',
      content: 'Always use noImplicitAny and exactOptionalPropertyTypes.',
      summary: 'Strict TS mode.',
      concepts: ['typescript', 'strict', 'noImplicitAny'],
      files: ['tsconfig.json'],
      importance: 7, confidence: 0.9,
      source: 'user_explicit',
      scopeLevel: 'global',
      scopes: []
    });

    const second = await createMemory({
      type: 'preference',
      title: 'TS strict mode on',
      content: 'Use strict TypeScript with noImplicitAny.',
      summary: 'Strict TS.',
      concepts: ['typescript', 'strict', 'noImplicitAny'],
      files: [],
      importance: 7, confidence: 0.9,
      source: 'user_explicit',
      scopeLevel: 'global',
      scopes: []
    });

    expect(second.memoryId).toBe(first.memoryId);

    // Verify there's still only one memory in the DB
    const list = await app.inject({ method: 'GET', url: '/api/v1/memories' });
    const body = list.json() as { total: number };
    expect(body.total).toBe(1);
  });

  it('rejects content longer than MEMORY_LIMITS.CONTENT_MAX with 400', async () => {
    const tooLong = 'x'.repeat(100_001);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'fact',
        title: 'T',
        content: tooLong,
        summary: 's',
        concepts: [],
        files: [],
        importance: 5, confidence: 0.5,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: []
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects concepts array longer than MEMORY_LIMITS.CONCEPTS_MAX with 400', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'fact',
        title: 'T',
        content: 'c',
        summary: 's',
        concepts: tooMany,
        files: [],
        importance: 5, confidence: 0.5,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: []
      }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/memories — rate limiting', () => {
  it('returns 429 after exceeding the per-API-key burst (30 writes)', async () => {
    // Use a unique API key so the rate limit bucket is fresh for this test
    // (other tests share the default 'anonymous' bucket via no header).
    const apiKey = `test-rate-${Date.now()}-${Math.random()}`;

    // Fire 30 distinct memories (different concepts to avoid dedup).
    // All should succeed (the bucket starts at capacity=30).
    const successes: string[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/memories',
        headers: { 'x-api-key': apiKey },
        payload: {
          type: 'fact',
          title: `T${i}`,
          content: `c${i}`,
          summary: `s${i}`,
          concepts: [`unique-concept-${i}-${Math.random()}`],
          files: [],
          importance: 5, confidence: 0.5,
          source: 'user_explicit',
          scopeLevel: 'project',
          scopes: []
        }
      });
      if (res.statusCode === 201) successes.push((res.json() as { memoryId: string }).memoryId);
    }
    expect(successes.length).toBe(30);

    // The 31st request should be rate-limited
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { 'x-api-key': apiKey },
      payload: {
        type: 'fact',
        title: 'overflow',
        content: 'c',
        summary: 's',
        concepts: ['overflow'],
        files: [],
        importance: 5, confidence: 0.5,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: []
      }
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
