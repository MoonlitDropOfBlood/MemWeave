import { describe, expect, it } from 'vitest';
import { NoopLlmProvider } from '../../packages/server/src/providers/llm/noop.js';

describe('NoopLlmProvider', () => {
  const provider = new NoopLlmProvider();

  it('returns empty string', async () => {
    const result = await provider.call('system', 'user');
    expect(result).toBe('');
  });
});
