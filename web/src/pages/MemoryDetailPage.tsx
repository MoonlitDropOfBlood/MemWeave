import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useLocale } from '../lib/i18n';
import type { AccessLogResponse, GraphResponse, Memory } from '../api/types';
import { TierBadge, TypeBadge } from '../components/common/TypeBadge';
import { StrengthBar } from '../components/common/StrengthBar';
import { ScopeChips } from '../components/common/ScopeChips';
import { formatDate } from '../lib/format';
import { useState } from 'react';
import styles from './MemoryDetailPage.module.css';

export function MemoryDetailPage() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const memoryQ = useQuery<Memory>({
    queryKey: ['memory', id],
    queryFn: () => api.get<Memory>(`/memories/${id}`),
    enabled: !!id
  });
  const graphQ = useQuery<GraphResponse>({
    queryKey: ['memory-graph', id],
    queryFn: () => api.get<GraphResponse>(`/memories/${id}/graph?depth=1&direction=both`)
  });
  const logsQ = useQuery<AccessLogResponse>({
    queryKey: ['memory-access-logs', id],
    queryFn: () => api.get<AccessLogResponse>(`/memories/${id}/access-logs`)
  });

  const [tab, setTab] = useState<'graph' | 'access'>('graph');

  if (memoryQ.isLoading) return <div className={styles.loading}><span className="spinner" /> {t('memoryDetail.loading')}</div>;
  if (memoryQ.error) return <div className={styles.error}>{t('memoryDetail.notFound')}</div>;
  if (!memoryQ.data) return null;
  const m = memoryQ.data;

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <div className={styles.badges}>
          <TypeBadge type={m.type} />
          <TierBadge tier={m.tier} />
        </div>
        <h1 className={styles.title}>{m.title}</h1>
        <ScopeChips scopes={m.scopes} />
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('memoryDetail.summary')}</h2>
        <p>{m.summary}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('memoryDetail.content')}</h2>
        <pre className={styles.content}>{m.content}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('memoryDetail.properties')}</h2>
        <dl className={styles.dl}>
          <dt>{t('memoryDetail.strength')}</dt><dd><StrengthBar value={m.strength} /></dd>
          <dt>{t('memoryDetail.importance')}</dt><dd>{m.importance}</dd>
          <dt>{t('memoryDetail.confidence')}</dt><dd>{m.confidence.toFixed(2)}</dd>
          <dt>{t('memoryDetail.accessCount')}</dt><dd>{m.accessCount}</dd>
          <dt>{t('memoryDetail.source')}</dt><dd>{m.source}</dd>
          <dt>{t('memoryDetail.created')}</dt><dd>{formatDate(m.createdAt)}</dd>
          {m.lastAccessedAt && <><dt>{t('memoryDetail.lastAccessed')}</dt><dd>{formatDate(m.lastAccessedAt)}</dd></>}
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.tabs}>
          <button
            className={tab === 'graph' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab('graph')}
          >{t('memoryDetail.tab.graph')} ({graphQ.data?.nodes.length ?? 0})</button>
          <button
            className={tab === 'access' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab('access')}
          >{t('memoryDetail.tab.accessLogs')} ({logsQ.data?.logs.length ?? 0})</button>
        </div>

        {tab === 'graph' ? (
          <div className={styles.graphPanel}>
            {(graphQ.data?.edges.length ?? 0) === 0 ? (
              <p className={styles.empty}>{t('memoryDetail.emptyEdges')}</p>
            ) : (
              <ul className={styles.edgeList}>
                {graphQ.data!.edges.map((e) => (
                  <li key={e.id} className={styles.edgeItem}>
                    <span className={styles.edgeDirection}>{e.fromMemoryId === m.id ? '→' : '←'}</span>
                    <a href={`/ui/memories/${e.fromMemoryId === m.id ? e.toMemoryId : e.fromMemoryId}`} className={styles.edgeTarget}>
                      {e.fromMemoryId === m.id ? e.toMemoryId.slice(0, 8) : e.fromMemoryId.slice(0, 8)}
                    </a>
                    <span className={styles.edgeType}>{e.type}</span>
                    <span className={styles.edgeStrength}>{t('memoryDetail.edgeStrength')} {e.strength.toFixed(2)}</span>
                    <span className={styles.edgeReason}>{e.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className={styles.logsPanel}>
            {(logsQ.data?.logs.length ?? 0) === 0 ? (
              <p className={styles.empty}>{t('memoryDetail.emptyLogs')}</p>
            ) : (
              <table className={styles.logTable}>
                <thead>
                  <tr>
                    <th>{t('memoryDetail.th.when')}</th><th>{t('memoryDetail.th.source')}</th><th>{t('memoryDetail.th.usedInContext')}</th><th>{t('memoryDetail.th.query')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logsQ.data!.logs.map((l) => (
                    <tr key={l.id}>
                      <td>{formatDate(l.accessedAt)}</td>
                      <td>{l.source}</td>
                      <td>{l.usedInContext ? '✓' : '—'}</td>
                      <td className={styles.mono}>{l.query ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
