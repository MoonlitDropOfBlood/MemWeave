import { OpenaiLlmProvider } from './openai.js';
import { NoopLlmProvider } from './noop.js';

export interface LlmProvider {
  /** Compress/transform content. System prompt guides behavior, user prompt provides input. */
  call(systemPrompt: string, userPrompt: string): Promise<string>;
}

export type LlmProviderKind = 'openai-compatible' | 'noop';

export function createLlmProvider(kind: LlmProviderKind, config: Record<string, unknown>): LlmProvider {
  switch (kind) {
    case 'openai-compatible': {
      const provider = new OpenaiLlmProvider(config);
      // Graceful degrade: openai-compatible without an apiKey is a noop.
      // This keeps the "no external LLM required" guarantee while still
      // letting users wire the provider in advance of having a key.
      if (!provider.isConfigured) return new NoopLlmProvider();
      return provider;
    }
    case 'noop':
      return new NoopLlmProvider();
    default:
      throw new Error('Unknown LLM provider kind: ' + kind);
  }
}
