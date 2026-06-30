import { describe, expect, it } from 'vitest';
import { NoopLlmProvider } from '../../packages/server/src/providers/llm/noop.js';
import { OllamaLlmProvider } from '../../packages/server/src/providers/llm/ollama.js';

describe('NoopLlmProvider', () => {
  const provider = new NoopLlmProvider();

  it('returns empty string', async () => {
    const result = await provider.call('system', 'user');
    expect(result).toBe('');
  });
});

describe('OllamaLlmProvider', () => {
  it('builds the base URL from host/port', () => {
    const p = new OllamaLlmProvider({ host: '127.0.0.1', port: 11434, model: 'qwen2.5:3b' });
    // isConfigured just checks a model is set.
    expect(p.isConfigured).toBe(true);
  });

  it('defaults host/port/model when omitted', () => {
    const p = new OllamaLlmProvider({ model: 'qwen2.5:3b' });
    expect(p.isConfigured).toBe(true);
  });

  it('isConfigured is false when model is empty', () => {
    const p = new OllamaLlmProvider({ model: '' });
    expect(p.isConfigured).toBe(false);
  });

  it('reports a clear error when Ollama is not reachable', async () => {
    // Point at a port nothing is listening on, short timeout.
    const p = new OllamaLlmProvider({ host: '127.0.0.1', port: 1, model: 'qwen2.5:3b', timeoutMs: 500 });
    await expect(p.call('sys', 'user')).rejects.toThrow(/Ollama API error|fetch failed|LLM request failed/);
  });
});
