import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemweaveClient } from '../../src/mcp/client.js';

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
});
