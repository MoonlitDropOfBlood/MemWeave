import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { MemoryRepo } from '../../packages/server/src/db/repositories/memory-repo.js';
import { EdgeRepo } from '../../packages/server/src/db/repositories/edge-repo.js';
import { startGraphWorker } from '../../packages/server/src/workers/graph-worker.js';
import { NoopLlmProvider } from '../../packages/server/src/providers/llm/noop.js';
import type { LlmProvider } from '../../packages/server/src/providers/llm/index.js';

let dbPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-graph-worker-'));
  dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  db.close();
});

afterEach(() => { /* tmpdir auto-cleanup */ });

describe('startGraphWorker', () => {
  it('does nothing when there are no memories', async () => {
    const handle = startGraphWorker({
      dbPath, llm: new NoopLlmProvider(), intervalMs: 60_000
    });
    const result = await handle.runNow();
    expect(result.scanned).toBe(0);
    expect(result.edgesCreated).toBe(0);
    handle.stop();
  });

  it('does nothing when noop LLM returns no edges', async () => {
    const db = openDatabase(dbPath);
    const memRepo = new MemoryRepo(db);
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite FTS5', content: 'BM25 ranking',
      summary: 'SQLite FTS5 powers keyword search',
      concepts: ['sqlite', 'fts5', 'bm25'], files: [], importance: 5, confidence: 0.8,
      source: 'system_inferred', scopeLevel: 'project', scopes: [],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    db.close();

    const handle = startGraphWorker({
      dbPath, llm: new NoopLlmProvider(), intervalMs: 60_000
    });
    const result = await handle.runNow();
    expect(result.scanned).toBe(1);
    expect(result.edgesCreated).toBe(0); // noop LLM returns empty
    handle.stop();
  });

  it('runOnStart fires once', async () => {
    const events: number[] = [];
    const handle = startGraphWorker({
      dbPath, llm: new NoopLlmProvider(), intervalMs: 60_000,
      runOnStart: true,
      onRun: (r) => events.push(r.timestamp)
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1);
    handle.stop();
  });

  it('stop() halts further scheduled runs', async () => {
    const events: number[] = [];
    const handle = startGraphWorker({
      dbPath, llm: new NoopLlmProvider(), intervalMs: 50,
      onRun: (r) => events.push(r.timestamp)
    });
    await new Promise((r) => setTimeout(r, 130));
    const before = events.length;
    expect(before).toBeGreaterThan(0);
    handle.stop();
    await new Promise((r) => setTimeout(r, 100));
    const after = events.length;
    expect(after).toBe(before);
  });

  it('is fail-silent when the LLM throws (does not crash runOnce)', async () => {
    // Regression: a 401 / network error from the LLM used to crash the worker
    // (and the server, since runOnce runs in-process). The LLM call must be
    // wrapped so a bad pair is skipped and runOnce resolves normally.
    const db = openDatabase(dbPath);
    const memRepo = new MemoryRepo(db);
    // Two memories whose titles overlap → findCandidateTargets returns a pair,
    // so extractEdgesViaLlm actually gets called.
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite FTS5 ranking', content: 'c1',
      summary: 's1', concepts: ['sqlite'], files: [], importance: 5, confidence: 0.8,
      source: 'system_inferred', scopeLevel: 'project', scopes: [],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'SQLite vector search', content: 'c2',
      summary: 's2', concepts: ['sqlite'], files: [], importance: 5, confidence: 0.8,
      source: 'system_inferred', scopeLevel: 'project', scopes: [],
      sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    db.close();

    const throwingLlm: LlmProvider = {
      async call() { throw new Error('LLM API error 401: Unauthorized'); }
    };
    const handle = startGraphWorker({ dbPath, llm: throwingLlm, intervalMs: 60_000 });
    // runOnce must resolve (not reject) despite the LLM throwing.
    const result = await handle.runNow();
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.edgesCreated).toBe(0); // no edges created because the LLM failed
    handle.stop();
  });
});
