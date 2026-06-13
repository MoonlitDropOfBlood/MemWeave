import { formatStrength } from '../../lib/format';
import styles from './StrengthBar.module.css';

/** Horizontal bar showing memory strength on a 0..1 scale. */
export function StrengthBar({ value, label = true }: { value: number; label?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const pct = (v * 100).toFixed(0);
  const color =
    v < 0.34 ? 'var(--danger)' : v < 0.67 ? 'var(--warning)' : 'var(--accent)';
  return (
    <div className={styles.bar}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%`, background: color }} />
      </div>
      {label && <span className={styles.label}>{formatStrength(v)}</span>}
    </div>
  );
}
