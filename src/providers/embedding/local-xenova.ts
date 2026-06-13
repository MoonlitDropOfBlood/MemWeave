import type { EmbeddingProvider } from './index.js';
import { NoopEmbeddingProvider } from './noop.js';

export interface LocalXenovaEmbeddingOptions {
  model: string;
  dimensions: number;
}

/**
 * Local-xenova embedding provider.
 *
 * NOTE: This is a STUB in v1.0. The real implementation requires installing
 * `@xenova/transformers` and a model like `Xenova/nomic-embed-text-v1` (~30MB),
 * which we don't want as a hard dependency. To enable local embeddings:
 *
 *   1. `npm install @xenova/transformers`
 *   2. Replace the `embed` body with:
 *
 *      const { pipeline } = await import('@xenova/transformers');
 *      const extractor = await pipeline('feature-extraction', this.model);
 *      const output = await extractor(text, { pooling: 'mean', normalize: true });
 *      return Array.from(output.data as Float32Array);
 *
 * For now, this falls back to NoopEmbeddingProvider behavior so the rest of
 * the system is unaffected. A future release will swap in the real implementation.
 */
export class LocalXenovaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private fallback: EmbeddingProvider;

  constructor(options: LocalXenovaEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    // Use noop-derived behavior until a future release adds the real model.
    this.fallback = new NoopEmbeddingProvider({
      dimensions: options.dimensions,
      model: options.model
    });
  }

  async embed(text: string): Promise<number[]> {
    return this.fallback.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.fallback.embedBatch(texts);
  }
}
