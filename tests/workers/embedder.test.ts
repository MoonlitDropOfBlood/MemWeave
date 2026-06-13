import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { MemoryRepo } from '../../src/db/repositories/memory-repo.js';
import { VectorRepo } from '../../src/db/repositories/vector-repo.js';
import { startEmbedderWorker } from '../../src/workers/embedder.js';
import { NoopEmbeddingProvider } from '../../src/providers/embedding/index.js';

const DIM = 4;
let dbPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-embedder-'));
  dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath, { vectorDimensions: DIM });
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  db.close();
});

afterEach(() => {
  // tmpdir cleanup is automatic
});

describe('startEmbedderWorker', () => {
  it('embeds new memories via the provider', async () => {
    const db = openDatabase(dbPath, { vectorDimensions: DIM });
    const memRepo = new MemoryRepo(db);
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'T1', content: 'C1', summary: 'S1',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    db.close();

    const provider = new NoopEmbeddingProvider({ dimensions: DIM, model: 'noop' });
    const handle = startEmbedderWorker({
      dbPath, provider, dimensions: DIM, intervalMs: 60_000
    });

    const result = await handle.runNow();
    expect(result.embedded).toBe(1);
    handle.stop();

    // Verify the embedding was stored
    const db2 = openDatabase(dbPath, { vectorDimensions: DIM });
    const vecRepo = new VectorRepo(db2, DIM);
    expect(vecRepo.count()).toBe(1);
    db2.close();
  });

  it('skips memories that already have embeddings', async () => {
    const db = openDatabase(dbPath, { vectorDimensions: DIM });
    const memRepo = new MemoryRepo(db);
    const m = memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'T1', content: 'C1', summary: 'S1',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    const vecRepo = new VectorRepo(db, DIM);
    vecRepo.upsert(m.id, 'tenant_default', [0.1, 0.2, 0.3, 0.4]);
    db.close();

    const provider = new NoopEmbeddingProvider({ dimensions: DIM, model: 'noop' });
    const handle = startEmbedderWorker({
      dbPath, provider, dimensions: DIM, intervalMs: 60_000
    });

    const result = await handle.runNow();
    expect(result.embedded).toBe(0);
    handle.stop();
  });

  it('processes only up to batchSize per run', async () => {
    const db = openDatabase(dbPath, { vectorDimensions: DIM });
    const memRepo = new MemoryRepo(db);
    for (let i = 0; i < 5; i++) {
      memRepo.create({
        tenantId: 'tenant_default', type: 'fact', title: `T${i}`, content: `C${i}`, summary: `S${i}`,
        concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
        scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
      });
    }
    db.close();

    const provider = new NoopEmbeddingProvider({ dimensions: DIM, model: 'noop' });
    const handle = startEmbedderWorker({
      dbPath, provider, dimensions: DIM, intervalMs: 60_000, batchSize: 2
    });

    const r1 = await handle.runNow();
    expect(r1.embedded).toBe(2);

    const r2 = await handle.runNow();
    expect(r2.embedded).toBe(2);

    const r3 = await handle.runNow();
    expect(r3.embedded).toBe(1);

    handle.stop();
  });

  it('runOnStart fires once on schedule', async () => {
    const db = openDatabase(dbPath, { vectorDimensions: DIM });
    const memRepo = new MemoryRepo(db);
    memRepo.create({
      tenantId: 'tenant_default', type: 'fact', title: 'T1', content: 'C1', summary: 'S1',
      concepts: [], files: [], importance: 5, confidence: 0.8, source: 'system_inferred',
      scopeLevel: 'project', scopes: [], sourceClient: null, sourceDeviceId: null, sourceSessionId: null
    });
    db.close();

    const events: number[] = [];
    const provider = new NoopEmbeddingProvider({ dimensions: DIM, model: 'noop' });
    const handle = startEmbedderWorker({
      dbPath, provider, dimensions: DIM, intervalMs: 60_000,
      runOnStart: true,
      onRun: (r) => events.push(r.timestamp)
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1);
    handle.stop();
  });
});
