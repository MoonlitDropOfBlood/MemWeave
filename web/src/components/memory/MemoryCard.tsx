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
    >
      <div className={styles.header}>
        <TypeBadge type={memory.type} />
        <TierBadge tier={memory.tier} />
        <span className={styles.title}>{memory.title}</span>
      </div>
      <div className={styles.summary}>{truncate(memory.summary, 140)}</div>
      <ScopeChips scopes={memory.scopes} />
      <div className={styles.footer}>
        <StrengthBar value={memory.strength} label />
        <span className={styles.meta}>
          {memory.accessCount}× · {formatRelativeTime(memory.lastAccessedAt)}
        </span>
      </div>
    </button>
  );
}
