import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { DeviceRepo } from '../../db/repositories/device-repo.js';
import { hashApiKey } from '../../server/auth.js';

const TENANT_DEFAULT = 'tenant_default';

const CreateBodySchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['opencode', 'cursor', 'claude_code', 'rest'])
});

const IdParamSchema = z.object({ id: z.string().min(1) });

export function registerDevicesRoute(app: FastifyInstance, dbPath: string): void {
  const deviceRepo = new DeviceRepo(openDatabase(dbPath));

  app.get('/api/v1/devices', async (_request, reply) => {
    const list = deviceRepo.list(TENANT_DEFAULT);
    return reply.code(200).send({ devices: list, total: list.length });
  });

  app.post('/api/v1/devices', async (request, reply) => {
    const body = CreateBodySchema.parse(request.body);
    // Generate a random 32-byte hex key (256 bits). The plain key is
    // returned to the caller EXACTLY ONCE; only the SHA-256 hash is stored.
    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = hashApiKey(apiKey, 'sha256');
    const device = deviceRepo.create({
      tenantId: TENANT_DEFAULT,
      name: body.name,
      type: body.type,
      apiKeyHash
    });
    return reply.code(201).send({
      device,
      apiKey, // <-- returned only on creation
      notice: 'This is the only time the API key will be shown. Store it securely.'
    });
  });

  app.delete('/api/v1/devices/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const existing = deviceRepo.getById(TENANT_DEFAULT, id);
    if (!existing) {
      return reply.code(404).send({
        error: { code: 'DEVICE_NOT_FOUND', message: `Device ${id} not found` }
      });
    }
    deviceRepo.delete(id);
    return reply.code(200).send({ ok: true, deviceId: id });
  });
}
