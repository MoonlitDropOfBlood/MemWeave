import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../packages/server/src/db/repositories/edge-repo.js';
import { SessionRepo } from '../../packages/server/src/db/repositories/session-repo.js';
import { StatsRepo, type ProjectCount } from '../../packages/server/src/db/repositories/stats-repo.js';

let db: Db;
let memRepo: MemoryRepo;
let edgeRepo: EdgeRepo;
let sessionRepo: SessionRepo;
let stats: StatsRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-stats-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memRepo = new MemoryRepo(db);
  edgeRepo = new EdgeRepo(db);
  sessionRepo = new SessionRepo(db);
  stats = new StatsRepo(db);
});

afterEach(() => db.close());

function makeMemory(title: string, type: 'fact' | 'decision' | 'bug' = 'fact', tier?: 'short' | 'medium' | 'long'): string {
  const importance = tier === 'long' ? 10 : tier === 'medium' ? 7 : 5;
  const m = memRepo.create({
    tenantId: 'tenant_default', type, title, content: title, summary: title,
    concepts: title === 'special' ? ['x'] : [], files: [], importance, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: title === 'special' ? [{ key: 'project', value: 'demo' }] : [],
    sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
  return m.id;
}

describe('StatsRepo.getStats', () => {
  it('returns zeroed stats when empty', () => {
    const s = stats.getStats('tenant_default');
    expect(s.totals.memories).toBe(0);
    expect(s.totals.activeMemories).toBe(0);
    expect(s.totals.sessions).toBe(0);
    expect(s.totals.observations).toBe(0);
    expect(s.totals.edges).toBe(0);
    expect(s.byTier.short).toBe(0);
    expect(s.byTier.medium).toBe(0);
    expect(s.byTier.long).toBe(0);
  });

  it('counts memories by tier correctly', () => {
    makeMemory('A');           // importance 5 → short
    makeMemory('B', 'fact', 'medium');  // importance 7 → medium
    makeMemory('C', 'fact', 'long');    // importance 10 → long
    const s = stats.getStats('tenant_default');
    expect(s.totals.memories).toBe(3);
    expect(s.byTier.short).toBe(1);
    expect(s.byTier.medium).toBe(1);
    expect(s.byTier.long).toBe(1);
  });

  it('counts memories by type', () => {
    makeMemory('A', 'fact');
    makeMemory('B', 'fact');
    makeMemory('C', 'decision');
    const s = stats.getStats('tenant_default');
    expect(s.byType.fact).toBe(2);
    expect(s.byType.decision).toBe(1);
    expect(s.byType.bug).toBe(0);
  });

  it('separates active vs deleted memories', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    db.prepare('UPDATE memories SET deleted_at = ?, eviction_reason = ? WHERE id = ?')
      .run(Date.now(), 'test', a);
    const s = stats.getStats('tenant_default');
    expect(s.totals.memories).toBe(2);
    expect(s.totals.activeMemories).toBe(1);
    void b;
  });

  it('counts edges', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'enables', strength: 0.8, reason: 'r' });
    const s = stats.getStats('tenant_default');
    expect(s.totals.edges).toBe(2);
  });

  it('counts sessions and observations', () => {
    sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'S1', project: null });
    sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'S2', project: null });
    const sessionId = (db.prepare('SELECT id FROM sessions LIMIT 1').get() as { id: string }).id;
    db.prepare(`INSERT INTO observations (id, session_id, tenant_id, hook_type, tool_name, tool_input, tool_output, timestamp, memory_id, processed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`)
      .run('o1', sessionId, 'tenant_default', 'post_tool_use', 'Read', null, null, Date.now());

    const s = stats.getStats('tenant_default');
    expect(s.totals.sessions).toBe(2);
    expect(s.totals.observations).toBe(1);
  });

  it('counts todayNewMemories based on createdAt', () => {
    makeMemory('A');
    // No time travel needed — these are all today
    const s = stats.getStats('tenant_default');
    expect(s.today.newMemories).toBe(1);
  });

  it('returns recentProjects based on scope tags', () => {
    makeMemory('A');  // no scope
    makeMemory('B');  // no scope
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'C', content: 'C', summary: 'C',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [{ key: 'project', value: 'memweave' }],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const s = stats.getStats('tenant_default');
    expect(s.recentProjects.length).toBeGreaterThan(0);
    const memweave = s.recentProjects.find((p: ProjectCount) => p.project === 'memweave');
    expect(memweave).toBeDefined();
    expect(memweave!.count).toBe(1);
  });
});
