import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../packages/server/src/db/repositories/edge-repo.js';
import { detectCausalChains } from '../../packages/server/src/retrieval/causal-chain.js';

let db: Db;
let memRepo: MemoryRepo;
let edgeRepo: EdgeRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-causal-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memRepo = new MemoryRepo(db);
  edgeRepo = new EdgeRepo(db);
});

afterEach(() => db.close());

function makeMemory(title: string): string {
  const m = memRepo.create({
    tenantId: 'tenant_default', type: 'event', title, content: title, summary: title,
    concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
  return m.id;
}

describe('detectCausalChains', () => {
  it('returns empty when no edges', () => {
    const a = makeMemory('A');
    const chains = detectCausalChains(db, { seedMemoryIds: [a], tenantId: 'tenant_default' });
    expect(chains).toEqual([]);
  });

  it('extracts a 2-step chain', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });

    const chains = detectCausalChains(db, { seedMemoryIds: [a], tenantId: 'tenant_default', maxLength: 3 });
    expect(chains.length).toBeGreaterThanOrEqual(1);
    const chain = chains[0];
    expect(chain.memoryIds).toContain(a);
    expect(chain.memoryIds).toContain(b);
    expect(chain.memories).toHaveLength(2);
    expect(chain.chainScore).toBeGreaterThan(0);
  });

  it('ranks stronger causal edges higher than temporal ones', () => {
    const root = makeMemory('root');
    const strong = makeMemory('strong');
    const weak = makeMemory('weak');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: root, toMemoryId: strong, type: 'causes', strength: 0.95, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: root, toMemoryId: weak, type: 'after', strength: 0.95, reason: 'r' });

    const chains = detectCausalChains(db, { seedMemoryIds: [root], tenantId: 'tenant_default' });
    const strongChain = chains.find((c) => c.memoryIds.includes(strong));
    const weakChain = chains.find((c) => c.memoryIds.includes(weak));
    expect(strongChain).toBeDefined();
    expect(weakChain).toBeDefined();
    // The "causes" edge has higher completeness than the "after" edge.
    expect(strongChain!.chainScore).toBeGreaterThan(weakChain!.chainScore);
  });

  it('extends a chain past one hop', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    const c = makeMemory('C');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: c, type: 'causes', strength: 0.85, reason: 'r' });

    const chains = detectCausalChains(db, { seedMemoryIds: [a], tenantId: 'tenant_default', maxLength: 5 });
    const longChain = chains.find((cand) => cand.memoryIds.length === 3);
    expect(longChain).toBeDefined();
    expect(longChain?.memoryIds).toEqual([a, b, c]);
  });

  it('respects maxChains', () => {
    const root = makeMemory('root');
    for (let i = 0; i < 5; i++) {
      const child = makeMemory(`c${i}`);
      edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: root, toMemoryId: child, type: 'causes', strength: 0.5 + i * 0.1, reason: 'r' });
    }
    const chains = detectCausalChains(db, { seedMemoryIds: [root], tenantId: 'tenant_default', maxChains: 2 });
    expect(chains.length).toBeLessThanOrEqual(2);
  });

  it('walks in the incoming direction when bidirectional', () => {
    const cause = makeMemory('cause');
    const effect = makeMemory('effect');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: cause, toMemoryId: effect, type: 'causes', strength: 0.9, reason: 'r' });

    // Seed from the effect; should walk backward to find the cause.
    const chains = detectCausalChains(db, { seedMemoryIds: [effect], tenantId: 'tenant_default', maxLength: 3 });
    expect(chains.length).toBeGreaterThanOrEqual(1);
    expect(chains[0].memoryIds).toContain(cause);
    expect(chains[0].memoryIds).toContain(effect);
  });

  it('does not loop on cycles', () => {
    const a = makeMemory('A');
    const b = makeMemory('B');
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: a, toMemoryId: b, type: 'causes', strength: 0.9, reason: 'r' });
    edgeRepo.create({ tenantId: 'tenant_default', fromMemoryId: b, toMemoryId: a, type: 'causes', strength: 0.9, reason: 'r' });

    const chains = detectCausalChains(db, { seedMemoryIds: [a], tenantId: 'tenant_default', maxLength: 5 });
    // Each chain should never repeat a node
    for (const c of chains) {
      const set = new Set(c.memoryIds);
      expect(set.size).toBe(c.memoryIds.length);
    }
  });
});
