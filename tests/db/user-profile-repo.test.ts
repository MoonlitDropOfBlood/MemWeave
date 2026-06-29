import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { UserProfileRepo } from '../../packages/server/src/db/repositories/user-profile-repo.js';

let db: Db;
let dir: string;
let repo: UserProfileRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-profile-'));
  db = openDatabase(join(dir, 'test.db'), { skipVectorExtension: true });
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new UserProfileRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('UserProfileRepo (batch F)', () => {
  it('returns null when no profile exists', () => {
    expect(repo.get('tenant_default')).toBeNull();
  });

  it('upserts traits additively (merges, dedupes, case-insensitive)', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', traits: ['prefers TypeScript', 'backend engineer'] });
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', traits: ['prefers typescript', 'uses pnpm'] });
    const profile = repo.get('tenant_default')!;
    expect(profile.traits).toEqual(['prefers TypeScript', 'backend engineer', 'uses pnpm']);
  });

  it('replaces summary when provided, keeps old when omitted', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', summary: 'A backend dev.' });
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', traits: ['x'] });
    const profile = repo.get('tenant_default')!;
    expect(profile.summary).toBe('A backend dev.');
    expect(profile.traits).toEqual(['x']);
  });

  it('replace() overwrites the entire trait list', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', traits: ['a', 'b', 'c'] });
    repo.replace('tenant_default', 'default', ['only'], 'new summary');
    const profile = repo.get('tenant_default')!;
    expect(profile.traits).toEqual(['only']);
    expect(profile.summary).toBe('new summary');
  });

  it('supports multiple user keys per tenant', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'alice', traits: ['frontend'] });
    repo.upsert({ tenantId: 'tenant_default', userKey: 'bob', traits: ['backend'] });
    expect(repo.get('tenant_default', 'alice')!.traits).toEqual(['frontend']);
    expect(repo.get('tenant_default', 'bob')!.traits).toEqual(['backend']);
  });

  it('list() returns all profiles for a tenant', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'a', summary: 'a' });
    repo.upsert({ tenantId: 'tenant_default', userKey: 'b', summary: 'b' });
    const all = repo.list('tenant_default');
    expect(all.length).toBe(2);
  });

  it('trims empty traits and skips them', () => {
    repo.upsert({ tenantId: 'tenant_default', userKey: 'default', traits: ['  valid  ', '', '   '] });
    expect(repo.get('tenant_default')!.traits).toEqual(['valid']);
  });
});