/**
 * Embedding provider abstraction (matches design spec §9.5).
 *
 * Implementations:
 * - `NoopEmbeddingProvider`: returns a deterministic dummy vector (zeros or hash-derived)
 * - `OpenaiCompatibleEmbeddingProvider`: POSTs to /v1/embeddings
 * - `LocalXenovaEmbeddingProvider`: uses @xenova/transformers (ONNX runtime, CPU).
 *   The default provider — ships prebuilt onnxruntime-node binaries (no compile)
 *   and downloads the model (~137M params, ~545MB) on first use.
 */
import { NoopEmbeddingProvider } from './noop.js';
import { OpenaiCompatibleEmbeddingProvider } from './openai-compatible.js';
import { LocalXenovaEmbeddingProvider } from './local-xenova.js';

export interface EmbeddingProvider {
  /** Embed a single text into a vector. */
  embed(text: string): Promise<number[]>;
  /** Embed a batch of texts. Implementations should default to sequential `embed` calls. */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Embedding dimensionality. */
  readonly dimensions: number;
  /** Underlying model identifier (for diagnostics). */
  readonly model: string;
}

export { NoopEmbeddingProvider, OpenaiCompatibleEmbeddingProvider, LocalXenovaEmbeddingProvider };

export type EmbeddingProviderKind = 'local-xenova' | 'openai-compatible' | 'noop';

export interface CreateEmbeddingProviderOptions {
  kind: EmbeddingProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export function createEmbeddingProvider(options: CreateEmbeddingProviderOptions): EmbeddingProvider {
  switch (options.kind) {
    case 'openai-compatible':
      return new OpenaiCompatibleEmbeddingProvider({
        baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
        apiKey: options.apiKey ?? '',
        model: options.model ?? 'text-embedding-3-small',
        dimensions: options.dimensions ?? 1536,
        timeoutMs: options.timeoutMs ?? 30000
      });
    case 'local-xenova':
      return new LocalXenovaEmbeddingProvider({
        model: options.model ?? 'Xenova/nomic-embed-text-v1',
        dimensions: options.dimensions ?? 768
      });
    case 'noop':
    default:
      return new NoopEmbeddingProvider({
        dimensions: options.dimensions ?? 768,
        model: options.model ?? 'noop'
      });
  }
}
