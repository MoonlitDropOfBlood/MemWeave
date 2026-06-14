import { z } from 'zod';
import type { LlmProvider } from './index.js';

const OpenaiConfigSchema = z.object({
  baseUrl: z.string().url().default('https://api.openai.com/v1'),
  // Optional: if missing/empty, the provider degrades to a noop (matches the
  // "no external LLM required" boundary declared in src/providers/AGENTS.md).
  apiKey: z.string().optional(),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(2048)
});

export class OpenaiLlmProvider implements LlmProvider {
  private config: z.infer<typeof OpenaiConfigSchema>;

  constructor(raw: Record<string, unknown>) {
    this.config = OpenaiConfigSchema.parse(raw);
  }

  /** True only when a real remote endpoint is configured. */
  get isConfigured(): boolean {
    return typeof this.config.apiKey === 'string' && this.config.apiKey.length > 0;
  }

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = await res.json() as { choices: Array<{ message: { content: string | null } }> };
      return json.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      throw new Error('LLM request failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
}
