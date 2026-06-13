# MemWeave Retrieval + Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the retrieval engine (Vector + BM25 + Graph + Causal + RRF) and cache-aware injection service that exposes `POST /api/v1/inject` for AI agent plugins to call at session start, prompt submit, file tool, and failure moments.

**Architecture:** A retrieval service that combines vector similarity, BM25 keyword search, graph expansion, and causal chain detection using Reciprocal Rank Fusion (RRF). An injection service that packages results into cache-stable bundles (stable pack + delta pack) with deterministic content hashing for prompt cache reuse.

**Tech Stack:** Node.js 20+, TypeScript, Fastify, better-sqlite3, FTS5, sqlite-vec (deferred to v1.1), existing memweave-server REST API.

**Prerequisites:** memweave-server backend core + MCP shim + LLM workers must be complete.

---

## File Structure

```text
src/retrieval/
  search-engine.ts          — Main search entry point (orchestrates all layers)
  vector-search.ts          — Embedding-based similarity (sqlite-vec stub for v1)
  bm25-search.ts            — FTS5 keyword search
  graph-traversal.ts        — Edge-based BFS/DFS
  causal-chain.ts           — Causal chain detection
  fusion.ts                 — RRF fusion + tier/scope/strength weighting
src/injection/
  bundler.ts                — Build stable/delta packs with deterministic hashing
  formatter.ts              — Render memories as XML for prompt injection
src/rest/routes/
  injection.ts              — POST /api/v1/inject endpoint
src/server/
  http.ts                   — MODIFY: register injection route
tests/retrieval/
  search-engine.test.ts
  fusion.test.ts
tests/injection/
  bundler.test.ts
  formatter.test.ts
tests/rest/
  injection.test.ts
```

---

## Task 1: BM25 Search Layer (FTS5)

**Files:**
- Create: `src/retrieval/bm25-search.ts`
- Create: `tests/retrieval/bm25-search.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/retrieval/bm25-search.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { bm25Search } from '../../src/retrieval/bm25-search.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-bm25-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('bm25Search', () => {
  it('returns memories matching the query', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite is the default store',
      content: 'MemWeave stores v1 data in SQLite.', summary: 'SQLite is the default store.',
      concepts: ['sqlite'], files: [], importance: 6, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const results = await bm25Search(db, 'tenant_default', 'SQLite', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('SQLite');
  });

  it('returns empty array for no match', async () => {
    const results = await bm25Search(db, 'tenant_default', 'nonexistent_query_xyz', 5);
    expect(results).toEqual([]);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      repo.create({
        tenantId: 'tenant_default', type: 'fact', title: `Test ${i}`,
        content: 'shared keyword alpha', summary: 'Test.',
        concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
        scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
      });
    }
    const results = await bm25Search(db, 'tenant_default', 'shared', 3);
    expect(results.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/retrieval/bm25-search.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement BM25 search**

Create `src/retrieval/bm25-search.ts`:

```typescript
import type { Db } from '../db/database.js';
import type { MemoryRecord } from '../core/types.js';

interface MemoryRow {
  id: string;
  tenant_id: string;
  tier: 'short' | 'medium' | 'long';
  type: MemoryRecord['type'];
  title: string;
  content: string;
  summary: string;
  concepts_json: string;
  files_json: string;
  importance: number;
  confidence: number;
  strength: number;
  source: MemoryRecord['source'];
  scope_level: MemoryRecord['scopeLevel'];
  source_client: MemoryRecord['sourceClient'];
  source_device_id: string | null;
  source_session_id: string | null;
  tau: number;
  access_count: number;
  last_accessed_at: number | null;
  last_reinforced_at: number | null;
  last_decay_at: number | null;
  reinforcement_score: number;
  promoted_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  eviction_reason: string | null;
}

export interface SearchResultRow {
  memory: MemoryRecord;
  bm25Score: number;
}

export function bm25Search(db: Db, tenantId: string, query: string, limit: number): SearchResultRow[] {
  if (!query.trim() || limit <= 0) return [];
  const escaped = query.replace(/[^\w\s\u4e00-\u9fff-]/g, ' ').trim();
  if (!escaped) return [];

  const rows = db.prepare(`
    SELECT m.*, bm25(memory_fts) AS bm25_score
    FROM memory_fts
    JOIN memories m ON m.rowid = memory_fts.rowid
    WHERE memory_fts MATCH ?
      AND m.tenant_id = ?
      AND m.deleted_at IS NULL
    ORDER BY bm25_score
    LIMIT ?
  `).all(`${escaped}*`, tenantId, limit) as Array<MemoryRow & { bm25_score: number }>;

  return rows.map(row => ({
    memory: mapRow(row),
    bm25Score: row.bm25_score
  }));
}

function mapRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tier: row.tier,
    type: row.type,
    title: row.title,
    content: row.content,
    summary: row.summary,
    concepts: JSON.parse(row.concepts_json) as string[],
    files: JSON.parse(row.files_json) as string[],
    importance: row.importance,
    confidence: row.confidence,
    strength: row.strength,
    source: row.source,
    scopeLevel: row.scope_level,
    scopes: [],
    sourceClient: row.source_client,
    sourceDeviceId: row.source_device_id,
    sourceSessionId: row.source_session_id,
    tau: row.tau,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    lastReinforcedAt: row.last_reinforced_at,
    lastDecayAt: row.last_decay_at,
    reinforcementScore: row.reinforcement_score,
    promotedAt: row.promoted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    evictionReason: row.eviction_reason
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/retrieval/bm25-search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 2: Fusion Algorithm (RRF + tier/strength weighting)

**Files:**
- Create: `src/retrieval/fusion.ts`
- Create: `tests/retrieval/fusion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/retrieval/fusion.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fuseResults, type RankedCandidate } from '../../src/retrieval/fusion.js';

function mem(id: string, tier: 'short' | 'medium' | 'long' = 'short', strength = 0.5, importance = 5) {
  return {
    memory: { id, tier, strength, importance } as any,
    sources: new Set<string>()
  };
}

describe('fuseResults', () => {
  it('fuses RRF scores from multiple streams', () => {
    const streamA: RankedCandidate[] = [
      { candidate: mem('m1'), rank: 0, source: 'vector' },
      { candidate: mem('m2'), rank: 1, source: 'vector' }
    ];
    const streamB: RankedCandidate[] = [
      { candidate: mem('m1'), rank: 0, source: 'bm25' },
      { candidate: mem('m3'), rank: 1, source: 'bm25' }
    ];
    const result = fuseResults([streamA, streamB]);
    const ids = result.map(r => r.candidate.memory.id);
    expect(ids).toContain('m1');
    expect(ids).toContain('m2');
    expect(ids).toContain('m3');
  });

  it('applies tierWeight: long > medium > short', () => {
    const candidate = { candidate: mem('m1', 'long'), rank: 0, source: 'vector' as const };
    const longResult = fuseResults([[candidate]]);
    const candidate2 = { candidate: mem('m2', 'short'), rank: 0, source: 'vector' as const };
    const shortResult = fuseResults([[candidate2]]);
    expect(longResult[0].finalScore).toBeGreaterThan(shortResult[0].finalScore);
  });

  it('applies strengthWeight: higher strength scores higher', () => {
    const strong = { candidate: mem('m1', 'medium', 0.9), rank: 0, source: 'vector' as const };
    const weak = { candidate: mem('m2', 'medium', 0.1), rank: 0, source: 'vector' as const };
    const result = fuseResults([[strong], [weak]]);
    const strongRow = result.find(r => r.candidate.memory.id === 'm1')!;
    const weakRow = result.find(r => r.candidate.memory.id === 'm2')!;
    expect(strongRow.finalScore).toBeGreaterThan(weakRow.finalScore);
  });

  it('deduplicates by memoryId across streams', () => {
    const streamA: RankedCandidate[] = [{ candidate: mem('m1'), rank: 0, source: 'vector' }];
    const streamB: RankedCandidate[] = [{ candidate: mem('m1'), rank: 0, source: 'bm25' }];
    const result = fuseResults([streamA, streamB]);
    const m1Count = result.filter(r => r.candidate.memory.id === 'm1').length;
    expect(m1Count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/retrieval/fusion.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement fusion**

Create `src/retrieval/fusion.ts`:

```typescript
import type { MemoryRecord } from '../core/types.js';

export type SearchSource = 'vector' | 'bm25' | 'graph' | 'causal';

export interface RankedCandidate {
  candidate: { memory: MemoryRecord; sources: Set<SearchSource> };
  rank: number;
  source: SearchSource;
}

export interface FusedResult {
  candidate: { memory: MemoryRecord; sources: Set<SearchSource> };
  finalScore: number;
  rrfScore: number;
  tierWeight: number;
  strengthWeight: number;
}

const TIER_WEIGHTS: Record<MemoryRecord['tier'], number> = {
  long: 1.15,
  medium: 1.0,
  short: 0.85
};

const RRF_K = 60;

export function fuseResults(streams: RankedCandidate[][]): FusedResult[] {
  const byMemoryId = new Map<string, RankedCandidate & { rrfScore: number }>();

  for (const stream of streams) {
    for (const ranked of stream) {
      const id = ranked.candidate.memory.id;
      const rrfContribution = 1 / (RRF_K + ranked.rank);
      const existing = byMemoryId.get(id);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.candidate.sources.add(ranked.source);
      } else {
        byMemoryId.set(id, { ...ranked, rrfScore: rrfContribution });
      }
    }
  }

  const results: FusedResult[] = [];
  for (const entry of byMemoryId.values()) {
    const tierWeight = TIER_WEIGHTS[entry.candidate.memory.tier] ?? 1.0;
    const strengthWeight = 0.5 + Math.max(0, Math.min(1, entry.candidate.memory.strength));
    const finalScore = entry.rrfScore * tierWeight * strengthWeight;
    results.push({
      candidate: entry.candidate,
      finalScore,
      rrfScore: entry.rrfScore,
      tierWeight,
      strengthWeight
    });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);
  return results;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/retrieval/fusion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 3: Search Engine (orchestrator)

**Files:**
- Create: `src/retrieval/search-engine.ts`
- Create: `tests/retrieval/search-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/retrieval/search-engine.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { searchMemories } from '../../src/retrieval/search-engine.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-search-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('searchMemories', () => {
  it('returns top-K fused results from BM25 layer', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'decision', title: 'Use SQLite',
      content: 'MemWeave uses SQLite for v1 storage.', summary: 'Use SQLite.',
      concepts: ['sqlite'], files: [], importance: 8, confidence: 0.9, source: 'user_explicit',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await searchMemories(db, 'tenant_default', { query: 'SQLite', limit: 5 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.title).toContain('SQLite');
  });

  it('respects scope filter', async () => {
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Memory project fact',
      content: 'about memory project', summary: 'memory fact',
      concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    repo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'Harmony project fact',
      content: 'about harmony project', summary: 'harmony fact',
      concepts: [], files: [], importance: 5, confidence: 0.5, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'harmony' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const result = await searchMemories(db, 'tenant_default', { query: 'fact', limit: 5, scope: { project: 'memory' } });
    expect(result.results.every(r => r.memory.scopes.some(s => s.key === 'project' && s.value === 'memory'))).toBe(true);
  });

  it('returns empty result for empty query', async () => {
    const result = await searchMemories(db, 'tenant_default', { query: '', limit: 5 });
    expect(result.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/retrieval/search-engine.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement search engine**

Create `src/retrieval/search-engine.ts`:

```typescript
import type { Db } from '../db/database.js';
import type { MemoryRecord, ScopeTag } from '../core/types.js';
import { bm25Search, type SearchResultRow } from './bm25-search.js';
import { fuseResults, type FusedResult, type SearchSource, type RankedCandidate } from './fusion.js';

export interface SearchOptions {
  query: string;
  limit?: number;
  scope?: Partial<Record<ScopeTag['key'], string>>;
  types?: MemoryRecord['type'][];
}

export interface SearchResponse {
  query: string;
  results: FusedResult[];
  totalCandidates: number;
}

export async function searchMemories(db: Db, tenantId: string, options: SearchOptions): Promise<SearchResponse> {
  const limit = options.limit ?? 8;
  const query = options.query.trim();
  if (!query) return { query, results: [], totalCandidates: 0 };

  // Layer 1: BM25 (FTS5)
  const bm25Limit = Math.max(limit * 3, 30);
  const bm25Rows = bm25Search(db, tenantId, query, bm25Limit);

  // Apply scope filter in memory (FTS5 doesn't do native scope filtering)
  let filtered = bm25Rows;
  if (options.scope) {
    filtered = bm25Rows.filter(r => matchesScope(r.memory, options.scope!));
  }
  if (options.types) {
    filtered = filtered.filter(r => options.types!.includes(r.memory.type));
  }

  // Build RankedCandidate stream from BM25
  const streams: RankedCandidate[][] = filtered.length > 0 ? [
    filtered.map((r, idx) => ({
      candidate: { memory: r.memory, sources: new Set<SearchSource>(['bm25']) },
      rank: idx,
      source: 'bm25' as const
    }))
  ] : [];

  // Note: vector/graph/causal layers are deferred to v1.1 (sqlite-vec runtime + edge discovery)
  // v1 uses BM25-only fusion; the architecture supports adding more streams later.

  const fused = fuseResults(streams);

  return {
    query,
    results: fused.slice(0, limit),
    totalCandidates: filtered.length
  };
}

function matchesScope(memory: MemoryRecord, scope: Partial<Record<ScopeTag['key'], string>>): boolean {
  for (const [key, value] of Object.entries(scope)) {
    if (!value) continue;
    const found = memory.scopes.some(s => s.key === key && s.value === value);
    if (!found) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/retrieval/search-engine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 4: Injection Bundler (stable pack + delta pack + content hash)

**Files:**
- Create: `src/injection/bundler.ts`
- Create: `tests/injection/bundler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/injection/bundler.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createContentHash, buildStablePack, buildDeltaPack, type InjectionBundle } from '../../src/injection/bundler.js';

describe('createContentHash', () => {
  it('produces stable hash for same content', () => {
    const a = createContentHash('memory-pack', ['m1', 'm2', 'm3']);
    const b = createContentHash('memory-pack', ['m3', 'm2', 'm1']);
    expect(a).toBe(b);
  });

  it('differs when memoryIds differ', () => {
    const a = createContentHash('pack', ['m1']);
    const b = createContentHash('pack', ['m2']);
    expect(a).not.toBe(b);
  });

  it('differs when phase differs', () => {
    const a = createContentHash('session_start', ['m1']);
    const b = createContentHash('prompt_delta', ['m1']);
    expect(a).not.toBe(b);
  });
});

describe('buildStablePack', () => {
  it('builds stable pack from high-strength memories', () => {
    const memories = [
      { id: 'm1', tier: 'long' as const, strength: 0.9, importance: 9, title: 'A', summary: 'a', type: 'fact' as const },
      { id: 'm2', tier: 'medium' as const, strength: 0.5, importance: 5, title: 'B', summary: 'b', type: 'fact' as const },
      { id: 'm3', tier: 'short' as const, strength: 0.1, importance: 1, title: 'C', summary: 'c', type: 'event' as const }
    ];
    const pack = buildStablePack(memories, { budget: 1500 });
    expect(pack.memoryIds).toContain('m1');
    expect(pack.memoryIds).not.toContain('m3');
  });
});

describe('buildDeltaPack', () => {
  it('excludes already-injected memoryIds', () => {
    const candidates = [
      { id: 'm1', tier: 'medium' as const, strength: 0.5, importance: 5, title: 'A', summary: 'a', type: 'fact' as const },
      { id: 'm2', tier: 'medium' as const, strength: 0.6, importance: 6, title: 'B', summary: 'b', type: 'fact' as const }
    ];
    const pack = buildDeltaPack(candidates, { alreadyInjected: new Set(['m1']), budget: 1500 });
    expect(pack.memoryIds).toEqual(['m2']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/injection/bundler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement bundler**

Create `src/injection/bundler.ts`:

```typescript
import { createHash } from 'node:crypto';

export type MemoryLite = {
  id: string;
  tier: 'short' | 'medium' | 'long';
  strength: number;
  importance: number;
  title: string;
  summary: string;
  type: string;
};

export type InjectionPhase = 'session_start' | 'prompt_delta' | 'file_pack' | 'failure_delta';

export interface InjectionBundle {
  id: string;
  phase: InjectionPhase;
  sessionId: string;
  tenantId: string;
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
  createdAt: number;
}

export function createContentHash(phase: InjectionPhase, memoryIds: string[]): string {
  const sorted = [...memoryIds].sort();
  const input = `${phase}:${sorted.join(',')}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export interface PackOptions {
  budget: number;
}

export interface BuildResult {
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
}

export function buildStablePack(memories: MemoryLite[], options: PackOptions): BuildResult {
  const filtered = memories.filter(m => m.tier === 'long' || (m.tier === 'medium' && m.strength >= 0.4));
  const sorted = [...filtered].sort((a, b) => {
    if (a.tier === 'long' && b.tier !== 'long') return -1;
    if (a.tier !== 'long' && b.tier === 'long') return 1;
    return b.strength * b.importance - a.strength * a.importance;
  });
  return finalizePack(sorted, options);
}

export interface DeltaOptions extends PackOptions {
  alreadyInjected: Set<string>;
}

export function buildDeltaPack(candidates: MemoryLite[], options: DeltaOptions): BuildResult {
  const filtered = candidates.filter(c => !options.alreadyInjected.has(c.id));
  const sorted = [...filtered].sort((a, b) => b.strength * b.importance - a.strength * a.importance);
  return finalizePack(sorted, options);
}

function finalizePack(memories: MemoryLite[], options: PackOptions): BuildResult {
  const selected: MemoryLite[] = [];
  let tokens = 0;
  for (const m of memories) {
    const cost = Math.max(20, Math.ceil((m.title.length + m.summary.length) / 3));
    if (tokens + cost > options.budget) break;
    selected.push(m);
    tokens += cost;
  }
  const memoryIds = selected.map(m => m.id);
  return {
    memoryIds,
    contentHash: createContentHash('session_start', memoryIds),
    estimatedTokens: tokens
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/injection/bundler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 5: Injection Formatter (XML rendering)

**Files:**
- Create: `src/injection/formatter.ts`
- Create: `tests/injection/formatter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/injection/formatter.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatMemoriesAsXml, type MemoryForFormat } from '../../src/injection/formatter.js';

describe('formatMemoriesAsXml', () => {
  it('renders memories as XML with phase header', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Use SQLite', summary: 'Use SQLite.' }
    ];
    const xml = formatMemoriesAsXml('session_start', memories);
    expect(xml).toContain('<memory-context');
    expect(xml).toContain('phase="session_start"');
    expect(xml).toContain('Use SQLite');
  });

  it('sorts memories by tier (long first) then strength', () => {
    const memories: MemoryForFormat[] = [
      { id: 's1', type: 'event', tier: 'short', strength: 0.1, importance: 1, title: 'Short', summary: 's' },
      { id: 'l1', type: 'decision', tier: 'long', strength: 0.9, importance: 9, title: 'Long', summary: 'l' }
    ];
    const xml = formatMemoriesAsXml('prompt_delta', memories);
    const longIdx = xml.indexOf('Long');
    const shortIdx = xml.indexOf('Short');
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it('escapes XML special characters in title', () => {
    const memories: MemoryForFormat[] = [
      { id: 'm1', type: 'fact', tier: 'long', strength: 0.5, importance: 5, title: 'A & B <c>', summary: 'safe' }
    ];
    const xml = formatMemoriesAsXml('session_start', memories);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/injection/formatter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement formatter**

Create `src/injection/formatter.ts`:

```typescript
import type { MemoryRecord } from '../core/types.js';

export type MemoryForFormat = Pick<MemoryRecord, 'id' | 'type' | 'tier' | 'strength' | 'importance' | 'title' | 'summary'>;

export function formatMemoriesAsXml(phase: string, memories: MemoryForFormat[]): string {
  const sorted = [...memories].sort((a, b) => {
    const tierOrder = { long: 0, medium: 1, short: 2 };
    const aOrder = tierOrder[a.tier] ?? 2;
    const bOrder = tierOrder[b.tier] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.strength * b.importance - a.strength * a.importance;
  });

  const header = `<memory-context phase="${escapeAttr(phase)}" count="${sorted.length}">`;
  const items = sorted.map(m =>
    `  <memory id="${escapeAttr(m.id)}" type="${escapeAttr(m.type)}" tier="${escapeAttr(m.tier)}" strength="${m.strength.toFixed(2)}" importance="${m.importance}">\n` +
    `    <title>${escapeText(m.title)}</title>\n` +
    `    <summary>${escapeText(m.summary)}</summary>\n` +
    `  </memory>`
  );
  const footer = `</memory-context>`;
  return [header, ...items, footer].join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- tests/injection/formatter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 6: Injection REST Endpoint

**Files:**
- Create: `src/rest/routes/injection.ts`
- Create: `tests/rest/injection.test.ts`
- Modify: `src/server/http.ts` (register injection route)

- [ ] **Step 1: Write failing tests**

Create `tests/rest/injection.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../../src/server/http.js';

let app: FastifyInstance;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-inject-'));
  app = await createHttpServer({ dbPath: join(dir, 'test.db') });
});

afterEach(async () => app.close());

describe('POST /api/v1/inject', () => {
  it('returns 200 with stable pack for session_start', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'session_start' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { bundleId: string; contentHash: string; memoryIds: string[] };
    expect(body.bundleId).toBeTypeOf('string');
    expect(body.contentHash).toBeTypeOf('string');
  });

  it('returns 200 with delta pack for prompt_delta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'prompt_delta', query: 'SQLite design' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for invalid phase', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { sessionId: 's1', phase: 'invalid_phase' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing sessionId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inject',
      payload: { phase: 'session_start' }
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/rest/injection.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement injection route**

Create `src/rest/routes/injection.ts`:

```typescript
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../db/database.js';
import { searchMemories } from '../../retrieval/search-engine.js';
import { buildStablePack, buildDeltaPack, createContentHash, type InjectionBundle, type MemoryLite } from '../../injection/bundler.js';
import { formatMemoriesAsXml, type MemoryForFormat } from '../../injection/formatter.js';

const TENANT_DEFAULT = 'tenant_default';

const InjectRequestSchema = z.object({
  sessionId: z.string().min(1),
  phase: z.enum(['session_start', 'prompt_delta', 'file_pack', 'failure_delta']),
  query: z.string().optional(),
  files: z.array(z.string()).optional(),
  alreadyInjected: z.array(z.string()).optional()
});

export interface InjectRequest {
  sessionId: string;
  phase: 'session_start' | 'prompt_delta' | 'file_pack' | 'failure_delta';
  query?: string;
  files?: string[];
  alreadyInjected?: string[];
}

export interface InjectResponse {
  bundleId: string;
  phase: string;
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
  contextXml: string;
}

export function registerInjectionRoute(app: FastifyInstance, dbPath: string): void {
  app.post('/api/v1/inject', async (request, reply) => {
    const input = InjectRequestSchema.parse(request.body);
    const db = openDatabase(dbPath);

    try {
      const alreadyInjected = new Set(input.alreadyInjected ?? []);
      let result: { memoryIds: string[]; contentHash: string; estimatedTokens: number };
      let contextMemories: MemoryForFormat[] = [];

      if (input.phase === 'session_start') {
        // Stable pack: top long/medium memories
        const stableRows = db.prepare(`
          SELECT id, type, tier, title, summary, strength, importance
          FROM memories
          WHERE tenant_id = ? AND deleted_at IS NULL
            AND (tier = 'long' OR (tier = 'medium' AND strength >= 0.4))
            AND access_count >= 1
          ORDER BY tier ASC, strength * importance DESC
          LIMIT 50
        `).all(TENANT_DEFAULT) as Array<MemoryLite>;

        result = buildStablePack(stableRows, { budget: 1200 });
        contextMemories = stableRows.filter(m => result.memoryIds.includes(m.id));
      } else {
        // Delta pack: search for relevant memories
        if (!input.query && (!input.files || input.files.length === 0)) {
          // Nothing to search for, return empty bundle
          result = { memoryIds: [], contentHash: createContentHash(input.phase, []), estimatedTokens: 0 };
        } else {
          const search = await searchMemories(db, TENANT_DEFAULT, {
            query: input.query ?? input.files?.join(' ') ?? '',
            limit: 10
          });
          const candidates: MemoryLite[] = search.results.map(r => ({
            id: r.candidate.memory.id,
            type: r.candidate.memory.type,
            tier: r.candidate.memory.tier,
            title: r.candidate.memory.title,
            summary: r.candidate.memory.summary,
            strength: r.candidate.memory.strength,
            importance: r.candidate.memory.importance
          }));
          result = buildDeltaPack(candidates, { alreadyInjected, budget: 800 });
          contextMemories = candidates.filter(m => result.memoryIds.includes(m.id));
        }
      }

      const contextXml = formatMemoriesAsXml(input.phase, contextMemories);
      const bundleId = `${input.sessionId}:${input.phase}:${result.contentHash}`;

      const body: InjectResponse = {
        bundleId,
        phase: input.phase,
        memoryIds: result.memoryIds,
        contentHash: result.contentHash,
        estimatedTokens: result.estimatedTokens,
        contextXml
      };
      return reply.code(200).send(body);
    } finally {
      db.close();
    }
  });
}
```

- [ ] **Step 4: Register the route in http.ts**

Modify `src/server/http.ts` to import and call `registerInjectionRoute`:

```typescript
// Add to imports at top:
import { registerInjectionRoute } from '../rest/routes/injection.js';

// Add inside createHttpServer, after addHook('onClose', ...):
registerInjectionRoute(app, options.dbPath);
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- tests/rest/injection.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

---

## Task 7: Final Verification

**Files:**
- Verify all files above.

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: PASS. All test files:
- `tests/retrieval/bm25-search.test.ts` (3)
- `tests/retrieval/fusion.test.ts` (4)
- `tests/retrieval/search-engine.test.ts` (3)
- `tests/injection/bundler.test.ts` (5)
- `tests/injection/formatter.test.ts` (3)
- `tests/rest/injection.test.ts` (4)
Plus all prior tests from earlier plans.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test injection endpoint**

```bash
npm run dev
```

In another terminal:

```bash
curl -X POST http://127.0.0.1:3131/api/v1/inject \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "phase": "session_start"}'
```

Expected: `200 OK` with bundleId, contentHash, memoryIds, contextXml.

Stop server with Ctrl+C.

---

## Self-Review Checklist

Spec coverage:

- [x] BM25 keyword search via FTS5
- [x] RRF fusion with tier/strength weighting
- [x] Search engine orchestrator with scope filter
- [x] Injection bundler with stable pack + delta pack + deterministic content hash
- [x] XML formatter with escape + tier sort
- [x] `POST /api/v1/inject` REST endpoint with 4 phases

Deferred to v1.1:

- Vector search (sqlite-vec runtime integration)
- Graph traversal
- Causal chain detection

Placeholder scan: no `TBD`, `TODO`, `fill in details`, or undefined function names.
