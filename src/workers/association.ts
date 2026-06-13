import type { LlmProvider } from '../providers/llm/index.js';
import { EDGE_EXTRACT_SYSTEM, buildEdgeExtractPrompt } from '../prompts/edge-extract.js';

export interface EdgeCandidate {
  targetMemoryId: string;
  type: string;
  reason: string;
  confidence: number;
}

function isValidEdge(candidate: unknown): candidate is EdgeCandidate {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  return (
    typeof c.targetMemoryId === 'string' &&
    typeof c.type === 'string' &&
    typeof c.reason === 'string' &&
    typeof c.confidence === 'number'
  );
}

export async function extractEdges(
  provider: LlmProvider,
  newMemory: { title: string; content: string; concepts: string[] },
  existingMemories: Array<{ id: string; title: string; summary: string; concepts: string[] }>
): Promise<EdgeCandidate[]> {
  if (existingMemories.length === 0) return [];

  let raw: string;
  try {
    const prompt = buildEdgeExtractPrompt(newMemory, existingMemories);
    raw = await provider.call(EDGE_EXTRACT_SYSTEM, prompt);
  } catch (err) {
    console.warn('[association] Provider call failed:', err);
    return [];
  }

  if (!raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[association] Failed to parse JSON response');
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const existingIds = new Set(existingMemories.map(m => m.id));

  return parsed
    .filter(isValidEdge)
    .filter(e => e.confidence >= 0.6)
    .filter(e => existingIds.has(e.targetMemoryId));
}
