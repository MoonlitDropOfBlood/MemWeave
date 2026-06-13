import { describe, expect, it } from 'vitest';
import {
  createEmbeddingProvider,
  NoopEmbeddingProvider,
  OpenaiCompatibleEmbeddingProvider,
  LocalXenovaEmbeddingProvider
} from '../../src/providers/embedding/index.js';

describe('NoopEmbeddingProvider', () => {
  it('returns a vector of requested dimensions', async () => {
    const p = new NoopEmbeddingProvider({ dimensions: 16, model: 'noop' });
    const v = await p.embed('hello');
    expect(v).toHaveLength(16);
    expect(v.every((n) => typeof n === 'number')).toBe(true);
  });

  it('is deterministic for the same input', async () => {
    const p = new NoopEmbeddingProvider({ dimensions: 32, model: 'noop' });
    const a = await p.embed('hello world');
    const b = await p.embed('hello world');
    expect(a).toEqual(b);
  });

  it('differs for different inputs', async () => {
    const p = new NoopEmbeddingProvider({ dimensions: 32, model: 'noop' });
    const a = await p.embed('hello');
    const b = await p.embed('world');
    expect(a).not.toEqual(b);
  });

  it('embeds a batch in one call', async () => {
    const p = new NoopEmbeddingProvider({ dimensions: 8, model: 'noop' });
    const batch = await p.embedBatch(['a', 'b', 'c']);
    expect(batch).toHaveLength(3);
    expect(batch[0]).toHaveLength(8);
  });
});

describe('LocalXenovaEmbeddingProvider (stub)', () => {
  it('delegates to noop behavior in v1', async () => {
    const p = new LocalXenovaEmbeddingProvider({ dimensions: 16, model: 'Xenova/nomic-embed-text-v1' });
    const v = await p.embed('test');
    expect(v).toHaveLength(16);
  });
});

describe('createEmbeddingProvider factory', () => {
  it('creates a noop provider by default', () => {
    const p = createEmbeddingProvider({ kind: 'noop' });
    expect(p).toBeInstanceOf(NoopEmbeddingProvider);
  });

  it('creates an openai-compatible provider when requested', () => {
    const p = createEmbeddingProvider({ kind: 'openai-compatible' });
    expect(p).toBeInstanceOf(OpenaiCompatibleEmbeddingProvider);
  });

  it('creates a local-xenova provider when requested', () => {
    const p = createEmbeddingProvider({ kind: 'local-xenova' });
    expect(p).toBeInstanceOf(LocalXenovaEmbeddingProvider);
  });
});

describe('OpenaiCompatibleEmbeddingProvider', () => {
  it('builds correctly with options', () => {
    const p = new OpenaiCompatibleEmbeddingProvider({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      timeoutMs: 5000
    });
    expect(p.model).toBe('text-embedding-3-small');
    expect(p.dimensions).toBe(1536);
  });

  it('throws on HTTP error', async () => {
    const p = new OpenaiCompatibleEmbeddingProvider({
      baseUrl: 'http://127.0.0.1:1', // unreachable
      apiKey: 'k',
      model: 'm',
      dimensions: 4,
      timeoutMs: 100
    });
    await expect(p.embed('test')).rejects.toThrow();
  });
});
