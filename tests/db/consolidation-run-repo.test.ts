import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { ConsolidationRunRepo } from '../../src/db/repositories/consolidation-run-repo.js';

let db: Db;
let repo: ConsolidationRunRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-conrun-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new ConsolidationRunRepo(db);
});

afterEach(() => db.close());

describe('ConsolidationRunRepo', () => {
  it('records a run with all fields', () => {
    const startedAt = Date.now() - 1000;
    const endedAt = Date.now();
    const id = repo.record({
      tenantId: 'tenant_default',
      startedAt,
      endedAt,
      promoted: ['m1', 'm2'],
      evicted: ['m3'],
      merged: [['m4', 'm5']],
      edgesCreated: 2,
      contradictionFound: 1,
      dryRun: false,
      summary: 'Promoted 2, evicted 1'
    });
    expect(id).toBeTypeOf('string');

    const loaded = repo.getById('tenant_default', id);
    expect(loaded).toBeDefined();
    expect(loaded!.promoted).toEqual(['m1', 'm2']);
    expect(loaded!.evicted).toEqual(['m3']);
    expect(loaded!.merged).toEqual([['m4', 'm5']]);
    expect(loaded!.edgesCreated).toBe(2);
    expect(loaded!.contradictionFound).toBe(1);
    expect(loaded!.dryRun).toBe(false);
    expect(loaded!.summary).toBe('Promoted 2, evicted 1');
  });

  it('getById returns null for unknown id', () => {
    const loaded = repo.getById('tenant_default', 'nonexistent');
    expect(loaded).toBeNull();
  });

  it('listRecent returns runs ordered by startedAt DESC', () => {
    const now = Date.now();
    repo.record({ tenantId: 'tenant_default', startedAt: now - 3000, endedAt: now - 2000, promoted: [], evicted: [], merged: [], edgesCreated: 0, contradictionFound: 0, dryRun: false, summary: 'a' });
    repo.record({ tenantId: 'tenant_default', startedAt: now - 1000, endedAt: now, promoted: [], evicted: [], merged: [], edgesCreated: 0, contradictionFound: 0, dryRun: false, summary: 'b' });

    const list = repo.listRecent('tenant_default', 10);
    expect(list.length).toBe(2);
    expect(list[0].summary).toBe('b'); // most recent first
    expect(list[1].summary).toBe('a');
  });

  it('respects limit in listRecent', () => {
    for (let i = 0; i < 5; i++) {
      repo.record({ tenantId: 'tenant_default', startedAt: Date.now() + i, endedAt: Date.now() + i, promoted: [], evicted: [], merged: [], edgesCreated: 0, contradictionFound: 0, dryRun: false, summary: `run-${i}` });
    }
    const list = repo.listRecent('tenant_default', 3);
    expect(list.length).toBe(3);
  });

  it('latestForTenant returns the most recent run', () => {
    const now = Date.now();
    repo.record({ tenantId: 'tenant_default', startedAt: now - 1000, endedAt: now, promoted: [], evicted: [], merged: [], edgesCreated: 0, contradictionFound: 0, dryRun: false, summary: 'older' });
    repo.record({ tenantId: 'tenant_default', startedAt: now, endedAt: now, promoted: [], evicted: [], merged: [], edgesCreated: 0, contradictionFound: 0, dryRun: false, summary: 'newer' });

    const latest = repo.latestForTenant('tenant_default');
    expect(latest).toBeDefined();
    expect(latest!.summary).toBe('newer');
  });

  it('latestForTenant returns null when no runs exist', () => {
    const latest = repo.latestForTenant('tenant_default');
    expect(latest).toBeNull();
  });
});
