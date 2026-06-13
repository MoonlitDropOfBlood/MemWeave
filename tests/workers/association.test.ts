import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '../../src/providers/llm/index.js';
import { extractEdges } from '../../src/workers/association.js';
import { NoopLlmProvider } from '../../src/providers/llm/noop.js';

function mockProvider(json: string): LlmProvider {
  return {
    async call(_systemPrompt: string, _userPrompt: string): Promise<string> {
      return json;
    }
  };
}

const existingMemories = [
  { id: 'mem_1', title: 'SQLite storage', summary: 'Uses SQLite for local', concepts: ['sqlite', 'storage'] },
  { id: 'mem_2', title: 'MCP protocol', summary: 'MCP over REST', concepts: ['mcp', 'rest'] },
  { id: 'mem_3', title: 'Error handling', summary: 'Global error handler', concepts: ['error', 'handler'] }
];

const newMemory = {
  title: 'REST API decisions',
  content: 'We decided to use REST for all APIs instead of WebSocket',
  concepts: ['rest', 'api', 'decision']
};

describe('extractEdges', () => {
  it('returns empty array for noop provider', async () => {
    const provider = new NoopLlmProvider();
    const result = await extractEdges(provider, { title: 'test', content: 'test', concepts: [] }, []);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty response', async () => {
    const provider = mockProvider('');
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toEqual([]);
  });

  it('returns valid edges from provider response', async () => {
    const provider = mockProvider(JSON.stringify([
      { targetMemoryId: 'mem_1', type: 'related_to', reason: 'Both about storage', confidence: 0.85 },
      { targetMemoryId: 'mem_2', type: 'references', reason: 'Both about protocols', confidence: 0.9 }
    ]));
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ targetMemoryId: 'mem_1', type: 'related_to', reason: 'Both about storage', confidence: 0.85 });
    expect(result[1]).toEqual({ targetMemoryId: 'mem_2', type: 'references', reason: 'Both about protocols', confidence: 0.9 });
  });

  it('returns empty array for malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = mockProvider('not { valid json at all');
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('[association] Failed to parse JSON response');
    warnSpy.mockRestore();
  });

  it('filters edges below confidence threshold', async () => {
    const provider = mockProvider(JSON.stringify([
      { targetMemoryId: 'mem_1', type: 'related_to', reason: 'low confidence', confidence: 0.5 },
      { targetMemoryId: 'mem_2', type: 'references', reason: 'high confidence', confidence: 0.85 }
    ]));
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toHaveLength(1);
    expect(result[0].targetMemoryId).toBe('mem_2');
    expect(result[0].confidence).toBe(0.85);
  });

  it('filters edges with unknown targetMemoryId', async () => {
    const provider = mockProvider(JSON.stringify([
      { targetMemoryId: 'mem_1', type: 'related_to', reason: 'valid id', confidence: 0.8 },
      { targetMemoryId: 'mem_nonexistent', type: 'related_to', reason: 'not in the set', confidence: 0.9 }
    ]));
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toHaveLength(1);
    expect(result[0].targetMemoryId).toBe('mem_1');
  });

  it('filters edges missing required fields', async () => {
    const provider = mockProvider(JSON.stringify([
      { targetMemoryId: 'mem_1', type: 'related_to', reason: 'valid', confidence: 0.8 },
      { targetMemoryId: 'mem_2' }, // missing type, reason, confidence
      { type: 'related_to', reason: 'missing id', confidence: 0.9 },
      { targetMemoryId: 'mem_3', reason: 'missing type', confidence: 0.7 },
      { targetMemoryId: 'mem_3', type: 'related_to', reason: 'bad confidence', confidence: 'high' }
    ]));
    const result = await extractEdges(provider, newMemory, existingMemories);
    expect(result).toHaveLength(1);
    expect(result[0].targetMemoryId).toBe('mem_1');
  });

  it('returns empty when provider throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failingProvider: LlmProvider = {
      async call(): Promise<string> {
        throw new Error('network error');
      }
    };
    const result = await extractEdges(failingProvider, newMemory, existingMemories);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('[association] Provider call failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
