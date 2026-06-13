import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../src/db/repositories/edge-repo.js';

let db: Db;
let memoryRepo: MemoryRepo;
let edgeRepo: EdgeRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-edge-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memoryRepo = new MemoryRepo(db);
  edgeRepo = new EdgeRepo(db);
});

afterEach(() => db.close());

describe('EdgeRepo', () => {
  it('creates and reads an edge between two memories', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'decision', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'user_explicit',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'decision', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'user_explicit',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    const edge = edgeRepo.create({
      tenantId: 'tenant_default',
      fromMemoryId: m1.id,
      toMemoryId: m2.id,
      type: 'causes',
      strength: 0.9,
      reason: 'A causes B'
    });

    expect(edge.id).toBeTypeOf('string');
    expect(edge.fromMemoryId).toBe(m1.id);
    expect(edge.toMemoryId).toBe(m2.id);
    expect(edge.type).toBe('causes');
  });

  it('returns outgoing edges for a memory', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m3 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'C', content: 'C', summary: 'C',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m2.id, type: 'causes', strength: 0.9, reason: 'r1' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m3.id, type: 'enables', strength: 0.8, reason: 'r2' });

    const out = edgeRepo.getOutgoing('tenant_default', m1.id);
    expect(out.length).toBe(2);
    expect(out.map((e) => e.toMemoryId).sort()).toEqual([m2.id, m3.id].sort());
  });

  it('returns incoming edges for a memory', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m2.id, type: 'causes', strength: 0.9, reason: 'r1' });

    const incoming = edgeRepo.getIncoming('tenant_default', m2.id);
    expect(incoming.length).toBe(1);
    expect(incoming[0].fromMemoryId).toBe(m1.id);
  });

  it('returns neighbors both directions', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m3 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'C', content: 'C', summary: 'C',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m2.id, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m3.id, toMemoryId: m1.id, type: 'enables', strength: 0.8, reason: 'r' });

    const neighbors = edgeRepo.getNeighbors('tenant_default', m1.id, 'both');
    expect(neighbors.length).toBe(2);
    const ids = neighbors.map((n) => n.neighborId).sort();
    expect(ids).toEqual([m2.id, m3.id].sort());
  });

  it('filters neighbors by edge type', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m3 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'C', content: 'C', summary: 'C',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m2.id, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m3.id, type: 'related_to', strength: 0.8, reason: 'r' });

    const onlyCauses = edgeRepo.getNeighbors('tenant_default', m1.id, 'out', ['causes']);
    expect(onlyCauses.length).toBe(1);
    expect(onlyCauses[0].type).toBe('causes');
  });

  it('deletes an edge by id', () => {
    const m1 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'A', content: 'A', summary: 'A',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const m2 = memoryRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'B', content: 'B', summary: 'B',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });

    const edge = edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: m1.id, toMemoryId: m2.id, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.delete(edge.id);
    const out = edgeRepo.getOutgoing('tenant_default', m1.id);
    expect(out.length).toBe(0);
  });
});
