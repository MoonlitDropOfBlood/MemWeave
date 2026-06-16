import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { SessionRepo } from '../../db/repositories/session-repo.js';

const TENANT_DEFAULT = 'tenant_default';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20)
});

const IdParamSchema = z.object({ id: z.string().min(1) });

const CreateSessionSchema = z.object({
  sessionId: z.string().min(1).max(200),
  source: z.enum(['opencode', 'cursor', 'claude_code', 'codex', 'rest_api']),
  title: z.string().min(1).max(500),
  deviceId: z.string().min(1).max(200).optional()
});

export function registerSessionsRoute(app: FastifyInstance, dbPath: string): void {
  const sessionRepo = new SessionRepo(openDatabase(dbPath));

  app.get('/api/v1/sessions', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const list = sessionRepo.listRecent(TENANT_DEFAULT, query.limit);
    return reply.code(200).send({ sessions: list, total: list.length });
  });

  app.post('/api/v1/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body);
    const { record, created } = sessionRepo.findOrCreate({
      tenantId: TENANT_DEFAULT,
      deviceId: body.deviceId ?? null,
      source: body.source,
      title: body.title,
      sessionId: body.sessionId
    });
    return reply.code(created ? 201 : 200).send({ session: record, created });
  });

  app.get('/api/v1/sessions/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const session = sessionRepo.getById(TENANT_DEFAULT, id);
    if (!session) {
      return reply.code(404).send({
        error: { code: 'SESSION_NOT_FOUND', message: `Session ${id} not found` }
      });
    }
    return reply.code(200).send(session);
  });

  app.get('/api/v1/sessions/:id/memories', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const session = sessionRepo.getById(TENANT_DEFAULT, id);
    if (!session) {
      return reply.code(404).send({
        error: { code: 'SESSION_NOT_FOUND', message: `Session ${id} not found` }
      });
    }
    const memories = sessionRepo.listMemories(TENANT_DEFAULT, id);
    return reply.code(200).send({ memories, total: memories.length });
  });
}
