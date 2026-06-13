import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../packages/server/src/db/repositories/edge-repo.js';
import { graphExpand } from '../../packages/server/src/retrieval/graph-traversal.js';

let db: Db;
let memRepo: MemoryRepo;
let edgeRepo: EdgeRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-graph-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memRepo = new MemoryRepo(db);
  edgeRepo = new EdgeRepo(db);
});

afterEach(() => db.close());

function makeMemory(title: string): string {
  const m = memRepo.create({
    tenantId: 'tenant_default', type: 'fact', title, content: title, summary: title,
    concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
  return m.id;
}

describe('graphExpand', () => {
  it('returns empty array when no edges exist', () => {
    const a = makeMemory('A');
    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default' });
    expect(out).toEqual([]);
  });

  it('returns direct neighbors at depth 1', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: c, type: 'enables', strength: 0.8, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1 });
    expect(out.length).toBe(2);
    expect(out.every((c) => c.distance === 1)).toBe(true);
    const ids = out.map((c) => c.memory.id).sort();
    expect(ids).toEqual([b, c].sort());
  });

  it('does not return the start memory itself', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1 });
    expect(out.every((c) => c.memory.id !== a)).toBe(true);
  });

  it('BFS at depth 2 reaches grand-children', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'enables', strength: 0.8, reason: 'r' });

    const depth1 = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1 });
    expect(depth1.length).toBe(1);
    expect(depth1[0].memory.id).toBe(b);

    const depth2 = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 2 });
    expect(depth2.length).toBe(2);
    const depth2Ids = depth2.map((cand) => cand.memory.id).sort();
    expect(depth2Ids).toEqual([b, c].sort());
    expect(depth2.find((cand) => cand.memory.id === c)?.distance).toBe(2);
    expect(depth2.find((cand) => cand.memory.id === b)?.distance).toBe(1);
  });

  it('excludes edge types not in the filter list', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: c, type: 'related_to', strength: 0.8, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1, edgeTypes: ['causes'] });
    expect(out.length).toBe(1);
    expect(out[0].memory.id).toBe(b);
  });

  it('respects direction=in (only incoming edges)', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: c, toMemoryId: a, type: 'enables', strength: 0.8, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1, direction: 'in' });
    expect(out.length).toBe(1);
    expect(out[0].memory.id).toBe(c);
  });

  it('respects direction=out (only outgoing edges)', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: c, toMemoryId: a, type: 'enables', strength: 0.8, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 1, direction: 'out' });
    expect(out.length).toBe(1);
    expect(out[0].memory.id).toBe(b);
  });

  it('does not visit the same node twice', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    // Two paths to c
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: c, type: 'enables', strength: 0.8, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'refines', strength: 0.7, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 2 });
    const cCandidates = out.filter((cand) => cand.memory.id === c);
    expect(cCandidates.length).toBe(1); // deduped
  });

  it('tracks edgePath and memoryPath', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    const e1 = edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    const e2 = edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'enables', strength: 0.5, reason: 'r' });

    const out = graphExpand(db, { startMemoryId: a, tenantId: 'tenant_default', depth: 2 });
    const cc = out.find((cand) => cand.memory.id === c);
    expect(cc).toBeDefined();
    expect(cc?.edgePath).toEqual([e1.id, e2.id]);
    expect(cc?.memoryPath).toEqual([a, b, c]);
    expect(cc?.pathStrength).toBe(0.5); // min of edges
  });
});
