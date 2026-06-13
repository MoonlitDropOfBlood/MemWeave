import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../src/server/http.js';

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
