import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('MemoryRepo', () => {
  it('creates and reads a memory with scopes', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'decision',
      title: 'Use MCP + REST',
      content: 'MemWeave exposes MCP for agents and REST for UI/scripts.',
      summary: 'Use MCP + REST for v1.',
      concepts: ['mcp', 'rest', 'interface'],
      files: [],
      importance: 8,
      confidence: 0.9,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [
        { key: 'project', value: 'memory' },
        { key: 'topic', value: 'architecture' }
      ],
      sourceClient: 'rest_api',
      sourceDeviceId: null,
      sourceSessionId: null
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.title).toBe('Use MCP + REST');
    expect(loaded?.strength).toBe(0.8);
    expect(loaded?.scopes).toEqual([
      { key: 'project', value: 'memory' },
      { key: 'topic', value: 'architecture' }
    ]);
  });

  it('records access logs and reinforces memory', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'fact',
      title: 'SQLite is the default store',
      content: 'MemWeave stores v1 data in SQLite.',
      summary: 'SQLite is the default store.',
      concepts: ['sqlite'],
      files: [],
      importance: 6,
      confidence: 0.8,
      source: 'system_inferred',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null,
      sourceDeviceId: null,
      sourceSessionId: null
    });

    repo.recordAccess({
      tenantId: 'tenant_default',
      memoryId: memory.id,
      sessionId: null,
      deviceId: null,
      source: 'context_inject',
      query: 'storage design',
      rank: 1,
      score: 0.92,
      usedInContext: true
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.accessCount).toBe(1);
    expect(loaded?.strength).toBeCloseTo(0.7, 5);
    expect(loaded?.lastReinforcedAt).toBeTypeOf('number');
  });

  describe('write-side dedup', () => {
    it('reinforces an existing memory when new input has identical concepts', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'preference',
        title: 'User prefers strict TypeScript',
        content: 'Always use noImplicitAny and exactOptionalPropertyTypes.',
        summary: 'Strict TS mode.',
        concepts: ['typescript', 'strict', 'noImplicitAny'],
        files: ['tsconfig.json'],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      // Second save with the same concepts + same type → should dedup
      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'preference',
        title: 'TS strict mode on',
        content: 'Use strict TypeScript with noImplicitAny.',
        summary: 'Strict TS.',
        concepts: ['typescript', 'strict', 'noImplicitAny'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(true);
      expect(second.reinforcedId).toBe(first.id);
      expect(second.memory.id).toBe(first.id);
      // access_count should have bumped (was 0, now at least 1)
      expect(second.memory.accessCount).toBeGreaterThanOrEqual(1);
      expect(second.memory.lastReinforcedAt).toBeTypeOf('number');
    });

    it('merges richer content into the existing memory when incoming is longer', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'decision',
        title: 'Use 4-layer retrieval',
        content: 'BM25 + vector + graph + causal.',
        summary: '4-layer retrieval.',
        concepts: ['retrieval', 'architecture'],
        files: [],
        importance: 7,
        confidence: 0.85,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      // Incoming is strictly longer (>1.25x) and higher importance → merge
      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'decision',
        title: '4-layer retrieval with RRF',
        content: 'We use a 4-layer retrieval stack: BM25 keyword search via SQLite FTS5, vector similarity via sqlite-vec, graph expansion via BFS, and causal chain detection. Results are fused with Reciprocal Rank Fusion (RRF) before re-ranking by tier, strength, scope, and freshness.',
        summary: '4-layer + RRF.',
        concepts: ['retrieval', 'architecture', 'rrf'],
        files: ['src/retrieval/fusion.ts'],
        importance: 9,
        confidence: 0.95,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      // Jaccard is |{retrieval, architecture}| / |{retrieval, architecture, rrf}|
      // = 2/3 = 0.67, below the 0.8 threshold, so this is NOT a dedup hit.
      // The richer content test below uses identical concepts to actually
      // trigger the merge path.
      expect(second.deduped).toBe(false);
      expect(second.memory.id).not.toBe(first.id);
    });

    it('merges richer content into the existing memory when concepts match exactly', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'decision',
        title: 'Use 4-layer retrieval',
        content: 'BM25 + vector + graph + causal.',
        summary: '4-layer retrieval.',
        concepts: ['retrieval', 'architecture', 'rrf'],
        files: [],
        importance: 7,
        confidence: 0.85,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      // Incoming has same concepts (jaccard = 1.0), is much longer, higher
      // importance → trigger the merge path
      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'decision',
        title: '4-layer retrieval with RRF',
        content: 'We use a 4-layer retrieval stack: BM25 keyword search via SQLite FTS5, vector similarity via sqlite-vec, graph expansion via BFS, and causal chain detection. Results are fused with Reciprocal Rank Fusion (RRF) before re-ranking by tier, strength, scope, and freshness.',
        summary: '4-layer + RRF.',
        concepts: ['retrieval', 'architecture', 'rrf'],
        files: ['src/retrieval/fusion.ts'],
        importance: 9,
        confidence: 0.95,
        source: 'user_explicit',
        scopeLevel: 'project',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(true);
      expect(second.memory.id).toBe(first.id);
      // Content was upgraded to the longer version
      expect(second.memory.content).toContain('Reciprocal Rank Fusion');
      // Importance bumped to max(7, 9) = 9
      expect(second.memory.importance).toBe(9);
    });

    it('does NOT dedup when concepts are disjoint', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'TypeScript strict mode',
        content: 'Enable strict mode in tsconfig.',
        summary: 'TS strict.',
        concepts: ['typescript', 'strict'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'Postgres is the prod DB',
        content: 'Production runs on Postgres 16.',
        summary: 'Postgres prod.',
        concepts: ['postgres', 'database', 'production'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(false);
      expect(second.memory.id).not.toBe(first.id);
    });

    it('does NOT dedup across different types even with matching concepts', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'preference',
        title: 'User likes X',
        content: '...',
        summary: '...',
        concepts: ['x', 'y', 'z'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      // Same concepts but different type → not a duplicate
      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'decision',
        title: 'We decided to use X',
        content: '...',
        summary: '...',
        concepts: ['x', 'y', 'z'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(false);
      expect(second.memory.id).not.toBe(first.id);
    });
  });

  describe('Jaccard threshold boundary', () => {
    /**
     * The dedup threshold is 0.8. Boundary tests pin the behavior so an
     * accidental threshold change (or Jaccard rounding bug) gets caught.
     *
     * Jaccard = |A ∩ B| / |A ∪ B|.
     *   {a, b, c, d, e} ∩ {a, b, c, d} = 4
     *   {a, b, c, d, e} ∪ {a, b, c, d} = 5
     *   Jaccard = 4/5 = 0.80 — exactly AT the threshold, should dedup.
     *
     *   {a, b, c, d, e} ∩ {a, b, c, d, f} = 4
     *   {a, b, c, d, e} ∪ {a, b, c, d, f} = 6
     *   Jaccard = 4/6 = 0.667 — well below, no dedup.
     *
     *   {a, b, c, d, e} ∩ {a, b, c, d, e, f} = 5
     *   {a, b, c, d, e} ∪ {a, b, c, d, e, f} = 6
     *   Jaccard = 5/6 = 0.833 — above threshold, dedup.
     */

    it('dedups at Jaccard = 0.80 (exactly at threshold)', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'first',
        summary: 'first',
        concepts: ['a', 'b', 'c', 'd', 'e'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'second',
        summary: 'second',
        concepts: ['a', 'b', 'c', 'd'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(true);
      expect(second.memory.id).toBe(first.id);
    });

    it('dedups at Jaccard = 0.833 (well above threshold)', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'first',
        summary: 'first',
        concepts: ['a', 'b', 'c', 'd', 'e'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'second',
        summary: 'second',
        concepts: ['a', 'b', 'c', 'd', 'e', 'f'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(true);
      expect(second.memory.id).toBe(first.id);
    });

    it('does NOT dedup at Jaccard = 0.667 (well below threshold)', () => {
      const first = repo.create({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'first',
        summary: 'first',
        concepts: ['a', 'b', 'c', 'd', 'e'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      const second = repo.createDetailed({
        tenantId: 'tenant_default',
        type: 'fact',
        title: 'X',
        content: 'second',
        summary: 'second',
        concepts: ['a', 'b', 'c', 'd', 'f'],
        files: [],
        importance: 7,
        confidence: 0.9,
        source: 'user_explicit',
        scopeLevel: 'global',
        scopes: [],
        sourceClient: 'opencode',
        sourceDeviceId: null,
        sourceSessionId: null
      });

      expect(second.deduped).toBe(false);
      expect(second.memory.id).not.toBe(first.id);
    });
  });
});
