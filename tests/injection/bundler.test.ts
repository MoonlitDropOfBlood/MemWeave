import { describe, expect, it } from 'vitest';
import { createContentHash, buildStablePack, buildDeltaPack, type InjectionBundle } from '../../packages/server/src/injection/bundler.js';

describe('createContentHash', () => {
  it('produces stable hash for same content', () => {
    const a = createContentHash('memory-pack', ['m1', 'm2', 'm3']);
    const b = createContentHash('memory-pack', ['m3', 'm2', 'm1']);
    expect(a).toBe(b);
  });

  it('differs when memoryIds differ', () => {
    const a = createContentHash('pack', ['m1']);
    const b = createContentHash('pack', ['m2']);
    expect(a).not.toBe(b);
  });

  it('differs when phase differs', () => {
    const a = createContentHash('session_start', ['m1']);
    const b = createContentHash('prompt_delta', ['m1']);
    expect(a).not.toBe(b);
  });
});

describe('buildStablePack', () => {
  it('builds stable pack from high-strength memories', () => {
    const memories = [
      { id: 'm1', tier: 'long' as const, strength: 0.9, importance: 9, title: 'A', summary: 'a', type: 'fact' as const },
      { id: 'm2', tier: 'medium' as const, strength: 0.5, importance: 5, title: 'B', summary: 'b', type: 'fact' as const },
      { id: 'm3', tier: 'short' as const, strength: 0.1, importance: 1, title: 'C', summary: 'c', type: 'event' as const }
    ];
    const pack = buildStablePack(memories, { budget: 1500 });
    expect(pack.memoryIds).toContain('m1');
    expect(pack.memoryIds).not.toContain('m3');
  });
});

describe('buildDeltaPack', () => {
  it('excludes already-injected memoryIds', () => {
    const candidates = [
      { id: 'm1', tier: 'medium' as const, strength: 0.5, importance: 5, title: 'A', summary: 'a', type: 'fact' as const },
      { id: 'm2', tier: 'medium' as const, strength: 0.6, importance: 6, title: 'B', summary: 'b', type: 'fact' as const }
    ];
    const pack = buildDeltaPack(candidates, { alreadyInjected: new Set(['m1']), budget: 1500 });
    expect(pack.memoryIds).toEqual(['m2']);
  });
});
