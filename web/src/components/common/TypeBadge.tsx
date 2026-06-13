import type { MemoryType, MemoryTier } from '../../api/types';
import styles from './Badge.module.css';

const TYPE_COLOR_VAR: Record<MemoryType, string> = {
  fact: 'var(--type-fact)',
  decision: 'var(--type-decision)',
  preference: 'var(--type-preference)',
  event: 'var(--type-event)',
  project_context: 'var(--type-project_context)',
  lesson: 'var(--type-lesson)',
  code_pattern: 'var(--type-code-pattern)',
  bug: 'var(--type-bug)',
  workflow: 'var(--type-workflow)'
};

const TIER_COLOR_VAR: Record<MemoryTier, string> = {
  short: 'var(--tier-short)',
  medium: 'var(--tier-medium)',
  long: 'var(--tier-long)'
};

export function TypeBadge({ type }: { type: MemoryType }) {
  return (
    <span className={styles.badge} style={{ borderColor: TYPE_COLOR_VAR[type], color: TYPE_COLOR_VAR[type] }}>
      {type}
    </span>
  );
}

export function TierBadge({ tier }: { tier: MemoryTier }) {
  return (
    <span className={styles.badge} style={{ borderColor: TIER_COLOR_VAR[tier], color: TIER_COLOR_VAR[tier] }}>
      {tier}
    </span>
  );
}
