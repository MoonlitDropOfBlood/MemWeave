import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { McpService } from '../../packages/server/src/mcp/service.js';

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-prof-svc-'));
  db = openDatabase(join(dir, 'test.db'), { skipVectorExtension: true });
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('McpService user profile (batch F)', () => {
  it('getProfile returns null initially', () => {
    const service = new McpService({ db });
    expect(service.getProfile()).toBeNull();
  });

  it('updateProfile sets traits and summary, getProfile reads them back', () => {
    const service = new McpService({ db });
    service.updateProfile({ traits: ['prefers TypeScript'], summary: 'A backend dev.' });
    const p = service.getProfile()!;
    expect(p.traits).toEqual(['prefers TypeScript']);
    expect(p.summary).toBe('A backend dev.');
  });

  it('updateProfile merges traits additively across calls', () => {
    const service = new McpService({ db });
    service.updateProfile({ traits: ['a', 'b'] });
    service.updateProfile({ traits: ['b', 'c'] });
    expect(service.getProfile()!.traits).toEqual(['a', 'b', 'c']);
  });

  it('updateProfile with only summary keeps existing traits', () => {
    const service = new McpService({ db });
    service.updateProfile({ traits: ['x'] });
    service.updateProfile({ summary: 'new summary' });
    const p = service.getProfile()!;
    expect(p.traits).toEqual(['x']);
    expect(p.summary).toBe('new summary');
  });

  it('supports per-userKey isolation', () => {
    const service = new McpService({ db });
    service.updateProfile({ userKey: 'alice', traits: ['frontend'] });
    service.updateProfile({ userKey: 'bob', traits: ['backend'] });
    expect(service.getProfile('alice')!.traits).toEqual(['frontend']);
    expect(service.getProfile('bob')!.traits).toEqual(['backend']);
  });
});