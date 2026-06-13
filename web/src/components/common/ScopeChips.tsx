import type { ScopeTag } from '../../api/types';
import styles from './ScopeChips.module.css';

const KEY_COLOR: Record<ScopeTag['key'], string> = {
  project: 'var(--accent)',
  domain: 'var(--link)',
  topic: 'var(--text-muted)'
};

export function ScopeChips({ scopes }: { scopes: ScopeTag[] }) {
  if (scopes.length === 0) return null;
  return (
    <div className={styles.row}>
      {scopes.map((s) => (
        <span
          key={`${s.key}:${s.value}`}
          className={styles.chip}
          style={{ borderColor: KEY_COLOR[s.key], color: KEY_COLOR[s.key] }}
          title={`${s.key} = ${s.value}`}
        >
          <span className={styles.chipKey}>{s.key}:</span>
          <span className={styles.chipValue}>{s.value}</span>
        </span>
      ))}
    </div>
  );
}
