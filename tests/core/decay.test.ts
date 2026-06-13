import { describe, expect, it } from 'vitest';
import {
  applyDecay,
  initialStrengthFromImportance,
  reinforcementBoost,
  tauFor
} from '../../packages/server/src/core/decay.js';

const DAY = 24 * 60 * 60 * 1000;

describe('decay utilities', () => {
  it('normalizes importance 1-10 into strength 0-1', () => {
    expect(initialStrengthFromImportance(1)).toBe(0.1);
    expect(initialStrengthFromImportance(7)).toBe(0.7);
    expect(initialStrengthFromImportance(10)).toBe(1);
  });

  it('returns tau from tier and importance band', () => {
    expect(tauFor('short', 2)).toBe(1);
    expect(tauFor('short', 5)).toBe(2);
    expect(tauFor('medium', 8)).toBe(30);
    expect(tauFor('long', 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it('applies exponential decay based on elapsed days', () => {
    const now = Date.now();
    const lastDecayAt = now - 2 * DAY;
    const decayed = applyDecay({ strength: 1, tau: 2, lastDecayAt, now });
    expect(decayed.strength).toBeCloseTo(Math.exp(-1), 5);
    expect(decayed.lastDecayAt).toBe(now);
  });

  it('does not decay permanent memory', () => {
    const now = Date.now();
    const lastDecayAt = now - 365 * DAY;
    const decayed = applyDecay({ strength: 0.8, tau: Number.POSITIVE_INFINITY, lastDecayAt, now });
    expect(decayed.strength).toBe(0.8);
    expect(decayed.lastDecayAt).toBe(now);
  });

  it('maps access sources to reinforcement boost', () => {
    expect(reinforcementBoost({ usedInContext: false, explicitReference: false, userConfirmed: false })).toBe(0.02);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: false, userConfirmed: false })).toBe(0.1);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: true, userConfirmed: false })).toBe(0.15);
    expect(reinforcementBoost({ usedInContext: true, explicitReference: false, userConfirmed: true })).toBe(0.3);
  });
});
