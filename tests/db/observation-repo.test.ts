import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { SessionRepo } from '../../packages/server/src/db/repositories/session-repo.js';
import { ObservationRepo } from '../../packages/server/src/db/repositories/observation-repo.js';

let db: Db;
let observationRepo: ObservationRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-obs-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  // Create a session for FK
  new SessionRepo(db).create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 's', project: null });
  observationRepo = new ObservationRepo(db);
});

afterEach(() => db.close());

describe('ObservationRepo', () => {
  it('creates and reads an observation', () => {
    const sessionId = (db.prepare('SELECT id FROM sessions LIMIT 1').get() as { id: string }).id;
    const obs = observationRepo.create({
      sessionId,
      tenantId: 'tenant_default',
      hookType: 'post_tool_use',
      toolName: 'Read',
      toolInput: '/src/foo.ts',
      toolOutput: '...',
      memoryId: null
    });
    expect(obs.id).toBeTypeOf('string');
    expect(obs.processed).toBe(false);

    const loaded = observationRepo.getById('tenant_default', obs.id);
    expect(loaded?.toolName).toBe('Read');
    expect(loaded?.toolInput).toBe('/src/foo.ts');
  });

  it('marks observation as processed and links to memoryId', () => {
    const sessionId = (db.prepare('SELECT id FROM sessions LIMIT 1').get() as { id: string }).id;
    // First create a real memory to satisfy FK constraint
    db.prepare(`
      INSERT INTO memories (id, tenant_id, tier, type, title, content, summary, concepts_json, concepts_text, files_json, importance, confidence, strength, source, scope_level, tau, access_count, last_decay_at, reinforcement_score, created_at, updated_at)
      VALUES (?, 'tenant_default', 'short', 'event', 'm', 'c', 's', '[]', '', '[]', 5, 0.8, 0.5, 'system_inferred', 'project', 1, 0, ?, 0, ?, ?)
    `).run('mem_abc', Date.now(), Date.now(), Date.now());
    const obs = observationRepo.create({
      sessionId, tenantId: 'tenant_default', hookType: 'post_tool_use', toolName: 'Read',
      toolInput: null, toolOutput: null, memoryId: null
    });
    observationRepo.markProcessed(obs.id, 'mem_abc');
    const loaded = observationRepo.getById('tenant_default', obs.id);
    expect(loaded?.processed).toBe(true);
    expect(loaded?.memoryId).toBe('mem_abc');
  });

  it('lists unprocessed observations', () => {
    const sessionId = (db.prepare('SELECT id FROM sessions LIMIT 1').get() as { id: string }).id;
    observationRepo.create({ sessionId, tenantId: 'tenant_default', hookType: 'a', toolName: null, toolInput: null, toolOutput: null, memoryId: null });
    observationRepo.create({ sessionId, tenantId: 'tenant_default', hookType: 'b', toolName: null, toolInput: null, toolOutput: null, memoryId: null });
    const o3 = observationRepo.create({ sessionId, tenantId: 'tenant_default', hookType: 'c', toolName: null, toolInput: null, toolOutput: null, memoryId: null });
    observationRepo.markProcessed(o3.id, null);

    const unprocessed = observationRepo.listUnprocessed('tenant_default', 10);
    expect(unprocessed.length).toBe(2);
    expect(unprocessed.every((o) => o.processed === false)).toBe(true);
  });

  it('respects limit in listUnprocessed', () => {
    const sessionId = (db.prepare('SELECT id FROM sessions LIMIT 1').get() as { id: string }).id;
    for (let i = 0; i < 5; i++) {
      observationRepo.create({ sessionId, tenantId: 'tenant_default', hookType: `h${i}`, toolName: null, toolInput: null, toolOutput: null, memoryId: null });
    }
    const list = observationRepo.listUnprocessed('tenant_default', 3);
    expect(list.length).toBe(3);
  });
});
