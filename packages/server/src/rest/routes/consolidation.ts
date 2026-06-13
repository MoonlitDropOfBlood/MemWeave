import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { ConsolidationRunRepo } from '../../db/repositories/consolidation-run-repo.js';
import { runConsolidation } from '../../workers/consolidator.js';
import { randomUUID } from 'node:crypto';

const TENANT_DEFAULT = 'tenant_default';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20)
});

const IdParamSchema = z.object({ id: z.string().min(1) });

const TriggerBodySchema = z.object({
  dryRun: z.boolean().optional()
}).default({});

export function registerConsolidationRoute(app: FastifyInstance, dbPath: string): void {
  const runRepo = new ConsolidationRunRepo(openDatabase(dbPath));

  app.get('/api/v1/consolidate/runs', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const list = runRepo.listRecent(TENANT_DEFAULT, query.limit);
    return reply.code(200).send({ runs: list, total: list.length });
  });

  app.get('/api/v1/consolidate/runs/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const run = runRepo.getById(TENANT_DEFAULT, id);
    if (!run) {
      return reply.code(404).send({
        error: { code: 'CONSOLIDATION_RUN_NOT_FOUND', message: `Run ${id} not found` }
      });
    }
    return reply.code(200).send({ run });
  });

  app.post('/api/v1/consolidate', async (request, reply) => {
    const body = TriggerBodySchema.parse(request.body ?? {});
    const dryRun = body.dryRun ?? false;

    const db = openDatabase(dbPath);
    try {
      const startedAt = Date.now();
      const result = runConsolidation(db, TENANT_DEFAULT, { dryRun });
      const endedAt = Date.now();

      // Persist a run record so the UI can list it. (dryRun runs are also
      // recorded so the UI can show "what would have happened".)
      const id = randomUUID();
      const runRepo2 = new ConsolidationRunRepo(db);
      runRepo2.record({
        tenantId: TENANT_DEFAULT,
        startedAt,
        endedAt,
        promoted: result.promotedIds,
        evicted: result.evictedIds,
        merged: result.mergedPairs,
        edgesCreated: 0,
        contradictionFound: 0,
        dryRun,
        summary: result.summary
      });

      const run = runRepo2.getById(TENANT_DEFAULT, id);
      return reply.code(200).send({ run });
    } finally {
      db.close();
    }
  });
}
