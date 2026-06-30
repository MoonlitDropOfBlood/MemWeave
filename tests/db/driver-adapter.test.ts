import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../packages/server/src/db/database.js';
import { openDatabase, transaction } from '../../packages/server/src/db/database.js';

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-driver-'));
  db = openDatabase(join(dir, 'test.db'), { skipVectorExtension: true });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('driver-adapter (node:sqlite → better-sqlite3 compatible surface)', () => {
  describe('prepare / get / all / run', () => {
    it('runs positional (?) params and returns rows via get/all', () => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)');
      db.prepare('INSERT INTO t (id, name) VALUES (?, ?)').run(1, 'alice');
      db.prepare('INSERT INTO t (id, name) VALUES (?, ?)').run(2, 'bob');

      const one = db.prepare('SELECT name FROM t WHERE id = ?').get(1) as { name: string };
      expect(one.name).toBe('alice');

      const all = db.prepare('SELECT name FROM t ORDER BY id').all() as Array<{ name: string }>;
      expect(all.map((r) => r.name)).toEqual(['alice', 'bob']);
    });

    it('run() returns changes + lastInsertRowid', () => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)');
      const r = db.prepare('INSERT INTO t (name) VALUES (?)').run('carol');
      expect(r.changes).toBe(1);
      expect(Number(r.lastInsertRowid)).toBe(1);
    });

    it('get() returns undefined when no rows', () => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)');
      const r = db.prepare('SELECT id FROM t WHERE id = ?').get(99);
      expect(r).toBeUndefined();
    });
  });

  describe('named parameters (the better-sqlite3 → node:sqlite gap)', () => {
    beforeEach(() => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, age INTEGER)');
    });

    it('accepts @name markers with a bare object', () => {
      db.prepare('INSERT INTO t (id, name, age) VALUES (@id, @name, @age)')
        .run({ id: 1, name: 'alice', age: 30 });
      const row = db.prepare('SELECT name, age FROM t WHERE id = @id').get({ id: 1 }) as { name: string; age: number };
      expect(row).toEqual({ name: 'alice', age: 30 });
    });

    it('accepts :name markers with a bare object', () => {
      db.prepare('INSERT INTO t (id, name, age) VALUES (:id, :name, :age)')
        .run({ id: 2, name: 'bob', age: 25 });
      const row = db.prepare('SELECT name FROM t WHERE id = :id').get({ id: 2 }) as { name: string };
      expect(row.name).toBe('bob');
    });

    it('accepts $name markers with a bare object', () => {
      db.prepare('INSERT INTO t (id, name, age) VALUES ($id, $name, $age)')
        .run({ id: 3, name: 'carol', age: 40 });
      const row = db.prepare('SELECT name FROM t WHERE id = $id').get({ id: 3 }) as { name: string };
      expect(row.name).toBe('carol');
    });

    it('DROPS surplus object keys (better-sqlite3 leniency) — the regression that broke 84 tests', () => {
      // This is the exact failure mode: memory-repo passes { ...input, id, ... }
      // where input carries `concepts`/`files`/`scopes` that have NO SQL placeholder.
      // better-sqlite3 ignores them; node:sqlite errors "Unknown named parameter".
      // The adapter must filter to only the keys the SQL references.
      db.prepare('INSERT INTO t (id, name, age) VALUES (@id, @name, @age)')
        .run({ id: 1, name: 'alice', age: 30, concepts: ['x'], files: [], scopes: [], surplus: 'ignored' });
      const row = db.prepare('SELECT name FROM t WHERE id = @id').get({ id: 1, extra: 'also ignored' }) as { name: string };
      expect(row.name).toBe('alice');
    });

    it('mixes named object + positional params (named first, then ?)', () => {
      db.prepare('INSERT INTO t (id, name, age) VALUES (@id, @name, @age)')
        .run({ id: 1, name: 'alice', age: 30 });
      db.prepare('INSERT INTO t (id, name, age) VALUES (@id, @name, @age)')
        .run({ id: 2, name: 'bob', age: 25 });
      const rows = db.prepare('SELECT name FROM t WHERE age > @minAge ORDER BY id').all({ minAge: 26 }) as Array<{ name: string }>;
      expect(rows.map((r) => r.name)).toEqual(['alice']);
    });
  });

  describe('transactions', () => {
    beforeEach(() => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val INTEGER)');
    });

    it('commit: db.transaction(fn)() persists changes', () => {
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run(1, 10);
        db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run(2, 20);
      });
      tx();
      const cnt = (db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c;
      expect(cnt).toBe(2);
    });

    it('rollback: on throw, changes are undone and error re-thrown', () => {
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run(1, 10);
        throw new Error('boom');
      });
      expect(() => tx()).toThrow('boom');
      const cnt = (db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c;
      expect(cnt).toBe(0);
    });

    it('returns the function result', () => {
      const tx = db.transaction(() => 42);
      expect(tx()).toBe(42);
    });

    it('transaction(db, fn) helper works too', () => {
      // database.ts exports this helper; the repos use both forms.
      transaction(db, () => {
        db.prepare('INSERT INTO t (id, val) VALUES (?, ?)').run(1, 99);
      });
      const row = db.prepare('SELECT val FROM t WHERE id = ?').get(1) as { val: number };
      expect(row.val).toBe(99);
    });
  });

  describe('Float32Array BLOB binding (vector storage)', () => {
    it('round-trips a Float32Array via Buffer', () => {
      db.exec('CREATE TABLE vec(id TEXT PRIMARY KEY, embedding BLOB)');
      const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      db.prepare('INSERT INTO vec (id, embedding) VALUES (?, ?)').run('v1', buf);

      const row = db.prepare('SELECT embedding FROM vec WHERE id = ?').get('v1') as { embedding: Buffer };
      const back = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      expect(back.length).toBe(4);
      expect(back[0]).toBeCloseTo(0.1, 5);
      expect(back[3]).toBeCloseTo(0.4, 5);
    });
  });

  describe('FTS5 (built-in, must work without extensions)', () => {
    it('creates an external-content FTS5 table + trigger and runs BM25 MATCH', () => {
      db.exec(`
        CREATE TABLE docs(id TEXT PRIMARY KEY, title TEXT, body TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(title, body, content='docs', content_rowid='rowid');
        CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
          INSERT INTO docs_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
      `);
      db.prepare('INSERT INTO docs (id, title, body) VALUES (?, ?, ?)').run('d1', 'strict typescript', 'use noImplicitAny');
      db.prepare('INSERT INTO docs (id, title, body) VALUES (?, ?, ?)').run('d2', 'memory leak', 'use heap snapshots');

      const hits = db.prepare(`
        SELECT d.id, bm25(docs_fts) AS score
        FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
        WHERE docs_fts MATCH ? ORDER BY score DESC
      `).all('"strict" "typescript"') as Array<{ id: string; score: number }>;
      expect(hits.length).toBe(1);
      expect(hits[0].id).toBe('d1');
    });
  });

  describe('exec', () => {
    it('runs multi-statement DDL', () => {
      db.exec('CREATE TABLE a(x); CREATE TABLE b(y);');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain('a');
      expect(tables.map((t) => t.name)).toContain('b');
    });
  });
});
