import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { SessionRepo } from '../../db/repositories/session-repo.js';

const TENANT_DEFAULT = 'tenant_default';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20)
});

const IdParamSchema = z.object({ id: z.string().min(1) });

export function registerSessionsRoute(app: FastifyInstance, dbPath: string): void {
  const sessionRepo = new SessionRepo(openDatabase(dbPath));

  app.get('/api/v1/sessions', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const list = sessionRepo.listRecent(TENANT_DEFAULT, query.limit);
    return reply.code(200).send({ sessions: list, total: list.length });
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
