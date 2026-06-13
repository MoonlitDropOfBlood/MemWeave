import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemweaveClient,
  SearchResponseSchema,
  GraphResponseSchema,
  SessionsListResponseSchema,
  ConsolidationTriggerResponseSchema,
  ForgetResponseSchema
} from '../../packages/mcp/src/client.js';

const BASE = process.env.MEMWEAVE_TEST_URL || 'http://127.0.0.1:3131';

describe('MemweaveClient', () => {
  const client = new MemweaveClient({ baseUrl: BASE });
  const createdIds: string[] = [];

  afterEach(() => {
    createdIds.length = 0;
    vi.unstubAllGlobals?.();
  });

  it('health returns ok', async () => {
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('memweave-server');
  });

  it('creates and reads a memory', async () => {
    const uniqueTitle = `MCP test ${Date.now()}`;

    const created = await client.createMemory({
      type: 'fact',
      title: uniqueTitle,
      content: 'Created via MCP client test.',
      summary: 'MCP test summary.',
      concepts: ['mcp', 'test'],
      files: [],
      importance: 5,
      confidence: 0.8,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: 'rest_api'
    });
    expect(created.memoryId).toBeTypeOf('string');
    createdIds.push(created.memoryId);

    const loaded = await client.getMemory(created.memoryId);
    expect(loaded.title).toBe(uniqueTitle);
  });

  it('rejects with timeout error on stalled fetch', async () => {
    const fastClient = new MemweaveClient({ baseUrl: BASE, timeout: 1 });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      })
    );

    await expect(fastClient.health()).rejects.toThrow();
  });

  describe('B1: typed response schemas catch malformed server responses', () => {
    /**
     * Helper: stub fetch to return a synthetic JSON response.
     */
    function stubJsonResponse(body: unknown, status = 200): void {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );
    }

    it('SearchResponseSchema: accepts a well-formed search response', () => {
      const ok = {
        results: [{
          memoryId: 'm1', type: 'fact', tier: 'long', title: 't', summary: 's',
          finalScore: 0.9, sources: ['bm25']
        }],
        totalCandidates: 1
      };
      expect(() => SearchResponseSchema.parse(ok)).not.toThrow();
    });

    it('SearchResponseSchema: rejects a response with missing required fields', () => {
      const bad = { results: [{ memoryId: 'm1' }], totalCandidates: 1 };
      expect(() => SearchResponseSchema.parse(bad)).toThrow();
    });

    it('SearchResponseSchema: rejects a response with wrong types', () => {
      const bad = { results: 'not-an-array', totalCandidates: 'string-not-number' };
      expect(() => SearchResponseSchema.parse(bad)).toThrow();
    });

    it('GraphResponseSchema: accepts a well-formed graph response', () => {
      const ok = {
        nodes: [{ id: 'm1', type: 'fact', tier: 'long', title: 't', summary: 's' }],
        edges: [{
          id: 'e1', fromMemoryId: 'm1', toMemoryId: 'm2', type: 'related_to',
          strength: 0.5, reason: 'r'
        }]
      };
      expect(() => GraphResponseSchema.parse(ok)).not.toThrow();
    });

    it('GraphResponseSchema: rejects a malformed graph response', () => {
      const bad = { nodes: 'not-an-array', edges: null };
      expect(() => GraphResponseSchema.parse(bad)).toThrow();
    });

    it('SessionsListResponseSchema: accepts a well-formed session list', () => {
      const ok = {
        sessions: [{
          id: 's1', tenantId: 't', deviceId: null, source: 'opencode',
          title: 't', summary: null, startedAt: 1, endedAt: null, observationCount: 0
        }],
        total: 1
      };
      expect(() => SessionsListResponseSchema.parse(ok)).not.toThrow();
    });

    it('ConsolidationTriggerResponseSchema: accepts a well-formed trigger response', () => {
      const ok = {
        run: {
          id: 'r1', tenantId: 't', startedAt: 1, endedAt: 2,
          promoted: [], evicted: [], merged: [], edgesCreated: 0,
          contradictionFound: 0, dryRun: false, summary: 's'
        }
      };
      expect(() => ConsolidationTriggerResponseSchema.parse(ok)).not.toThrow();
    });

    it('ConsolidationTriggerResponseSchema: rejects if run is missing required fields', () => {
      const bad = { run: { id: 'r1' } };
      expect(() => ConsolidationTriggerResponseSchema.parse(bad)).toThrow();
    });

    it('ForgetResponseSchema: accepts a well-formed forget response', () => {
      const ok = { ok: true, memoryId: 'm1', deletedAt: 12345 };
      expect(() => ForgetResponseSchema.parse(ok)).not.toThrow();
    });

    it('ForgetResponseSchema: rejects if deletedAt is missing', () => {
      const bad = { ok: true, memoryId: 'm1' };
      expect(() => ForgetResponseSchema.parse(bad)).toThrow();
    });

    it('end-to-end: a malformed server response on POST /memories/search throws (not silently corrupted)', async () => {
      // Simulate the server returning a non-conformant body (e.g. a 200 with
      // the wrong shape due to a server-side bug or proxy interference).
      stubJsonResponse({ results: 'should-be-an-array' });

      const c = new MemweaveClient({ baseUrl: BASE });
      await expect(
        c.request('POST', '/api/v1/memories/search', { query: 'q' }, SearchResponseSchema)
      ).rejects.toThrow();
    });
  });
});
