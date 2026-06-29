import { OpenaiLlmProvider } from './openai.js';
import { NoopLlmProvider } from './noop.js';
import { OllamaLlmProvider } from './ollama.js';
import { ensureOllamaReady } from './ollama-manager.js';
import { logger } from '../../server/logger.js';

export interface LlmProvider {
  /** Compress/transform content. System prompt guides behavior, user prompt provides input. */
  call(systemPrompt: string, userPrompt: string): Promise<string>;
}

export type LlmProviderKind = 'ollama' | 'openai-compatible' | 'noop';

export interface CreateLlmProviderOptions {
  kind: LlmProviderKind;
  /** Full llm config (baseUrl, apiKey, model, ollama sub-config, etc.). */
  config: Record<string, unknown>;
}

/**
 * Construct an LLM provider. For `ollama`, this also ensures the local Ollama
 * server is running and the model is pulled (best-effort, fail-silent). If
 * Ollama can't be brought up, it degrades to `NoopLlmProvider` so the server
 * still starts — LLM-dependent features just stay rule-based.
 *
 * `ensureOllamaReady` is async (it may spawn a process and pull a model), so
 * this factory is async for the `ollama` kind. Callers should `await` it once
 * at startup (bootstrap) and reuse the instance.
 */
export async function createLlmProvider(kind: LlmProviderKind, config: Record<string, unknown>): Promise<LlmProvider> {
  switch (kind) {
    case 'ollama': {
      const ollama = (config.ollama ?? {}) as Record<string, unknown>;
      const host = (ollama.host as string) ?? '127.0.0.1';
      const port = (ollama.port as number) ?? 11434;
      const model = (ollama.model as string) ?? (config.model as string) ?? 'qwen2.5:3b';
      const temperature = (config.temperature as number) ?? 0.2;
      const maxTokens = (config.maxTokens as number) ?? 2048;
      const timeoutMs = (ollama.timeoutMs as number) ?? 120000;

      const ensureResult = await ensureOllamaReady({
        host, port, model,
        autoStart: (ollama.autoStart as boolean) ?? true,
        autoPull: (ollama.autoPull as boolean) ?? true,
        timeoutMs
      });
      if (!ensureResult.ready) {
        logger.warn({ detail: ensureResult.detail }, 'ollama not ready, LLM degrading to noop');
        return new NoopLlmProvider();
      }
      logger.info({ detail: ensureResult.detail }, 'ollama LLM ready');
      return new OllamaLlmProvider({ host, port, model, temperature, maxTokens, timeoutMs });
    }
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
