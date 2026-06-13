import { describe, expect, it } from 'vitest';
import { formatMemoriesAsXml, type MemoryForFormat } from '../../packages/server/src/injection/formatter.js';

describe('formatMemoriesAsXml', () => {
  it('renders memories as XML with phase header', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Use SQLite', summary: 'Use SQLite.' }
    ];
    const xml = formatMemoriesAsXml('session_start', memories);
    expect(xml).toContain('<memory-context');
    expect(xml).toContain('phase="session_start"');
    expect(xml).toContain('Use SQLite');
  });

  it('sorts memories by tier (long first) then strength', () => {
    const memories: MemoryForFormat[] = [
      { id: 's1', type: 'event', tier: 'short', strength: 0.1, importance: 1, title: 'Short', summary: 's' },
      { id: 'l1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Long', summary: 'l' }
    ];
    const xml = formatMemoriesAsXml('prompt_delta', memories);
    const longIdx = xml.indexOf('Long');
    const shortIdx = xml.indexOf('Short');
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it('escapes XML special characters in title', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'fact', tier: 'long', strength: 0.5, importance: 5, title: 'A & B <c>', summary: 'safe' }
    ];
    const xml = formatMemoriesAsXml('session_start', memories);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
  });
});
