import { describe, expect, it } from 'vitest';
import { formatStrength, formatTokens, truncate } from '../src/lib/format';

describe('format helpers', () => {
  it('formatStrength rounds to 2 decimal places', () => {
    expect(formatStrength(0.123)).toBe('0.12');
    expect(formatStrength(1)).toBe('1.00');
    expect(formatStrength(0)).toBe('0.00');
  });

  it('formatTokens shows k for > 1000', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(12345)).toBe('12.3k');
  });

  it('truncate leaves short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncate shortens long text with ellipsis', () => {
    const long = 'a'.repeat(100);
    const out = truncate(long, 10);
    expect(out.length).toBe(10);
    expect(out.endsWith('…')).toBe(true);
  });
});
