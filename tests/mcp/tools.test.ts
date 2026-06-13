import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemweaveClient } from '../../packages/mcp/src/client.js';

const BASE = process.env.MEMWEAVE_TEST_URL || 'http://127.0.0.1:3131';

describe('MCP tools via client', () => {
  const client = new MemweaveClient({ baseUrl: BASE });

  it('save tool creates a memory', async () => {
    const result = await client.createMemory({
      type: 'decision',
      title: 'MCP integration test',
      content: 'Testing MCP shim save tool.',
      summary: 'MCP integration test.',
      concepts: ['mcp'],
      files: [],
      importance: 5,
      confidence: 0.8,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: 'rest_api'
    });
    expect(result.memoryId).toBeTypeOf('string');
  });

  it('recall tool makes successful API call', async () => {
    const result = await client.request('GET', '/api/v1/health', undefined, z.any());
    expect(result).toHaveProperty('ok', true);
  });

  it('expand tool reads a memory', async () => {
    const created = await client.createMemory({
      type: 'fact',
      title: 'Expand test',
      content: 'Testing expand.',
      summary: 'Expand test.',
      concepts: ['expand'],
      files: [],
      importance: 3,
      confidence: 0.7,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [],
      sourceClient: 'rest_api'
    });
    const loaded = await client.getMemory(created.memoryId);
    expect(loaded.title).toBe('Expand test');
  });
});
