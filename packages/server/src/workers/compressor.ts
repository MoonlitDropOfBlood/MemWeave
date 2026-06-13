import type { LlmProvider } from '../providers/llm/index.js';
import { COMPRESSION_SYSTEM, buildCompressionPrompt } from '../prompts/compression.js';

export interface CompressInput {
  hookType: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  userPrompt?: string;
  timestamp: string;
}

export interface MemoryCandidate {
  shouldCreateMemory: boolean;
  type: string;
  title: string;
  summary: string;
  content: string;
  concepts: string[];
  files: string[];
  importance: number;
  confidence: number;
  scopeLevel: string;
  scopes: Array<{ key: string; value: string }>;
  candidateEdges: Array<{ targetHint: string; type: string; reason: string; confidence: number }>;
}

export async function compressObservation(provider: LlmProvider, input: CompressInput): Promise<MemoryCandidate | null> {
  const prompt = buildCompressionPrompt(input);
  const raw = await provider.call(COMPRESSION_SYSTEM, prompt);
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as MemoryCandidate;
    return parsed;
  } catch {
    return null;
  }
}
