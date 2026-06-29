import type { LlmProvider } from './index.js';

export interface OllamaProviderOptions {
  /** Ollama server host. Default: 127.0.0.1. */
  host?: string;
  /** Ollama server port. Default: 11434. */
  port?: number;
  /** Model id (e.g. 'qwen2.5:3b'). */
  model: string;
  /** Sampling temperature. Default: 0.2. */
  temperature?: number;
  /** Max output tokens. Default: 2048. */
  maxTokens?: number;
  /** Per-call timeout in ms. Default: 120000 (local CPU inference is slow). */
  timeoutMs?: number;
}

/**
 * LLM provider that talks to a local Ollama server using its OpenAI-compatible
 * `/v1/chat/completions` endpoint.
 *
 * Unlike `OpenaiLlmProvider`, this needs NO api key — Ollama is a local
 * service. This is the zero-config fallback so the LLM-dependent features
 * (compression, value-gate, edge-extraction) work out of the box on a 16GB
 * machine running a small model like qwen2.5:3b.
 *
 * The caller (ollama-manager) is responsible for ensuring the Ollama server
 * is running and the model is pulled before invoking `call()`.
 */
export class OllamaLlmProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(opts: OllamaProviderOptions) {
    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 11434;
    this.baseUrl = `http://${host}:${port}/v1`;
    this.model = opts.model;
    this.temperature = opts.temperature ?? 0.2;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.timeoutMs = opts.timeoutMs ?? 120000;
  }

  get isConfigured(): boolean {
    return this.model.length > 0;
  }

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json() as { choices: Array<{ message: { content: string | null } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }
}
