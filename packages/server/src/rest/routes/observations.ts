import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { ObservationRepo } from '../../db/repositories/observation-repo.js';

const TENANT_DEFAULT = 'tenant_default';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  unprocessedOnly: z.coerce.boolean().default(false)
});

const IdParamSchema = z.object({ id: z.string().min(1) });

export function registerObservationsRoute(app: FastifyInstance, dbPath: string): void {
  const obsRepo = new ObservationRepo(openDatabase(dbPath));

  app.get('/api/v1/observations', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const list = query.unprocessedOnly
      ? obsRepo.listUnprocessed(TENANT_DEFAULT, query.limit)
      : obsRepo.listUnprocessed(TENANT_DEFAULT, query.limit); // v1: same path; v1.1 will add a "list all" method
    return reply.code(200).send({ observations: list, total: list.length });
  });

  app.get('/api/v1/observations/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const obs = obsRepo.getById(TENANT_DEFAULT, id);
    if (!obs) {
      return reply.code(404).send({
        error: { code: 'OBSERVATION_NOT_FOUND', message: `Observation ${id} not found` }
      });
    }
    return reply.code(200).send(obs);
  });
}
