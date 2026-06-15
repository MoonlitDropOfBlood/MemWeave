import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db/database.js';
import { buildMcpHandler } from '../mcp/index.js';
import { logger } from './logger.js';
import { registerInjectionRoute } from '../rest/routes/injection.js';
import { registerMemoriesRoute } from '../rest/routes/memories.js';
import { registerStatsRoute } from '../rest/routes/stats.js';
import { registerSessionsRoute } from '../rest/routes/sessions.js';
import { registerObservationsRoute } from '../rest/routes/observations.js';
import { registerConsolidationRoute } from '../rest/routes/consolidation.js';
import { registerDevicesRoute } from '../rest/routes/devices.js';
import { registerSettingsRoute } from '../rest/routes/settings.js';

export interface CreateHttpServerOptions {
  dbPath: string;
  /** Path to config.jsonc (used by /api/v1/settings). */
  configPath?: string;
}

export async function createHttpServer(options: CreateHttpServerOptions) {
  const app = Fastify({ logger: false });
  const db = openDatabase(options.dbPath);

  db.prepare('INSERT OR IGNORE INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('tenant_default', 'default', 'dev-local-key', Date.now());

  app.addHook('onClose', async () => db.close());

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues
        }
      });
    }
    // Log the real cause so /mcp debugging is possible. Pino is the
    // structured logger the rest of the server uses; the request log
    // includes URL + method which is enough to spot which route blew up.
    logger.error({
      err: { message: (error as Error).message, stack: (error as Error).stack },
      url: request.url,
      method: request.method
    }, 'request failed');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  });

  registerMemoriesRoute(app, options.dbPath);
  registerInjectionRoute(app, options.dbPath);
  registerStatsRoute(app, options.dbPath);
  registerSessionsRoute(app, options.dbPath);
  registerObservationsRoute(app, options.dbPath);
  registerConsolidationRoute(app, options.dbPath);
  registerDevicesRoute(app, options.dbPath);
  registerSettingsRoute(app, options.configPath);

  // MCP endpoint — Streamable HTTP transport at /mcp. Each POST
  // opens a fresh MCP server + transport pair (stateless mode),
  // backed by an McpService that talks to the in-process SQLite
  // via repos. See ../mcp/index.ts for the handler implementation.
  // ── MCP endpoint ─────────────────────────────────────────────────────
  // The MCP spec allows BOTH a single JSON object per request AND
  // newline-delimited JSON (one batched request can carry many
  // JSON-RPC messages). Fastify's built-in JSON parser only handles
  // the first form; the NDJSON form would error out. The MCP handler
  // reads the raw body itself (we still keep Fastify's default JSON
  // parser active for the REST routes — they're strict JSON).
  const handleMcp = buildMcpHandler({ db });
  app.post('/mcp', async (req, reply) => {
    await handleMcp(req, reply);
  });
  app.get('/mcp', async (req, reply) => {
    // SSE-streaming variant: clients that hold a long-lived
    // Streamable HTTP connection use GET to receive server-pushed
    // notifications. The SDK handler manages the rest.
    await handleMcp(req, reply);
  });
  app.delete('/mcp', async (req, reply) => {
    await handleMcp(req, reply);
  });

  // Serve the Web UI (SPA) at /ui/*
  // web/ builds to ../dist/web/ relative to the repo root.
  // We resolve from this file's location so the path is stable regardless of cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  // src/server → ../../ → repo root → dist/web
  const webDist = resolve(here, '../../dist/web');

  // Read version from package.json (at packages/server/package.json)
  const pkgPath = resolve(here, '../../package.json');
  const serverVersion = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }).version ?? '0.0.0'
    : '0.0.0';

  app.get('/api/v1/health', async () => ({ ok: true, service: 'memweave-server', version: serverVersion }));

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/ui/',
      decorateReply: true
    });
    // SPA fallback: any GET under /ui/* that didn't match a file → index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/ui/') && request.method === 'GET') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No route' } });
    });
  } else {
    // Dev mode: tell the user how to build the SPA.
    app.get('/ui/*', async (_req, reply) => {
      return reply.code(503).send({
        error: {
          code: 'UI_NOT_BUILT',
          message: 'Run `npm run web:build` (or `npm run web:dev` on :5173) to serve the SPA.'
        }
      });
    });
  }

  return app;
}
