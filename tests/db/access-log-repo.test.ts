import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { AccessLogRepo } from '../../src/db/repositories/access-log-repo.js';

let db: Db;
let memoryRepo: MemoryRepo;
let accessLogRepo: AccessLogRepo;
let memoryId: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-access-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  memoryRepo = new MemoryRepo(db);
  accessLogRepo = new AccessLogRepo(db);

  const mem = memoryRepo.create({
    tenantId: 'tenant_default', type: 'fact', title: 'T', content: 'C', summary: 'S',
    concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
  memoryId = mem.id;
});

afterEach(() => db.close());

describe('AccessLogRepo', () => {
  it('records an access log entry', () => {
    const id = accessLogRepo.record({
      tenantId: 'tenant_default',
      memoryId,
      sessionId: 'sess1',
      deviceId: null,
      source: 'context_inject',
      query: 'q',
      rank: 1,
      score: 0.9,
      usedInContext: true
    });
    expect(id).toBeTypeOf('string');
  });

  it('lists access logs for a memory (most recent first)', async () => {
    accessLogRepo.record({ tenantId: 'tenant_default', memoryId, sessionId: null, deviceId: null, source: 'recall', query: 'a', rank: null, score: null, usedInContext: false });
    // Tiny sleep to differentiate timestamps
    await new Promise((r) => setTimeout(r, 5));
    accessLogRepo.record({ tenantId: 'tenant_default', memoryId, sessionId: null, deviceId: null, source: 'smart_search', query: 'b', rank: null, score: null, usedInContext: true });

    const logs = accessLogRepo.listForMemory('tenant_default', memoryId, 10);
    expect(logs.length).toBe(2);
    expect(logs[0].source).toBe('smart_search');
    expect(logs[1].source).toBe('recall');
  });

  it('respects limit in listForMemory', () => {
    for (let i = 0; i < 5; i++) {
      accessLogRepo.record({ tenantId: 'tenant_default', memoryId, sessionId: null, deviceId: null, source: 'recall', query: null, rank: null, score: null, usedInContext: false });
    }
    const logs = accessLogRepo.listForMemory('tenant_default', memoryId, 3);
    expect(logs.length).toBe(3);
  });

  it('lists access logs for a tenant within time window', () => {
    accessLogRepo.record({ tenantId: 'tenant_default', memoryId, sessionId: null, deviceId: null, source: 'recall', query: null, rank: null, score: null, usedInContext: false });
    const since = Date.now() - 1000;
    const logs = accessLogRepo.listSince('tenant_default', since, 10);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('purges old access logs', async () => {
    accessLogRepo.record({ tenantId: 'tenant_default', memoryId, sessionId: null, deviceId: null, source: 'recall', query: null, rank: null, score: null, usedInContext: false });
    const purged = accessLogRepo.purgeOlderThan(Date.now() + 10000);
    expect(purged).toBeGreaterThan(0);
    const logs = accessLogRepo.listForMemory('tenant_default', memoryId, 10);
    expect(logs.length).toBe(0);
  });
});
