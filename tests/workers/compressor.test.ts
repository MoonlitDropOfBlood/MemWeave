import { describe, expect, it } from 'vitest';
import { compressObservation } from '../../src/workers/compressor.js';
import { NoopLlmProvider } from '../../src/providers/llm/noop.js';

describe('compressObservation', () => {
  it('returns null for noop provider (empty response)', async () => {
    const provider = new NoopLlmProvider();
    const result = await compressObservation(provider, {
      hookType: 'post_tool_use',
      toolName: 'Read',
      timestamp: new Date().toISOString()
    });
    expect(result).toBeNull();
  });
});
