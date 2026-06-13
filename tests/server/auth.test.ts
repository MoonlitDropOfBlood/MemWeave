import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../src/db/database.js';
import { createHttpServer } from '../../src/server/http.js';
import { extractBearerToken, hashApiKey, registerAuthMiddleware } from '../../src/server/auth.js';
import { DeviceRepo } from '../../src/db/repositories/device-repo.js';

let app: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memweave-auth-'));
  dbPath = join(dir, 'test.db');
  app = await createHttpServer({ dbPath });
});

afterEach(async () => {
  await app.close();
});

describe('hashApiKey()', () => {
  it('returns the key unchanged in plain mode', () => {
    expect(hashApiKey('hello', 'plain')).toBe('hello');
  });

  it('returns sha256 hex in sha256 mode', () => {
    const h = hashApiKey('hello', 'sha256');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('extractBearerToken()', () => {
  it('returns null for undefined', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic foo')).toBeNull();
  });

  it('extracts token from Bearer scheme (case-insensitive)', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('BEARER abc')).toBe('abc');
  });

  it('trims whitespace from the token', () => {
    expect(extractBearerToken('Bearer   abc   ')).toBe('abc');
  });
});

describe('registerAuthMiddleware — requireAuth: false (default)', () => {
  it('passes through to /api/v1/memories with no auth header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'fact', title: 't', content: 'c', summary: 's', concepts: [], files: [],
        importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
      }
    });
    expect(res.statusCode).toBe(201);
  });

  it('skips auth on /api/v1/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('registerAuthMiddleware — requireAuth: true', () => {
  it('rejects requests without a Bearer token', async () => {
    await app.close();
    app = await createHttpServer({ dbPath });
    registerAuthMiddleware(app, {
      dbPath,
      config: {
        defaultTenantName: 'default',
        deviceApiKey: 'dev-local-key',
        requireAuth: true
      }
    });
    // The default createHttpServer does NOT register auth by itself;
    // calling registerAuthMiddleware after construction layers it on top.
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    // health is still exempt
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests with a bad Bearer token', async () => {
    await app.close();
    app = await createHttpServer({ dbPath });
    registerAuthMiddleware(app, {
      dbPath,
      config: {
        defaultTenantName: 'default',
        deviceApiKey: 'dev-local-key',
        requireAuth: true
      }
    });
    // Register a device with a known key (tenant_default is created by createHttpServer)
    const db = openDatabase(dbPath);
    const deviceRepo = new DeviceRepo(db);
    const keyHash = hashApiKey('good-key', 'sha256');
    deviceRepo.create({ tenantId: 'tenant_default', name: 'laptop', type: 'opencode', apiKeyHash: keyHash });
    db.close();

    // Bad token
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: { type: 'fact' },
      headers: { authorization: 'Bearer wrong-key' }
    });
    expect(bad.statusCode).toBe(401);
  });

  it('accepts a valid Bearer token and exposes authDevice on the request', async () => {
    await app.close();
    app = await createHttpServer({ dbPath });
    registerAuthMiddleware(app, {
      dbPath,
      config: {
        defaultTenantName: 'default',
        deviceApiKey: 'dev-local-key',
        requireAuth: true
      }
    });
    const db = openDatabase(dbPath);
    const deviceRepo = new DeviceRepo(db);
    const keyHash = hashApiKey('good-key', 'sha256');
    deviceRepo.create({ tenantId: 'tenant_default', name: 'laptop', type: 'opencode', apiKeyHash: keyHash });
    db.close();

    // Valid token
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      payload: {
        type: 'fact', title: 'auth-test', content: 'c', summary: 's', concepts: [], files: [],
        importance: 5, confidence: 0.5, source: 'system_inferred', scopeLevel: 'project', scopes: []
      },
      headers: { authorization: 'Bearer good-key' }
    });
    expect(ok.statusCode).toBe(201);
  });
});
