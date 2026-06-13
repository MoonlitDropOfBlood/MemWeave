import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Stats } from '../api/types';
import { formatRelativeTime, formatStrength } from '../lib/format';
import styles from './AtlasPage.module.css';

const ALL_TYPES = ['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow'] as const;
const ALL_TIERS = ['short', 'medium', 'long'] as const;

export function AtlasPage() {
  const { data: stats, isLoading, error } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/stats')
  });

  if (isLoading) return <div className={styles.loading}><span className="spinner" /> Loading Atlas…</div>;
  if (error) return <div className={styles.error}>Failed to load stats: {(error as Error).message}</div>;
  if (!stats) return null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Atlas</h1>
        <p className={styles.subtitle}>
          Memory observatory — strength over time
        </p>
      </header>

      <section className={styles.kpiRow}>
        <KpiCard label="Total memorias" value={stats.totals.memories.toLocaleString()} sub={`${stats.totals.activeMemories} active`} />
        <KpiCard label="Today: new" value={stats.today.newMemories.toLocaleString()} sub={`${stats.today.promoted} promoted · ${stats.today.evicted} evicted`} />
        <KpiCard label="Edges" value={stats.totals.edges.toLocaleString()} sub="causal + reference" />
        <KpiCard
          label="Last sleep"
          value={stats.lastConsolidation ? formatRelativeTime(stats.lastConsolidation.startedAt) : '—'}
          sub={stats.lastConsolidation ? stats.lastConsolidation.summary : 'no runs yet'}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>By tier</h2>
        <div className={styles.barGroup}>
          {ALL_TIERS.map((tier) => (
            <BarRow
              key={tier}
              label={tier}
              value={stats.byTier[tier]}
              max={Math.max(1, ...Object.values(stats.byTier))}
              colorVar={`var(--tier-${tier})`}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>By type</h2>
        <div className={styles.barGroup}>
          {ALL_TYPES.map((type) => (
            <BarRow
              key={type}
              label={type}
              value={stats.byType[type]}
              max={Math.max(1, ...Object.values(stats.byType))}
              colorVar={`var(--type-${type})`}
            />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent projects</h2>
        {stats.recentProjects.length === 0 ? (
          <p className={styles.empty}>No scoped memorias yet.</p>
        ) : (
          <div className={styles.projectChips}>
            {stats.recentProjects.map((p) => (
              <a key={p.project} href={`/ui/memories?project=${encodeURIComponent(p.project)}`} className={styles.projectChip}>
                <span className={styles.projectName}>{p.project}</span>
                <span className={styles.projectCount}>{p.count}</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function BarRow({ label, value, max, colorVar }: { label: string; value: number; max: number; colorVar: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${pct}%`, background: colorVar }} />
      </div>
      <span className={styles.barValue}>{formatStrength(value)}</span>
    </div>
  );
}
