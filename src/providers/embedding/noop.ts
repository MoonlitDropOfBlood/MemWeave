import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './index.js';

export interface NoopEmbeddingProviderOptions {
  dimensions: number;
  model: string;
}

/**
 * Deterministic no-op embedding provider. Produces vectors derived from a SHA-256
 * hash of the input text. The output is NOT semantically meaningful — it only
 * exists to make the rest of the pipeline testable when no real embedding
 * service is available. Use the same algorithm for "missing" embeddings so
 * the search engine has something deterministic to compare against.
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;

  constructor(options: NoopEmbeddingProviderOptions) {
    this.dimensions = options.dimensions;
    this.model = options.model;
  }

  async embed(text: string): Promise<number[]> {
    return deriveDeterministicVector(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => deriveDeterministicVector(t, this.dimensions));
  }
}

/**
 * Deterministically derive a fixed-length vector from a string.
 * Repeats and hashes the text in chunks, then normalizes to [-1, 1].
 * The same input always produces the same vector.
 */
function deriveDeterministicVector(text: string, dimensions: number): number[] {
  const out: number[] = new Array(dimensions);
  let counter = 0;
  let i = 0;
  while (i < dimensions) {
    const hash = createHash('sha256').update(`${text}::${counter++}`).digest();
    for (let b = 0; b < hash.length && i < dimensions; b++, i++) {
      // Map byte to [-1, 1] deterministically.
      out[i] = (hash[b] / 255) * 2 - 1;
    }
  }
  return out;
}
