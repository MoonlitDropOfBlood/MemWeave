import { describe, expect, it } from 'vitest';
import { formatMemoriesAsXml, formatAboutUser, type MemoryForFormat } from '../../packages/server/src/injection/formatter.js';

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

  it('prepends an <about-user> section when a profile is provided (batch F)', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'fact', tier: 'long', strength: 0.9, importance: 9, title: 'T', summary: 's' }
    ];
    const profile = { userKey: 'default', traits: ['prefers TypeScript', 'backend dev'], summary: 'A senior backend engineer.' };
    const xml = formatMemoriesAsXml('session_start', memories, profile);
    expect(xml).toContain('<about-user key="default">');
    expect(xml).toContain('A senior backend engineer.');
    expect(xml).toContain('<traits>prefers TypeScript, backend dev</traits>');
    // about-user comes BEFORE memory-context
    expect(xml.indexOf('<about-user')).toBeLessThan(xml.indexOf('<memory-context'));
  });

  it('omits <about-user> when no profile is given (backward compatible)', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'fact', tier: 'long', strength: 0.9, importance: 9, title: 'T', summary: 's' }
    ];
    const xml = formatMemoriesAsXml('session_start', memories);
    expect(xml).not.toContain('<about-user');
    expect(xml).toContain('<memory-context');
  });
});

describe('formatAboutUser', () => {
  it('returns empty string for null/undefined profile', () => {
    expect(formatAboutUser(null)).toBe('');
    expect(formatAboutUser(undefined)).toBe('');
  });

  it('returns empty string when profile has no traits and no summary', () => {
    expect(formatAboutUser({ userKey: 'd', traits: [], summary: '' })).toBe('');
    expect(formatAboutUser({ userKey: 'd', traits: [], summary: '   ' })).toBe('');
  });

  it('renders summary + traits when both present', () => {
    const xml = formatAboutUser({ userKey: 'u1', traits: ['a', 'b'], summary: 'S' });
    expect(xml).toContain('<about-user key="u1">');
    expect(xml).toContain('<summary>S</summary>');
    expect(xml).toContain('<traits>a, b</traits>');
  });

  it('escapes special characters in summary and traits', () => {
    const xml = formatAboutUser({ userKey: 'u', traits: ['<x>'], summary: 'A & B' });
    expect(xml).toContain('&lt;x&gt;');
    expect(xml).toContain('A &amp; B');
  });
});
