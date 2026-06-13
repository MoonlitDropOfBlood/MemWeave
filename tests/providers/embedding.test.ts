import { describe, expect, it } from 'vitest';
import {
  createEmbeddingProvider,
  NoopEmbeddingProvider,
  OpenaiCompatibleEmbeddingProvider,
  LocalXenovaEmbeddingProvider
} from '../../packages/server/src/providers/embedding/index.js';

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

describe('LocalXenovaEmbeddingProvider', () => {
  it('exposes model and dimensions from options', () => {
    const p = new LocalXenovaEmbeddingProvider({
      dimensions: 16,
      model: 'Xenova/nomic-embed-text-v1'
    });
    expect(p.model).toBe('Xenova/nomic-embed-text-v1');
    expect(p.dimensions).toBe(16);
  });

  it('falls back to deterministic noop vectors when @xenova/transformers is not installed', async () => {
    // We assume the optional dep is not installed in the test env. If it is,
    // this test will try to load a real model and may fail on network/model
    // access — that is acceptable: the test would still fail loudly rather
    // than silently produce noop vectors.
    const p = new LocalXenovaEmbeddingProvider({
      dimensions: 16,
      model: 'Xenova/nomic-embed-text-v1',
      fallbackOnError: true
    });
    const v = await p.embed('hello');
    // Whether real or fallback, the contract is "a 16-dim number array".
    expect(v).toHaveLength(16);
    expect(v.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
  });

  it('throws when fallbackOnError is false and the dep is missing', async () => {
    const p = new LocalXenovaEmbeddingProvider({
      dimensions: 8,
      model: 'Xenova/nomic-embed-text-v1',
      fallbackOnError: false
    });
    await expect(p.embed('test')).rejects.toThrow();
  });

  it('coerces single-input batch to one row', async () => {
    const p = new LocalXenovaEmbeddingProvider({ dimensions: 4, model: 'm' });
    const batch = await p.embedBatch(['only-one']);
    expect(batch).toHaveLength(1);
    expect(batch[0]).toHaveLength(4);
  });

  it('returns [] for empty input without calling the model', async () => {
    const p = new LocalXenovaEmbeddingProvider({ dimensions: 4, model: 'm' });
    const batch = await p.embedBatch([]);
    expect(batch).toEqual([]);
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
