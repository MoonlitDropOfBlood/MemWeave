import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../../db/database.js';
import { StatsRepo } from '../../db/repositories/stats-repo.js';

const TENANT_DEFAULT = 'tenant_default';

export function registerStatsRoute(app: FastifyInstance, dbPath: string): void {
  app.get('/api/v1/stats', async (_request, reply) => {
    const db = openDatabase(dbPath);
    try {
      const stats = new StatsRepo(db).getStats(TENANT_DEFAULT);
      return reply.code(200).send(stats);
    } finally {
      db.close();
    }
  });
}
