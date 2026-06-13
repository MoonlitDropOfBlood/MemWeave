import { describe, expect, it } from 'vitest';
import { buildSystemAppend, type MemoryForInjection } from '../../src/plugin/injector.js';

describe('buildSystemAppend', () => {
  it('builds a cache-stable XML section', () => {
    const mems: MemoryForInjection[] = [
      { id: 'm1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Use SQLite', summary: 'SQLite v1' }
    ];
    const xml = buildSystemAppend('session_start', mems);
    expect(xml).toContain('<memory-context');
    expect(xml).toContain('phase="session_start"');
    expect(xml).toContain('Use SQLite');
  });

  it('returns empty string for empty memories', () => {
    const xml = buildSystemAppend('prompt_delta', []);
    expect(xml).toBe('');
  });

  it('sorts long memories first', () => {
    const mems: MemoryForInjection[] = [
      { id: 's1', type: 'event', tier: 'short', strength: 0.5, importance: 5, title: 'Short', summary: 's' },
      { id: 'l1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Long', summary: 'l' }
    ];
    const xml = buildSystemAppend('session_start', mems);
    const longIdx = xml.indexOf('Long');
    const shortIdx = xml.indexOf('Short');
    expect(longIdx).toBeGreaterThan(-1);
    expect(shortIdx).toBeGreaterThan(-1);
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it('escapes XML special characters', () => {
    const mems: MemoryForInjection[] = [
      { id: 'm1', type: 'fact', tier: 'long', strength: 0.5, importance: 5, title: 'A & B <c>', summary: 'safe' }
    ];
    const xml = buildSystemAppend('session_start', mems);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
  });
});