import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../db/database.js';
import { MemoryRepo } from '../../db/repositories/memory-repo.js';
import { EdgeRepo } from '../../db/repositories/edge-repo.js';
import { AccessLogRepo } from '../../db/repositories/access-log-repo.js';
import { searchMemories } from '../../retrieval/search-engine.js';
import type { MemoryType, ScopeKey, MemoryTier, EdgeType } from '../../core/types.js';
import { EdgeTypeSchema } from '../../core/types.js';
import { RateLimiter } from '../../server/rate-limiter.js';

const TENANT_DEFAULT = 'tenant_default';

/**
 * Per-tenant rate limiter for memory_write endpoints. The bucket is keyed
 * by the API key (per device) so a misbehaving client cannot exhaust
 * the bucket for an honest one. Defaults: 30 writes/minute burst, 2/sec
 * sustained. Tuned for the "one memory per conversational turn" pattern;
 * an LLM calling memory_save on every tool use fits comfortably.
 */
const writeLimiter: RateLimiter = new RateLimiter({
  capacity: 30,
  refillPerSecond: 2
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.string().optional(),
  tier: z.string().optional()
});

const SearchBodySchema = z.object({
  query: z.string().default(''),
  limit: z.number().int().min(1).max(50).optional(),
  scope: z.object({
    project: z.string().optional(),
    domain: z.string().optional(),
    topic: z.string().optional()
  }).optional(),
  types: z.array(z.string()).optional(),
  mode: z.enum(['compact', 'full']).optional()
});

const UpdateBodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(1).optional(),
  summary: z.string().min(1).max(500).optional(),
  importance: z.number().int().min(1).max(10).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const GraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(1),
  edgeTypes: z.string().optional(),
  direction: z.enum(['in', 'out', 'both']).default('both'),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

const AccessLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export function registerMemoriesRoute(app: FastifyInstance, dbPath: string): void {
  const memoryRepo = new MemoryRepo(openDatabase(dbPath));
  const edgeRepo = new EdgeRepo(openDatabase(dbPath));
  const accessLogRepo = new AccessLogRepo(openDatabase(dbPath));

  // GET /api/v1/memories — list
  app.get('/api/v1/memories', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const db = openDatabase(dbPath);
    try {
      let sql = 'SELECT * FROM memories WHERE tenant_id = ? AND deleted_at IS NULL';
      const params: unknown[] = [TENANT_DEFAULT];

      if (query.type) {
        sql += ' AND type = ?';
        params.push(query.type);
      }
      if (query.tier) {
        sql += ' AND tier = ?';
        params.push(query.tier);
      }

      const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as cnt');
      const total = (db.prepare(countSql).get(...params) as { cnt: number }).cnt;

      sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?';
      params.push(query.limit, query.offset);

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const memories = rows.map((row) => memoryRepo.getById(TENANT_DEFAULT, row.id as string));
      return reply.code(200).send({ memories, total, limit: query.limit, offset: query.offset });
    } finally {
      db.close();
    }
  });

  // POST /api/v1/memories — create (was in http.ts originally, kept here for cohesion)
  app.post('/api/v1/memories', async (request, reply) => {
    // Rate-limit by the authenticated device. Pre-bucket — even if Zod
    // validation fails, the request counts against the limit, since a
    // flood of invalid writes is still a flood.
    const apiKey = (request.headers['x-api-key'] as string | undefined) ?? 'anonymous';
    const limitResult = writeLimiter.consume(apiKey);
    if (!limitResult.allowed) {
      return reply
        .code(429)
        .header('Retry-After', String(limitResult.retryAfterSec))
        .send({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many writes. Retry after ${limitResult.retryAfterSec}s.`
          }
        });
    }

    const { CreateMemoryInputSchema } = await import('../../core/types.js');
    const input = CreateMemoryInputSchema.parse({
      ...(request.body as Record<string, unknown>),
      tenantId: TENANT_DEFAULT
    });
    try {
      const memory = memoryRepo.create(input);
      return reply.code(201).send({
        memoryId: memory.id,
        type: memory.type,
        tier: memory.tier,
        title: memory.title,
        summary: memory.summary,
        createdEdges: []
      });
    } catch (err) {
      // UUID v4 collision is astronomically unlikely, but a PRIMARY KEY
      // constraint failure is recoverable: re-throw as a clean 500 with
      // a hint, not the raw SQLite error.
      const msg = (err as Error).message ?? '';
      if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
        return reply.code(500).send({
          error: {
            code: 'ID_COLLISION',
            message: 'Failed to generate a unique memory id. Please retry.'
          }
        });
      }
      throw err;
    }
  });

  // POST /api/v1/memories/search
  app.post('/api/v1/memories/search', async (request, reply) => {
    const body = SearchBodySchema.parse(request.body);
    const db = openDatabase(dbPath);
    try {
      const search = await searchMemories(db, TENANT_DEFAULT, {
        query: body.query,
        limit: body.limit ?? 8,
        scope: body.scope as Partial<Record<ScopeKey, string>> | undefined,
        types: body.types as MemoryType[] | undefined
      });
      const mode = body.mode ?? 'compact';
      const results = search.results.map((r) => {
        const base = {
          memoryId: r.candidate.memory.id,
          type: r.candidate.memory.type,
          tier: r.candidate.memory.tier as MemoryTier,
          title: r.candidate.memory.title,
          summary: r.candidate.memory.summary,
          finalScore: r.finalScore,
          sources: Array.from(r.candidate.sources)
        };
        if (mode === 'full') {
          return {
            ...base,
            content: r.candidate.memory.content,
            importance: r.candidate.memory.importance,
            confidence: r.candidate.memory.confidence,
            strength: r.candidate.memory.strength,
            scopes: r.candidate.memory.scopes
          };
        }
        return base;
      });
      return reply.code(200).send({ results, totalCandidates: search.totalCandidates });
    } finally {
      db.close();
    }
  });

  // GET /api/v1/memories/:id
  app.get('/api/v1/memories/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const memory = memoryRepo.getById(TENANT_DEFAULT, params.id);
    if (!memory) {
      return reply.code(404).send({
        error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
      });
    }
    return memory;
  });

  // PATCH /api/v1/memories/:id
  app.patch('/api/v1/memories/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = UpdateBodySchema.parse(request.body);
    const db = openDatabase(dbPath);
    try {
      const existing = memoryRepo.getById(TENANT_DEFAULT, params.id);
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
        });
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
      if (body.content !== undefined) { updates.push('content = ?'); values.push(body.content); }
      if (body.summary !== undefined) { updates.push('summary = ?'); values.push(body.summary); }
      if (body.importance !== undefined) { updates.push('importance = ?'); values.push(body.importance); }
      if (body.confidence !== undefined) { updates.push('confidence = ?'); values.push(body.confidence); }

      if (updates.length === 0) {
        return reply.code(200).send(existing);
      }

      updates.push('updated_at = ?');
      values.push(Date.now());
      values.push(TENANT_DEFAULT, params.id);

      db.prepare(`
        UPDATE memories SET ${updates.join(', ')}
        WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
      `).run(...values);

      const updated = memoryRepo.getById(TENANT_DEFAULT, params.id);
      return reply.code(200).send(updated);
    } finally {
      db.close();
    }
  });

  // DELETE /api/v1/memories/:id — soft delete
  app.delete('/api/v1/memories/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const db = openDatabase(dbPath);
    try {
      const existing = memoryRepo.getById(TENANT_DEFAULT, params.id);
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
        });
      }
      const now = Date.now();
      db.prepare(`
        UPDATE memories SET deleted_at = ?, eviction_reason = ?
        WHERE tenant_id = ? AND id = ?
      `).run(now, 'manual_delete', TENANT_DEFAULT, params.id);
      return reply.code(200).send({ ok: true, memoryId: params.id, deletedAt: now });
    } finally {
      db.close();
    }
  });

  // GET /api/v1/memories/:id/graph
  app.get('/api/v1/memories/:id/graph', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = GraphQuerySchema.parse(request.query);

    const memory = memoryRepo.getById(TENANT_DEFAULT, params.id);
    if (!memory) {
      return reply.code(404).send({
        error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
      });
    }

    // Parse and validate edge types against EdgeTypeSchema
    const edgeTypes: EdgeType[] | undefined = query.edgeTypes
      ? query.edgeTypes.split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => {
          const r = EdgeTypeSchema.safeParse(s);
          return r.success ? [r.data] : [];
        })
      : undefined;

    const db = openDatabase(dbPath);
    try {
      const allNeighbors: ReturnType<typeof edgeRepo.getNeighbors> = [];
      const neighbors = edgeRepo.getNeighbors(TENANT_DEFAULT, params.id, query.direction, edgeTypes);
      allNeighbors.push(...neighbors);

      const seenNeighborIds = new Set<string>([params.id]);
      let frontier = neighbors.map((n) => n.neighborId);
      for (let depth = 1; depth < query.depth && frontier.length > 0; depth++) {
        const nextFrontier: string[] = [];
        for (const nid of frontier) {
          if (seenNeighborIds.has(nid)) continue;
          seenNeighborIds.add(nid);
          const next = edgeRepo.getNeighbors(TENANT_DEFAULT, nid, query.direction, edgeTypes);
          allNeighbors.push(...next);
          for (const n of next) {
            if (!seenNeighborIds.has(n.neighborId)) nextFrontier.push(n.neighborId);
          }
        }
        frontier = nextFrontier;
      }

      // Build nodes
      const nodeIds = new Set<string>([params.id]);
      for (const n of allNeighbors) nodeIds.add(n.neighborId);
      const nodes = Array.from(nodeIds).slice(0, query.limit).map((id) => {
        const m = memoryRepo.getById(TENANT_DEFAULT, id);
        return m ? {
          id: m.id,
          type: m.type,
          tier: m.tier,
          title: m.title,
          summary: m.summary
        } : null;
      }).filter(Boolean);

      // Build edges (dedupe by edgeId)
      const seenEdgeIds = new Set<string>();
      const edges = allNeighbors
        .filter((n) => nodeIds.has(n.neighborId))
        .filter((n) => {
          if (seenEdgeIds.has(n.edgeId)) return false;
          seenEdgeIds.add(n.edgeId);
          return true;
        })
        .map((n) => ({
          id: n.edgeId,
          fromMemoryId: n.direction === 'out' ? params.id : n.neighborId,
          toMemoryId: n.direction === 'out' ? n.neighborId : params.id,
          type: n.type,
          strength: n.strength,
          reason: n.reason
        }));

      return reply.code(200).send({ nodes, edges });
    } finally {
      db.close();
    }
  });

  // GET /api/v1/memories/:id/access-logs
  app.get('/api/v1/memories/:id/access-logs', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = AccessLogsQuerySchema.parse(request.query);

    const memory = memoryRepo.getById(TENANT_DEFAULT, params.id);
    if (!memory) {
      return reply.code(404).send({
        error: { code: 'MEMORY_NOT_FOUND', message: `Memory ${params.id} not found` }
      });
    }

    const logs = accessLogRepo.listForMemory(TENANT_DEFAULT, params.id, query.limit);
    return reply.code(200).send({ logs, total: logs.length });
  });
}
