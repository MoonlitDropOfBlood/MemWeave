import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openDatabase } from '../db/database.js';
import { DeviceRepo } from '../db/repositories/device-repo.js';
import type { AuthConfig } from '../core/config.js';

export interface AuthenticatedDevice {
  deviceId: string;
  tenantId: string;
  type: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by auth middleware on successful auth. */
    authDevice?: AuthenticatedDevice;
  }
}

/**
 * Hash an API key for storage/comparison. v1 supports two strategies:
 * - 'plain': identity (no hash) — convenient for local dev / tests
 * - 'sha256': SHA-256 of the key — safer for production
 */
export function hashApiKey(key: string, strategy: 'plain' | 'sha256' = 'plain'): string {
  if (strategy === 'sha256') return createHash('sha256').update(key).digest('hex');
  return key;
}

/**
 * Extract a Bearer token from the `Authorization` header.
 * Returns `null` if missing or malformed.
 */
export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization);
  return m ? m[1].trim() : null;
}

export interface AuthMiddlewareOptions {
  dbPath: string;
  config: AuthConfig;
}

/**
 * Registers an `onRequest` hook that enforces Bearer-token authentication on
 * `/api/v1/*` routes (except `/api/v1/health`).
 *
 * Behavior:
 * - `config.requireAuth === false`: skip auth, leave `request.authDevice` undefined.
 *   This is the v1 default for developer convenience.
 * - `config.requireAuth === true`: require a valid Bearer token; otherwise 401.
 *   Also calls `device.touch(id)` to update `lastSeenAt`.
 *
 * On success, `request.authDevice` is populated and downstream handlers can
 * use `request.tenantId` and `request.deviceId` for tenant isolation.
 */
export function registerAuthMiddleware(app: FastifyInstance, options: AuthMiddlewareOptions): void {
  const deviceRepo = new DeviceRepo(openDatabase(options.dbPath));
  const hashStrategy: 'plain' | 'sha256' = options.config.requireAuth ? 'sha256' : 'plain';
  // Build a "default device" record on the fly when requireAuth is disabled,
  // so the rest of the system can still treat the request as authenticated.
  const defaultTenantId = 'tenant_default';

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions?.url ?? request.url;
    if (!url.startsWith('/api/v1/')) return;
    if (url === '/api/v1/health') return;

    if (!options.config.requireAuth) {
      // Dev mode: synthesize a default device identity.
      request.authDevice = {
        deviceId: 'dev-device',
        tenantId: defaultTenantId,
        type: 'rest',
        name: 'dev-local'
      };
      return;
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' }
      });
    }
    const hash = hashApiKey(token, hashStrategy);
    const device = deviceRepo.findByKeyHash(hash);
    if (!device) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' }
      });
    }
    deviceRepo.touch(device.id);
    request.authDevice = {
      deviceId: device.id,
      tenantId: device.tenantId,
      type: device.type,
      name: device.name
    };
  });
}
