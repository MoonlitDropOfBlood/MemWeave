import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api/client';
import { useLocale } from '../lib/i18n';
import type { GraphResponse, EdgeType, MemoryType, MemoryTier } from '../api/types';
import { Dropdown } from '../components/common/Dropdown';
import styles from './GraphPage.module.css';

const ALL_EDGE_TYPES: EdgeType[] = [
  'causes', 'enables', 'contradicts', 'supersedes', 'references',
  'related_to', 'before', 'after', 'duplicates', 'refines',
];

const EDGE_COLOR: Record<EdgeType, string> = {
  causes: 'var(--edge-causes)',
  enables: 'var(--edge-enables)',
  contradicts: 'var(--edge-contradicts)',
  supersedes: 'var(--edge-supersedes)',
  references: 'var(--edge-references)',
  related_to: 'var(--edge-related_to)',
  before: 'var(--edge-before)',
  after: 'var(--edge-after)',
  duplicates: 'var(--edge-duplicates)',
  refines: 'var(--edge-refines)',
};

const EDGE_LABEL: Record<EdgeType, string> = {
  causes: 'causes',
  enables: 'enables',
  contradicts: 'contradicts',
  supersedes: 'supersedes',
  references: 'references',
  related_to: 'related',
  before: 'before',
  after: 'after',
  duplicates: 'duplicates',
  refines: 'refines',
};

// Read the CSS variable at runtime so we hand hex/rgb to @xyflow
// (it can't resolve CSS vars in inline styles).
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type MemoryNodeData = {
  title: string;
  type: MemoryType;
  tier: MemoryTier;
  isCenter: boolean;
  isDimmed: boolean;
};

function MemoryNode({ id, data }: NodeProps<Node<MemoryNodeData>>) {
  const navigate = useNavigate();
  const tierColor: Record<MemoryTier, string> = {
    short: cssVar('--tier-short'),
    medium: cssVar('--tier-medium'),
    long: cssVar('--tier-long'),
  };
  const go = useCallback(() => navigate(`/memories/${id}`), [navigate, id]);
  return (
    <div
      className={`${styles.node} ${data.isCenter ? styles.nodeCenter : ''} ${data.isDimmed ? styles.nodeDimmed : ''}`}
      style={{ borderLeftColor: tierColor[data.tier] }}
      onClick={go}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(); }}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
      <div className={styles.nodeType}>{data.type}</div>
      <div className={styles.nodeTitle}>{data.title}</div>
    </div>
  );
}

const nodeTypes = { memory: MemoryNode };

export function GraphPage() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<'in' | 'out' | 'both'>('both');
  const [selectedTypes, setSelectedTypes] = useState<Set<EdgeType>>(new Set(ALL_EDGE_TYPES));

  const graphQ = useQuery<GraphResponse>({
    queryKey: ['memory-graph', id, depth, direction],
    queryFn: () => {
      const types = Array.from(selectedTypes).join(',');
      return api.get<GraphResponse>(
        `/memories/${id}/graph?depth=${depth}&direction=${direction}&edgeTypes=${types}`
      );
    },
    enabled: Boolean(id),
  });

  const toggleType = useCallback((et: EdgeType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(et)) next.delete(et);
      else next.add(et);
      return next;
    });
  }, []);

  // Pick a reasonable layout: center the root, BFS layers around it.
  // For each layer, distribute nodes evenly on a circle around the center
  // of that layer. Simple and predictable for 1-3 depth.
  const layout = useMemo(() => {
    const data = graphQ.data;
    if (!data || !id) return { nodes: [] as Node<MemoryNodeData>[], edges: [] as Edge[] };
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    if (!nodeById.has(id)) return { nodes: [], edges: [] };

    const adjOut = new Map<string, Set<string>>();
    const adjIn = new Map<string, Set<string>>();
    for (const n of data.nodes) { adjOut.set(n.id, new Set()); adjIn.set(n.id, new Set()); }
    for (const e of data.edges) {
      adjOut.get(e.fromMemoryId)?.add(e.toMemoryId);
      adjIn.get(e.toMemoryId)?.add(e.fromMemoryId);
    }

    // BFS from `id`, honoring direction
    const layer = new Map<string, number>();
    layer.set(id, 0);
    const queue: string[] = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      const curLayer = layer.get(cur)!;
      if (curLayer >= depth) continue;
      const neighbours: string[] = [];
      if (direction === 'out' || direction === 'both') {
        for (const n of adjOut.get(cur) ?? []) neighbours.push(n);
      }
      if (direction === 'in' || direction === 'both') {
        for (const n of adjIn.get(cur) ?? []) neighbours.push(n);
      }
      for (const n of neighbours) {
        if (!layer.has(n)) { layer.set(n, curLayer + 1); queue.push(n); }
      }
    }

    // Group by layer
    const byLayer = new Map<number, string[]>();
    for (const [nid, l] of layer) {
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(nid);
    }

    // Lay out — center on (0,0), layer L is a circle of radius 240 * L,
    // nodes evenly spaced. Within a layer, leave a 60-degree gap at the
    // top so the center node's vertical handle has room.
    const NODE_W = 180;
    const NODE_H = 70;
    const positioned: Node<MemoryNodeData>[] = [];
    const layerRadii = [0, 240, 420, 580];
    const rootNode = nodeById.get(id!)!;
    for (const [l, ids] of byLayer) {
      if (l === 0) {
        positioned.push({
          id: id!,
          type: 'memory',
          position: { x: -NODE_W / 2, y: -NODE_H / 2 },
          data: { title: rootNode.title, type: rootNode.type, tier: rootNode.tier, isCenter: true, isDimmed: false },
        });
        continue;
      }
      const r = layerRadii[Math.min(l, layerRadii.length - 1)] ?? 580;
      ids.forEach((nid, i) => {
        const t01 = (i + 1) / (ids.length + 1);
        // Distribute evenly around a full circle; start at top (12 o'clock).
        const angle = -Math.PI / 2 + 2 * Math.PI * t01;
        const x = Math.cos(angle) * r - NODE_W / 2;
        const y = Math.sin(angle) * r - NODE_H / 2;
        const mem = nodeById.get(nid)!;
        positioned.push({
          id: nid,
          type: 'memory',
          position: { x, y },
          data: { title: mem.title, type: mem.type, tier: mem.tier, isCenter: false, isDimmed: false },
        });
      });
    }

    // Build xyflow edges. Filter by selected edge types AND only edges where
    // both endpoints are in the positioned set (BFS-bounded).
    const presentIds = new Set(positioned.map((n) => n.id));
    const edges: Edge[] = data.edges
      .filter((e) => presentIds.has(e.fromMemoryId) && presentIds.has(e.toMemoryId))
      .filter((e) => selectedTypes.has(e.type))
      .map((e) => ({
        id: e.id,
        source: e.fromMemoryId,
        target: e.toMemoryId,
        type: 'smoothstep',
        label: EDGE_LABEL[e.type],
        animated: e.type === 'contradicts',
        style: { stroke: cssVar(stripVar(EDGE_COLOR[e.type])), strokeWidth: 1.5 },
        labelStyle: { fontSize: 10, fontFamily: 'var(--font-mono)', fill: cssVar('--text-muted') },
        labelBgStyle: { fill: cssVar('--surface'), fillOpacity: 0.85 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: { type: MarkerType.ArrowClosed, color: cssVar(stripVar(EDGE_COLOR[e.type])) },
      }));

    return { nodes: positioned, edges };
  }, [graphQ.data, id, depth, direction, selectedTypes]);

  // Theme: re-read CSS vars on mount so dark/light switch re-styles edges
  const [, force] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => force((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);

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
              { value: 'in',   label: t('graphPage.option.incoming') },
            ]}
          />
        </label>

        <div className={styles.field}>
          <span>{t('graphPage.edgeTypes')}</span>
          <div className={styles.edgeTypeList}>
            {ALL_EDGE_TYPES.map((et) => (
              <label key={et} className={styles.edgeType}>
                <input
                  type="checkbox"
                  checked={selectedTypes.has(et)}
                  onChange={() => toggleType(et)}
                />
                <span style={{ borderColor: EDGE_COLOR[et] }}>{et}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.legend}>
          <span className={styles.legendLabel}>Tier</span>
          <div className={styles.legendRow}><span className={styles.legendDot} style={{ background: 'var(--tier-short)' }} /> short</div>
          <div className={styles.legendRow}><span className={styles.legendDot} style={{ background: 'var(--tier-medium)' }} /> medium</div>
          <div className={styles.legendRow}><span className={styles.legendDot} style={{ background: 'var(--tier-long)' }} /> long</div>
        </div>
      </aside>

      <main className={styles.canvas}>
        {graphQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> {t('graphPage.loading')}</div>
        ) : graphQ.error ? (
          <div className={styles.error}>{t('graphPage.error')} {(graphQ.error as Error).message}</div>
        ) : !graphQ.data || layout.nodes.length === 0 ? (
          <div className={styles.empty}>{t('graphPage.empty')}</div>
        ) : (
          <div className={styles.flowWrap} data-testid="graph-flow">
            <ReactFlow
              nodes={layout.nodes}
              edges={layout.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) => {
                  const tier = (n.data as MemoryNodeData | undefined)?.tier;
                  if (tier === 'short') return cssVar('--tier-short');
                  if (tier === 'medium') return cssVar('--tier-medium');
                  if (tier === 'long') return cssVar('--tier-long');
                  return cssVar('--text-muted');
                }}
                pannable
                zoomable
              />
            </ReactFlow>
          </div>
        )}
      </main>
    </div>
  );
}

// Helper: turn "var(--edge-causes)" into "--edge-causes" so cssVar can resolve it
function stripVar(s: string): string {
  return s.replace(/^var\(/, '').replace(/\)$/, '');
}
