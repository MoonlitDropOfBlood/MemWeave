import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client';
import type { Memory, MemoryListResponse } from '../api/types';
import { MemoryCard } from '../components/memory/MemoryCard';
import { TierBadge, TypeBadge } from '../components/common/TypeBadge';
import { StrengthBar } from '../components/common/StrengthBar';
import { ScopeChips } from '../components/common/ScopeChips';
import { formatDate } from '../lib/format';
import styles from './MemoriesPage.module.css';

const ALL_TYPES = ['fact', 'decision', 'preference', 'event', 'project_context', 'lesson', 'code_pattern', 'bug', 'workflow'] as const;
const ALL_TIERS = ['short', 'medium', 'long'] as const;

export function MemoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('selected');
  const projectFilter = searchParams.get('project') ?? '';
  const typeFilter = (searchParams.getAll('type') ?? []) as string[];
  const tierFilter = (searchParams.getAll('tier') ?? []) as string[];

  const listQuery = useQuery<MemoryListResponse>({
    queryKey: ['memories', { project: projectFilter, types: typeFilter, tiers: tierFilter }],
    queryFn: () => api.get<MemoryListResponse>(`/memories${qs({
      limit: 50, type: typeFilter[0], tier: tierFilter[0]
    })}`)
  });

  const selectedQuery = useQuery<Memory | null>({
    queryKey: ['memory', selectedId],
    queryFn: async () => selectedId ? api.get<Memory>(`/memories/${selectedId}`) : null,
    enabled: !!selectedId
  });

  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/memories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] });
      setSearchParams((prev) => { prev.delete('selected'); return prev; });
    }
  });

  const setFilter = (key: string, value: string, multi: boolean) => {
    setSearchParams((prev) => {
      if (multi) {
        const current = prev.getAll(key);
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
        prev.delete(key);
        for (const v of next) prev.append(key, v);
      } else {
        prev.set(key, value);
      }
      return prev;
    });
  };

  return (
    <div className={styles.page}>
      <aside className={styles.filterRail}>
        <h2 className={styles.filterTitle}>Filters</h2>

        <FilterGroup title="Type">
          {ALL_TYPES.map((t) => (
            <FilterCheckbox
              key={t}
              label={t}
              checked={typeFilter.includes(t)}
              onChange={() => setFilter('type', t, true)}
            />
          ))}
        </FilterGroup>

        <FilterGroup title="Tier">
          {ALL_TIERS.map((t) => (
            <FilterCheckbox
              key={t}
              label={t}
              checked={tierFilter.includes(t)}
              onChange={() => setFilter('tier', t, true)}
            />
          ))}
        </FilterGroup>

        <FilterGroup title="Project">
          <input
            type="text"
            placeholder="project value"
            className={styles.filterInput}
            value={projectFilter}
            onChange={(e) => setSearchParams((prev) => {
              if (e.target.value) prev.set('project', e.target.value);
              else prev.delete('project');
              return prev;
            })}
          />
        </FilterGroup>
      </aside>

      <section className={styles.list}>
        {listQuery.isLoading ? (
          <div className={styles.empty}><span className="spinner" /> Loading…</div>
        ) : listQuery.error ? (
          <div className={styles.error}>Failed to load: {(listQuery.error as Error).message}</div>
        ) : (listQuery.data?.memories.length ?? 0) === 0 ? (
          <div className={styles.empty}>No memorias match these filters.</div>
        ) : (
          <>
            <div className={styles.listHeader}>
              <span>{listQuery.data!.total.toLocaleString()} total</span>
            </div>
            {listQuery.data!.memories.map((m) => (
              <MemoryCard
                key={m.id}
                memory={m}
                selected={m.id === selectedId}
                onClick={() => setSearchParams((prev) => { prev.set('selected', m.id); return prev; })}
              />
            ))}
          </>
        )}
      </section>

      <aside className={styles.reading}>
        {selectedQuery.isLoading ? (
          <div className={styles.empty}><span className="spinner" /> Loading…</div>
        ) : selectedQuery.data ? (
          <ReadingPanel
            memory={selectedQuery.data}
            onForget={() => {
              if (confirm(`Forget memory "${selectedQuery.data!.title}"?`)) {
                deleteMutation.mutate(selectedQuery.data!.id);
              }
            }}
            onExpandGraph={() => {
              window.location.href = `/ui/memories/${selectedQuery.data!.id}/graph`;
            }}
          />
        ) : (
          <div className={styles.empty}>Select a memory to read it.</div>
        )}
      </aside>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.filterGroup}>
      <h3 className={styles.filterGroupTitle}>{title}</h3>
      <div className={styles.filterGroupBody}>{children}</div>
    </div>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={styles.filterCheckbox}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function ReadingPanel({ memory, onForget, onExpandGraph }: {
  memory: Memory;
  onForget: () => void;
  onExpandGraph: () => void;
}) {
  return (
    <article className={styles.readingArticle}>
      <header className={styles.readingHeader}>
        <div className={styles.readingBadges}>
          <TypeBadge type={memory.type} />
          <TierBadge tier={memory.tier} />
        </div>
        <h1 className={styles.readingTitle}>{memory.title}</h1>
        <ScopeChips scopes={memory.scopes} />
      </header>

      <section className={styles.readingSection}>
        <h2 className={styles.readingSectionTitle}>Summary</h2>
        <p>{memory.summary}</p>
      </section>

      <section className={styles.readingSection}>
        <h2 className={styles.readingSectionTitle}>Content</h2>
        <pre className={styles.readingContent}>{memory.content}</pre>
      </section>

      <section className={styles.readingSection}>
        <h2 className={styles.readingSectionTitle}>Properties</h2>
        <dl className={styles.readingDl}>
          <dt>Strength</dt><dd><StrengthBar value={memory.strength} /></dd>
          <dt>importance</dt><dd>{memory.importance}</dd>
          <dt>confidence</dt><dd>{memory.confidence.toFixed(2)}</dd>
          <dt>Access count</dt><dd>{memory.accessCount}</dd>
          <dt>Source</dt><dd>{memory.source}{memory.sourceClient ? ` · ${memory.sourceClient}` : ''}</dd>
          <dt>Created</dt><dd>{formatDate(memory.createdAt)}</dd>
          {memory.lastAccessedAt && <><dt>Last accessed</dt><dd>{formatDate(memory.lastAccessedAt)}</dd></>}
        </dl>
      </section>

      <footer className={styles.readingActions}>
        <button onClick={onExpandGraph} className={styles.btnSecondary}>Expand graph</button>
        <button onClick={onForget} className={styles.btnDanger}>Forget</button>
      </footer>
    </article>
  );
}
