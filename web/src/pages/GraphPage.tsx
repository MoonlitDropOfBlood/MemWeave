import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLocale } from '../lib/i18n';
import type { GraphResponse } from '../api/types';
import { useState } from 'react';
import { TierBadge, TypeBadge } from '../components/common/TypeBadge';
import { Dropdown } from '../components/common/Dropdown';
import styles from './GraphPage.module.css';

const ALL_EDGE_TYPES = ['causes', 'enables', 'contradicts', 'supersedes', 'references', 'related_to', 'before', 'after', 'duplicates', 'refines'] as const;
const EDGE_COLOR: Record<typeof ALL_EDGE_TYPES[number], string> = {
  causes: 'var(--edge-causes)',
  enables: 'var(--edge-enables)',
  contradicts: 'var(--edge-contradicts)',
  supersedes: 'var(--edge-supersedes)',
  references: 'var(--edge-references)',
  related_to: 'var(--edge-related_to)',
  before: 'var(--edge-before)',
  after: 'var(--edge-after)',
  duplicates: 'var(--edge-duplicates)',
  refines: 'var(--edge-refines)'
};

export function GraphPage() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<'in' | 'out' | 'both'>('both');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(ALL_EDGE_TYPES));

  const graphQ = useQuery<GraphResponse>({
    queryKey: ['memory-graph', id, depth, direction],
    queryFn: () => {
      const types = Array.from(selectedTypes).join(',');
      return api.get<GraphResponse>(`/memories/${id}/graph?depth=${depth}&direction=${direction}&edgeTypes=${types}`);
    }
  });

  const toggleType = (t: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <aside className={styles.controls}>
        <h2 className={styles.controlsTitle}>{t('graphPage.filters')}</h2>

        <label className={styles.field}>
          <span>{t('graphPage.depth')}</span>
          <input
            type="range"
            min={1}
            max={3}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
          <span className={styles.controlVal}>{depth}</span>
        </label>

        <label className={styles.field}>
          <span>{t('graphPage.direction')}</span>
          <Dropdown<'in' | 'out' | 'both'>
            value={direction}
            onChange={setDirection}
            size="sm"
            options={[
              { value: 'both', label: t('graphPage.option.both') },
              { value: 'out',  label: t('graphPage.option.outgoing') },
              { value: 'in',   label: t('graphPage.option.incoming') }
            ]}
          />
        </label>

        <div className={styles.field}>
          <span>{t('graphPage.edgeTypes')}</span>
          <div className={styles.edgeTypeList}>
            {ALL_EDGE_TYPES.map((t) => (
              <label key={t} className={styles.edgeType}>
                <input
                  type="checkbox"
                  checked={selectedTypes.has(t)}
                  onChange={() => toggleType(t)}
                />
                <span style={{ borderColor: EDGE_COLOR[t] }}>{t}</span>
              </label>
            ))}
          </div>
        </div>
      </aside>

      <main className={styles.canvas}>
        {graphQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> {t('graphPage.loading')}</div>
        ) : graphQ.error ? (
          <div className={styles.error}>{t('graphPage.error')} {(graphQ.error as Error).message}</div>
        ) : !graphQ.data || graphQ.data.nodes.length === 0 ? (
          <div className={styles.empty}>{t('graphPage.empty')}</div>
        ) : (
          <div className={styles.graphWrap}>
            {graphQ.data.nodes.map((n, i) => {
              const angle = (i / Math.max(1, graphQ.data!.nodes.length)) * 2 * Math.PI;
              const radius = 180;
              const x = 50 + Math.cos(angle) * radius;
              const y = 50 + Math.sin(angle) * radius;
              const isCenter = n.id === id;
              return (
                <div
                  key={n.id}
                  className={isCenter ? `${styles.node} ${styles.nodeCenter}` : styles.node}
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <div className={styles.nodeBadges}>
                    <TypeBadge type={n.type} />
                    <TierBadge tier={n.tier} />
                  </div>
                  <div className={styles.nodeTitle}>{n.title}</div>
                </div>
              );
            })}
            {graphQ.data.edges.map((e) => {
              // Simple line rendering: SVG overlay
              const fromIdx = graphQ.data!.nodes.findIndex((n) => n.id === e.fromMemoryId);
              const toIdx = graphQ.data!.nodes.findIndex((n) => n.id === e.toMemoryId);
              if (fromIdx < 0 || toIdx < 0) return null;
              const fromAngle = (fromIdx / graphQ.data!.nodes.length) * 2 * Math.PI;
              const toAngle = (toIdx / graphQ.data!.nodes.length) * 2 * Math.PI;
              const r = 180;
              const fx = 50 + Math.cos(fromAngle) * r;
              const fy = 50 + Math.sin(fromAngle) * r;
              const tx = 50 + Math.cos(toAngle) * r;
              const ty = 50 + Math.sin(toAngle) * r;
              return (
                <svg key={e.id} className={styles.edges} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <line
                    x1={fx} y1={fy} x2={tx} y2={ty}
                    style={{ stroke: EDGE_COLOR[e.type] }}
                    className={styles.edge}
                  />
                </svg>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
