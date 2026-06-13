import type { EmbeddingProvider } from './index.js';

export interface OpenaiCompatibleEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

/**
 * Embedding provider that calls an OpenAI-compatible /v1/embeddings endpoint.
 */
export class OpenaiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(options: OpenaiCompatibleEmbeddingOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.timeoutMs = options.timeoutMs;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = `${this.baseUrl}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Embedding API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
    // Order by index to be safe
    const sorted = json.data.slice().sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
