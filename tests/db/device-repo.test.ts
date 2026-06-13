import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { DeviceRepo } from '../../packages/server/src/db/repositories/device-repo.js';

let db: Db;
let deviceRepo: DeviceRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-device-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  deviceRepo = new DeviceRepo(db);
});

afterEach(() => db.close());

describe('DeviceRepo', () => {
  it('creates and reads a device', () => {
    const d = deviceRepo.create({
      tenantId: 'tenant_default',
      name: 'laptop',
      type: 'opencode',
      apiKeyHash: 'h1'
    });
    expect(d.id).toBeTypeOf('string');

    const loaded = deviceRepo.getById('tenant_default', d.id);
    expect(loaded?.name).toBe('laptop');
    expect(loaded?.type).toBe('opencode');
  });

  it('finds a device by its api-key hash', () => {
    deviceRepo.create({ tenantId: 'tenant_default', name: 'a', type: 'opencode', apiKeyHash: 'hash-a' });
    deviceRepo.create({ tenantId: 'tenant_default', name: 'b', type: 'cursor', apiKeyHash: 'hash-b' });
    const found = deviceRepo.findByKeyHash('hash-b');
    expect(found?.name).toBe('b');
  });

  it('returns null when no device matches the hash', () => {
    const found = deviceRepo.findByKeyHash('nope');
    expect(found).toBeNull();
  });

  it('lists devices for a tenant', () => {
    deviceRepo.create({ tenantId: 'tenant_default', name: 'a', type: 'opencode', apiKeyHash: 'h1' });
    deviceRepo.create({ tenantId: 'tenant_default', name: 'b', type: 'cursor', apiKeyHash: 'h2' });
    const list = deviceRepo.list('tenant_default');
    expect(list.length).toBe(2);
  });

  it('records lastSeenAt when device pings in', () => {
    const d = deviceRepo.create({ tenantId: 'tenant_default', name: 'a', type: 'opencode', apiKeyHash: 'h' });
    expect(d.lastSeenAt).toBeNull();
    deviceRepo.touch(d.id);
    const loaded = deviceRepo.getById('tenant_default', d.id);
    expect(loaded?.lastSeenAt).toBeTypeOf('number');
  });

  it('deletes a device by id', () => {
    const d = deviceRepo.create({ tenantId: 'tenant_default', name: 'a', type: 'opencode', apiKeyHash: 'h' });
    deviceRepo.delete(d.id);
    const loaded = deviceRepo.getById('tenant_default', d.id);
    expect(loaded).toBeNull();
  });
});
