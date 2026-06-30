import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { McpService } from '../../packages/server/src/mcp/service.js';

let db: Db;
let dir: string;
let repo: MemoryRepo;

function makeMemory(title: string, content: string) {
  return repo.create({
    tenantId: 'tenant_default', type: 'fact', title, content, summary: content.slice(0, 80),
    concepts: [], files: [], importance: 5, confidence: 0.8, source: 'user_explicit',
    scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-edge-'));
  db = openDatabase(join(dir, 'test.db'));
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  repo = new MemoryRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('McpService.createEdge — explicit edge creation (batch E)', () => {
  it('creates an edge between two existing memories', () => {
    const a = makeMemory('Memory A', 'content a distinct');
    const b = makeMemory('Memory B', 'content b distinct');
    const service = new McpService({ db });
    const res = service.createEdge({ fromMemoryId: a.id, toMemoryId: b.id, type: 'references', reason: 'A refs B' });
    expect(res.ok).toBe(true);
    expect(typeof res.edgeId).toBe('string');

    const edges = db.prepare('SELECT * FROM edges WHERE from_memory_id = ?').all(a.id) as Array<{ type: string; reason: string }>;
    expect(edges.length).toBe(1);
    expect(edges[0].type).toBe('references');
    expect(edges[0].reason).toBe('A refs B');
  });

  it('defaults strength to 0.7 when omitted', () => {
    const a = makeMemory('A', 'content a');
    const b = makeMemory('B', 'content b');
    const service = new McpService({ db });
    service.createEdge({ fromMemoryId: a.id, toMemoryId: b.id, type: 'related_to' });
    const edge = db.prepare('SELECT strength FROM edges WHERE from_memory_id = ?').get(a.id) as { strength: number };
    expect(edge.strength).toBe(0.7);
  });

  it('throws when the from memory does not exist', () => {
    const b = makeMemory('B', 'content b');
    const service = new McpService({ db });
    expect(() => service.createEdge({ fromMemoryId: 'nonexistent', toMemoryId: b.id, type: 'related_to' }))
      .toThrow(/not found/i);
  });

  it('throws when linking a memory to itself', () => {
    const a = makeMemory('A', 'content a');
    const service = new McpService({ db });
    expect(() => service.createEdge({ fromMemoryId: a.id, toMemoryId: a.id, type: 'related_to' }))
      .toThrow(/itself/i);
  });

  it('accepts all 10 edge types', () => {
    const types = ['causes', 'enables', 'contradicts', 'supersedes', 'references', 'related_to', 'before', 'after', 'duplicates', 'refines'];
    const service = new McpService({ db });
    for (const type of types) {
      const a = makeMemory(`A-${type}`, `c-${type}`);
      const b = makeMemory(`B-${type}`, `c2-${type}`);
      const res = service.createEdge({ fromMemoryId: a.id, toMemoryId: b.id, type: type as never });
      expect(res.ok).toBe(true);
    }
    const count = (db.prepare('SELECT COUNT(*) c FROM edges').get() as { c: number }).c;
    expect(count).toBe(10);
  });
});