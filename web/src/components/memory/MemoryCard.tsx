import { StrengthBar } from '../common/StrengthBar';
import { TierBadge, TypeBadge } from '../common/TypeBadge';
import { ScopeChips } from '../common/ScopeChips';
import { formatRelativeTime, truncate } from '../../lib/format';
import type { Memory } from '../../api/types';
import styles from './MemoryCard.module.css';

export function MemoryCard({
  memory,
  selected = false,
  onClick
}: {
  memory: Memory;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={selected ? `${styles.card} ${styles.cardSelected}` : styles.card}
      onClick={onClick}
      type="button"
      style={{ ['--card-accent' as string]: `var(--type-${memory.type})` }}
    >
      <span className={styles.node} aria-hidden="true" />
      <span className={styles.accessBadge} title={`${memory.accessCount} accesses`}>
        {memory.accessCount}×
      </span>
      <div className={styles.header}>
        <TypeBadge type={memory.type} />
        <TierBadge tier={memory.tier} />
      </div>
      <div className={styles.title}>{memory.title}</div>
      <div className={styles.summary}>{truncate(memory.summary, 160)}</div>
      <ScopeChips scopes={memory.scopes} />
      <div className={styles.footer}>
        <StrengthBar value={memory.strength} />
        <span className={styles.meta}>{formatRelativeTime(memory.lastAccessedAt)}</span>
      </div>
    </button>
  );
}
