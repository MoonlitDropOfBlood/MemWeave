import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../packages/server/src/db/database.js';
import { startConsolidationScheduler } from '../../packages/server/src/server/scheduler.js';

let dbPath: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-sched-'));
  dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'hash', Date.now());
  db.close();
});

afterEach(() => {
  // nothing to clean up; tmpdir cleanup is automatic
});

describe('startConsolidationScheduler', () => {
  it('runs once and returns a result via runNow()', async () => {
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 60_000 // long interval so it doesn't fire on its own
    });

    const result = await handle.runNow();
    expect(result).toHaveProperty('promoted');
    expect(result).toHaveProperty('evicted');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('timestamp');
    expect(result.timestamp).toBeTypeOf('number');

    handle.stop();
  });

  it('invokes onRun callback when runNow() is called', async () => {
    const events: number[] = [];
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 60_000,
      onRun: (r) => events.push(r.timestamp)
    });

    await handle.runNow();
    expect(events.length).toBe(1);

    await handle.runNow();
    expect(events.length).toBe(2);

    handle.stop();
  });

  it('runs immediately on start when runOnStart: true', async () => {
    const events: number[] = [];
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 60_000,
      runOnStart: true,
      onRun: (r) => events.push(r.timestamp)
    });

    // Give the runOnStart promise a chance to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1);

    handle.stop();
  });

  it('fires on the interval when interval elapses', async () => {
    const events: number[] = [];
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 50, // very short interval
      onRun: (r) => events.push(r.timestamp)
    });

    // Wait long enough for at least 2 ticks
    await new Promise((r) => setTimeout(r, 175));
    expect(events.length).toBeGreaterThanOrEqual(2);

    handle.stop();
  });

  it('stop() halts further scheduled runs', async () => {
    const events: number[] = [];
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 50,
      onRun: (r) => events.push(r.timestamp)
    });

    await new Promise((r) => setTimeout(r, 100));
    const before = events.length;

    handle.stop();
    await new Promise((r) => setTimeout(r, 100));
    const after = events.length;

    // After stop, no new events should arrive
    expect(after).toBe(before);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const events: number[] = [];
    const handle = startConsolidationScheduler({
      dbPath,
      intervalMs: 50,
      signal: controller.signal,
      onRun: (r) => events.push(r.timestamp)
    });

    await new Promise((r) => setTimeout(r, 100));
    const before = events.length;
    expect(before).toBeGreaterThan(0);

    controller.abort();
    await new Promise((r) => setTimeout(r, 100));
    const after = events.length;
    expect(after).toBe(before);

    // handle.stop() should be safe to call after abort
    handle.stop();
  });
});
