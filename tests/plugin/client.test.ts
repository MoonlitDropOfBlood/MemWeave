import { describe, expect, it } from 'vitest';
import { MemweaveInjectClient } from '../../src/plugin/client.js';

const BASE = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';

describe('MemweaveInjectClient', () => {
  const client = new MemweaveInjectClient({ baseUrl: BASE });

  it('returns 200 for session_start injection', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'session_start'
    });
    expect(bundle.phase).toBe('session_start');
    expect(bundle.memoryIds).toBeTypeOf('object');
    expect(bundle.contentHash).toBeTypeOf('string');
  });

  it('returns 200 for prompt_delta injection with query', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'prompt_delta',
      query: 'SQLite design'
    });
    expect(bundle.phase).toBe('prompt_delta');
  });

  it('returns 200 for file_pack injection with files', async () => {
    const bundle = await client.requestInjection({
      sessionId: 'test-session',
      phase: 'file_pack',
      files: ['src/retrieval/search-engine.ts']
    });
    expect(bundle.phase).toBe('file_pack');
  });
});
