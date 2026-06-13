import { createHash } from 'node:crypto';

export type MemoryLite = {
  id: string;
  tier: 'short' | 'medium' | 'long';
  strength: number;
  importance: number;
  title: string;
  summary: string;
  type: string;
};

export type InjectionPhase = 'session_start' | 'prompt_delta' | 'file_pack' | 'failure_delta';

export interface InjectionBundle {
  id: string;
  phase: InjectionPhase;
  sessionId: string;
  tenantId: string;
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
  createdAt: number;
}

export function createContentHash(phase: string, memoryIds: string[]): string {
  const sorted = [...memoryIds].sort();
  const input = `${phase}:${sorted.join(',')}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export interface PackOptions {
  budget: number;
}

export interface BuildResult {
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
}

export function buildStablePack(memories: MemoryLite[], options: PackOptions): BuildResult {
  const filtered = memories.filter(m => m.tier === 'long' || (m.tier === 'medium' && m.strength >= 0.4));
  const sorted = [...filtered].sort((a, b) => {
    if (a.tier === 'long' && b.tier !== 'long') return -1;
    if (a.tier !== 'long' && b.tier === 'long') return 1;
    return b.strength * b.importance - a.strength * a.importance;
  });
  return finalizePack(sorted, options);
}

export interface DeltaOptions extends PackOptions {
  alreadyInjected: Set<string>;
}

export function buildDeltaPack(candidates: MemoryLite[], options: DeltaOptions): BuildResult {
  const filtered = candidates.filter(c => !options.alreadyInjected.has(c.id));
  const sorted = [...filtered].sort((a, b) => b.strength * b.importance - a.strength * a.importance);
  return finalizePack(sorted, options);
}

function finalizePack(memories: MemoryLite[], options: PackOptions): BuildResult {
  const selected: MemoryLite[] = [];
  let tokens = 0;
  for (const m of memories) {
    const cost = Math.max(20, Math.ceil((m.title.length + m.summary.length) / 3));
    if (tokens + cost > options.budget) break;
    selected.push(m);
    tokens += cost;
  }
  const memoryIds = selected.map(m => m.id);
  return {
    memoryIds,
    contentHash: createContentHash('session_start', memoryIds),
    estimatedTokens: tokens
  };
}
