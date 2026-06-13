import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/database.js';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';

let db: Db;
let repo: MemoryRepo;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => db.close());

describe('MemoryRepo', () => {
  it('creates and reads a memory with scopes', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'decision',
      title: 'Use MCP + REST',
      content: 'MemWeave exposes MCP for agents and REST for UI/scripts.',
      summary: 'Use MCP + REST for v1.',
      concepts: ['mcp', 'rest', 'interface'],
      files: [],
      importance: 8,
      confidence: 0.9,
      source: 'user_explicit',
      scopeLevel: 'project',
      scopes: [
        { key: 'project', value: 'memory' },
        { key: 'topic', value: 'architecture' }
      ],
      sourceClient: 'rest_api',
      sourceDeviceId: null,
      sourceSessionId: null
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.title).toBe('Use MCP + REST');
    expect(loaded?.strength).toBe(0.8);
    expect(loaded?.scopes).toEqual([
      { key: 'project', value: 'memory' },
      { key: 'topic', value: 'architecture' }
    ]);
  });

  it('records access logs and reinforces memory', () => {
    const memory = repo.create({
      tenantId: 'tenant_default',
      type: 'fact',
      title: 'SQLite is the default store',
      content: 'MemWeave stores v1 data in SQLite.',
      summary: 'SQLite is the default store.',
      concepts: ['sqlite'],
      files: [],
      importance: 6,
      confidence: 0.8,
      source: 'system_inferred',
      scopeLevel: 'project',
      scopes: [{ key: 'project', value: 'memory' }],
      sourceClient: null,
      sourceDeviceId: null,
      sourceSessionId: null
    });

    repo.recordAccess({
      tenantId: 'tenant_default',
      memoryId: memory.id,
      sessionId: null,
      deviceId: null,
      source: 'context_inject',
      query: 'storage design',
      rank: 1,
      score: 0.92,
      usedInContext: true
    });

    const loaded = repo.getById('tenant_default', memory.id);
    expect(loaded?.accessCount).toBe(1);
    expect(loaded?.strength).toBeCloseTo(0.7, 5);
    expect(loaded?.lastReinforcedAt).toBeTypeOf('number');
  });
});
