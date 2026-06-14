import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useLocale } from '../lib/i18n';
import type { ConsolidationRun } from '../api/types';
import { formatDate, formatRelativeTime } from '../lib/format';
import styles from './SleepPage.module.css';

export function SleepPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<{ runs: ConsolidationRun[]; total: number }>({
    queryKey: ['consolidation-runs'],
    queryFn: () => api.get('/consolidate/runs?limit=20')
  });
  const trigger = useMutation({
    mutationFn: (dryRun: boolean) => api.post<{ run: ConsolidationRun }>('/consolidate', { dryRun }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consolidation-runs'] })
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('sleepPage.title')}</h1>
          <p className={styles.subtitle}>{t('sleepPage.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <label className={styles.dryRun}>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>{t('sleepPage.dryRun')}</span>
          </label>
          <button
            className={styles.runButton}
            disabled={trigger.isPending}
            onClick={() => trigger.mutate(dryRun)}
          >
            {trigger.isPending ? t('sleepPage.running') : t('sleepPage.runNow')}
          </button>
        </div>
      </header>

      {trigger.error && (
        <div className={styles.error}>{t('sleepPage.runFailed')} {(trigger.error as Error).message}</div>
      )}

      {isLoading ? (
        <div className={styles.loading}><span className="spinner" /> {t('sleepPage.loading')}</div>
      ) : error ? (
        <div className={styles.error}>{t('sleepPage.error')} {(error as Error).message}</div>
      ) : (data?.runs.length ?? 0) === 0 ? (
        <div className={styles.empty}>{t('sleepPage.empty')}</div>
      ) : (
        <ul className={styles.list}>
          {data!.runs.map((run, idx) => (
            <RunItem
              key={run.id}
              run={run}
              cycleNumber={data!.runs.length - idx}
              expanded={expanded === run.id}
              onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RunItem({ run, cycleNumber, expanded, onToggle }: {
  run: ConsolidationRun;
  cycleNumber: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  return (
    <li className={styles.run}>
      <button className={styles.runHeader} onClick={onToggle}>
        <span className={styles.runNumber}>{t('sleepPage.cycle')}{cycleNumber}</span>
        <span className={styles.runTime}>{formatRelativeTime(run.startedAt)}</span>
        {run.dryRun && <span className={styles.dryRunBadge}>{t('sleepPage.dryRunBadge')}</span>}
        <span className={styles.runSummary}>{run.summary}</span>
        <span className={styles.runChevron}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <Diff run={run} />}
    </li>
  );
}

function Diff({ run }: { run: ConsolidationRun }) {
  const { t } = useLocale();
  return (
    <div className={styles.diff}>
      <div className={styles.diffMeta}>
        <span>{t('sleepPage.started')} {formatDate(run.startedAt)}</span>
        <span>{t('sleepPage.ended')} {formatDate(run.endedAt)}</span>
        <span>{t('sleepPage.edgesCreated')} {run.edgesCreated}</span>
        <span>{t('sleepPage.contradictions')} {run.contradictionFound}</span>
      </div>
      {run.promoted.length === 0 && run.evicted.length === 0 && run.merged.length === 0 ? (
        <p className={styles.diffEmpty}>{t('sleepPage.noChanges')}</p>
      ) : (
        <ul className={styles.diffList}>
          {run.promoted.map((id) => (
            <li key={`p${id}`} className={styles.diffPromoted}>
              <span className={styles.diffOp}>+</span>
              <span className={styles.diffMsg}>{t('sleepPage.promoted')} {id.slice(0, 8)} (short → medium)</span>
            </li>
          ))}
          {run.evicted.map((id) => (
            <li key={`e${id}`} className={styles.diffEvicted}>
              <span className={styles.diffOp}>−</span>
              <span className={styles.diffMsg}>{t('sleepPage.evicted')} {id.slice(0, 8)} (strength &lt; 0.1, age &gt; 7d)</span>
            </li>
          ))}
          {run.merged.map((pair, i) => (
            <li key={`m${i}`} className={styles.diffMerged}>
              <span className={styles.diffOp}>~</span>
              <span className={styles.diffMsg}>
                {t('sleepPage.merged')} {pair[0]?.slice(0, 8)} + {pair[1]?.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
