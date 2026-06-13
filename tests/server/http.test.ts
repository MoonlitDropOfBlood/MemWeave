import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../src/server/http.js';

let app: FastifyInstance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-http-'));
  app = await createHttpServer({ dbPath: join(dir, 'test.db') });
});

afterEach(async () => app.close());

describe('HTTP server', () => {
  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'memweave-server' });
  });

  it('creates and reads memory', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'decision',
        title: 'Use MemWeave name',
        content: 'The project is named MemWeave to avoid legal confusion.',
        summary: 'Project name is MemWeave.',
        concepts: ['memweave', 'naming'],
        files: [],
        importance: 8,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [{ key: 'project', value: 'memory' }],
        sourceClient: 'rest_api'
      }
    });

    expect(create.statusCode).toBe(201);
    const body = create.json() as { memoryId: string };
    expect(body.memoryId).toBeTypeOf('string');

    const read = await app.inject({ method: 'GET', url: `/api/v1/memories/${body.memoryId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ title: 'Use MemWeave name', type: 'decision' });
  });

  it('returns 400 on invalid POST payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: { type: 'invalid_type' }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string; details: unknown } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(body.error.details).toBeDefined();
  });

  it('returns 404 for nonexistent memory', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/memories/nonexistent' });
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('MEMORY_NOT_FOUND');
    expect(body.error.message).toContain('nonexistent');
  });
});
