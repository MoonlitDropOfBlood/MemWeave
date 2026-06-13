import type { MemoryTier } from './types.js';

const TAU_TABLE: Record<MemoryTier, Array<{ min: number; max: number; tau: number }>> = {
  short: [
    { min: 1, max: 3, tau: 1 },
    { min: 4, max: 6, tau: 2 },
    { min: 7, max: 9, tau: 7 },
    { min: 10, max: 10, tau: 30 }
  ],
  medium: [
    { min: 1, max: 3, tau: 5 },
    { min: 4, max: 6, tau: 14 },
    { min: 7, max: 9, tau: 30 },
    { min: 10, max: 10, tau: 60 }
  ],
  long: [
    { min: 1, max: 3, tau: 60 },
    { min: 4, max: 6, tau: 180 },
    { min: 7, max: 10, tau: Number.POSITIVE_INFINITY }
  ]
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function initialStrengthFromImportance(importance: number): number {
  const bounded = Math.max(1, Math.min(10, Math.round(importance)));
  return bounded / 10;
}

export function tauFor(tier: MemoryTier, importance: number): number {
  const bounded = Math.max(1, Math.min(10, Math.round(importance)));
  const row = TAU_TABLE[tier].find((entry) => bounded >= entry.min && bounded <= entry.max);
  if (!row) throw new Error(`No tau mapping for tier=${tier} importance=${bounded}`);
  return row.tau;
}

export interface ApplyDecayInput {
  strength: number;
  tau: number;
  lastDecayAt: number | null;
  now: number;
}

export function applyDecay(input: ApplyDecayInput): { strength: number; lastDecayAt: number } {
  const current = Math.max(0, Math.min(1, input.strength));
  if (input.lastDecayAt === null) return { strength: current, lastDecayAt: input.now };
  if (!Number.isFinite(input.tau)) return { strength: current, lastDecayAt: input.now };
  const elapsedDays = Math.max(0, (input.now - input.lastDecayAt) / DAY_MS);
  const decayFactor = Math.exp(-elapsedDays / input.tau);
  return { strength: Math.max(0, current * decayFactor), lastDecayAt: input.now };
}

export interface ReinforcementInput {
  usedInContext: boolean;
  explicitReference: boolean;
  userConfirmed: boolean;
}

export function reinforcementBoost(input: ReinforcementInput): number {
  if (input.userConfirmed) return 0.3;
  if (input.explicitReference) return 0.15;
  if (input.usedInContext) return 0.1;
  return 0.02;
}
