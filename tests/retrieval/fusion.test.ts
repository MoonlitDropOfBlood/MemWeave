import { describe, expect, it } from 'vitest';
import { fuseResults, type RankedCandidate, type SearchSource } from '../../src/retrieval/fusion.js';

function mem(id: string, tier: 'short' | 'medium' | 'long' = 'short', strength = 0.5, importance = 5) {
  return {
    memory: { id, tier, strength, importance } as any,
    sources: new Set<SearchSource>()
  };
}

describe('fuseResults', () => {
  it('fuses RRF scores from multiple streams', () => {
    const streamA: RankedCandidate[] = [
      { candidate: mem('m1'), rank: 0, source: 'vector' },
      { candidate: mem('m2'), rank: 1, source: 'vector' }
    ];
    const streamB: RankedCandidate[] = [
      { candidate: mem('m1'), rank: 0, source: 'bm25' },
      { candidate: mem('m3'), rank: 1, source: 'bm25' }
    ];
    const result = fuseResults([streamA, streamB]);
    const ids = result.map(r => r.candidate.memory.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    expect(ids).toContain('m3');
  });

  it('applies tierWeight: long > medium > short', () => {
    const candidate = { candidate: mem('m1', 'long'), rank: 0, source: 'vector' as const };
    const longResult = fuseResults([[candidate]]);
    const candidate2 = { candidate: mem('m2', 'short'), rank: 0, source: 'vector' as const };
    const shortResult = fuseResults([[candidate2]]);
    expect(longResult[0].finalScore).toBeGreaterThan(shortResult[0].finalScore);
  });

  it('applies strengthWeight: higher strength scores higher', () => {
    const strong = { candidate: mem('m1', 'medium', 0.9), rank: 0, source: 'vector' as const };
    const weak = { candidate: mem('m2', 'medium', 0.1), rank: 0, source: 'vector' as const };
    const result = fuseResults([[strong], [weak]]);
    const strongRow = result.find(r => r.candidate.memory.id === 'm1')!;
    const weakRow = result.find(r => r.candidate.memory.id === 'm2')!;
    expect(strongRow.finalScore).toBeGreaterThan(weakRow.finalScore);
  });

  it('deduplicates by memoryId across streams', () => {
    const streamA: RankedCandidate[] = [{ candidate: mem('m1'), rank: 0, source: 'vector' }];
    const streamB: RankedCandidate[] = [{ candidate: mem('m1'), rank: 0, source: 'bm25' }];
    const result = fuseResults([streamA, streamB]);
    const m1Count = result.filter(r => r.candidate.memory.id === 'm1').length;
    expect(m1Count).toBe(1);
  });
});
