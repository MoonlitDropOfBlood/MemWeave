import type { MemoryRecord } from '../core/types.js';

export type SearchSource = 'vector' | 'bm25' | 'graph' | 'causal';

export interface RankedCandidate {
  candidate: { memory: MemoryRecord; sources: Set<SearchSource> };
  rank: number;
  source: SearchSource;
}

export interface FusedResult {
  candidate: { memory: MemoryRecord; sources: Set<SearchSource> };
  finalScore: number;
  rrfScore: number;
  tierWeight: number;
  strengthWeight: number;
}

const TIER_WEIGHTS: Record<MemoryRecord['tier'], number> = {
  long: 1.15,
  medium: 1.0,
  short: 0.85
};

const DEFAULT_RRF_K = 60;

export function fuseResults(streams: RankedCandidate[][], rrfK: number = DEFAULT_RRF_K): FusedResult[] {
  const byMemoryId = new Map<string, RankedCandidate & { rrfScore: number }>();

  for (const stream of streams) {
    for (const ranked of stream) {
      if (ranked.rank < 0) continue;
      const id = ranked.candidate.memory.id;
      const rrfContribution = 1 / (rrfK + ranked.rank);
      const existing = byMemoryId.get(id);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.candidate.sources.add(ranked.source);
      } else {
        byMemoryId.set(id, {
          ...ranked,
          rrfScore: rrfContribution,
          candidate: {
            ...ranked.candidate,
            sources: new Set(ranked.candidate.sources)
          }
        });
      }
    }
  }

  const results: FusedResult[] = [];
  for (const entry of byMemoryId.values()) {
    const tierWeight = TIER_WEIGHTS[entry.candidate.memory.tier] ?? 1.0;
    const safeStrength = Number.isFinite(entry.candidate.memory.strength) ? Math.max(0, Math.min(1, entry.candidate.memory.strength)) : 0;
    const strengthWeight = 0.5 + safeStrength;
    const finalScore = entry.rrfScore * tierWeight * strengthWeight;
    results.push({
      candidate: entry.candidate,
      finalScore,
      rrfScore: entry.rrfScore,
      tierWeight,
      strengthWeight
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);
  return results;
}
