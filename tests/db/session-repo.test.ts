import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { SessionRepo } from '../../packages/server/src/db/repositories/session-repo.js';

let db: Db;
let sessionRepo: SessionRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-session-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  sessionRepo = new SessionRepo(db);
});

afterEach(() => db.close());

describe('SessionRepo', () => {
  it('creates and reads a session', () => {
    const session = sessionRepo.create({
      tenantId: 'tenant_default',
      deviceId: null,
      source: 'opencode',
      title: 'Test session'
    });

    const loaded = sessionRepo.getById('tenant_default', session.id);
    expect(loaded?.title).toBe('Test session');
    expect(loaded?.source).toBe('opencode');
    expect(loaded?.endedAt).toBeNull();
    expect(loaded?.observationCount).toBe(0);
  });

  it('lists recent sessions ordered by startedAt DESC', () => {
    const s1 = sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'first' });
    // Small sleep to ensure different timestamps
    const s2 = sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'second' });
    const s3 = sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'third' });

    const list = sessionRepo.listRecent('tenant_default', 10);
    expect(list.length).toBe(3);
    // Most recent first
    expect(list[0].id).toBe(s3.id);
    expect(list[2].id).toBe(s1.id);
  });

  it('respects limit in listRecent', () => {
    for (let i = 0; i < 5; i++) {
      sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: `s${i}` });
    }
    const list = sessionRepo.listRecent('tenant_default', 3);
    expect(list.length).toBe(3);
  });

  it('ends a session with endedAt timestamp', () => {
    const s = sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'test' });
    sessionRepo.end(s.id);
    const loaded = sessionRepo.getById('tenant_default', s.id);
    expect(loaded?.endedAt).toBeTypeOf('number');
  });

  it('lists memories associated with a session (via source_session_id)', () => {
    // First create a session
    const s = sessionRepo.create({ tenantId: 'tenant_default', deviceId: null, source: 'opencode', title: 'test' });
    // Use raw DB to insert memories linked to this session (no MemoryRepo support for sourceSessionId is in scope)
    db.prepare(`
      INSERT INTO memories (id, tenant_id, tier, type, title, content, summary, concepts_json, concepts_text, files_json, importance, confidence, strength, source, scope_level, source_session_id, tau, access_count, last_decay_at, reinforcement_score, created_at, updated_at)
      VALUES (?, 'tenant_default', 'short', 'event', 'm1', 'content', 'summary', '[]', '', '[]', 5, 0.8, 0.5, 'system_inferred', 'project', ?, 1, 0, ?, 0, ?, ?)
    `).run('m1', s.id, Date.now(), Date.now(), Date.now());
    db.prepare(`
      INSERT INTO memories (id, tenant_id, tier, type, title, content, summary, concepts_json, concepts_text, files_json, importance, confidence, strength, source, scope_level, source_session_id, tau, access_count, last_decay_at, reinforcement_score, created_at, updated_at)
      VALUES (?, 'tenant_default', 'short', 'event', 'm2', 'content', 'summary', '[]', '', '[]', 5, 0.8, 0.5, 'system_inferred', 'project', ?, 1, 0, ?, 0, ?, ?)
    `).run('m2', s.id, Date.now(), Date.now(), Date.now());

    const memories = sessionRepo.listMemories('tenant_default', s.id);
    expect(memories.length).toBe(2);
    expect(memories.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });
});
