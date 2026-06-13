import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../src/server/http.js';

let app: FastifyInstance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-inject-'));
  app = await createHttpServer({ dbPath: join(dir, 'test.db') });
});

afterEach(async () => app.close());

describe('POST /api/v1/inject', () => {
  it('returns 200 with stable pack for session_start', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'session_start' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { bundleId: string; contentHash: string; memoryIds: string[] };
    expect(body.bundleId).toBeTypeOf('string');
    expect(body.contentHash).toBeTypeOf('string');
  });

  it('returns 200 with delta pack for prompt_delta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'prompt_delta', query: 'SQLite design' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for invalid phase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'invalid_phase' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing sessionId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { phase: 'session_start' }
    });
    expect(res.statusCode).toBe(400);
  });
});
