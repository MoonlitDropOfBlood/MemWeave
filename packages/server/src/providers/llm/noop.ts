import type { LlmProvider } from './index.js';

export class NoopLlmProvider implements LlmProvider {
  async call(_systemPrompt: string, _userPrompt: string): Promise<string> {
    return '';
  }
}
