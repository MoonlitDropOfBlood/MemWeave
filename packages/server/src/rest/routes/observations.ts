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

// v0.5.4: observations now carry a `scopes` array. The consolidation
// worker inherits these onto the promoted memory so project-scoped
// searches / dashboard filters work without re-classification.
const ScopeTagInputSchema = z.object({
  key: z.enum(['project', 'domain', 'topic']),
  value: z.string().min(1).max(200)
});

const CreateObservationSchema = z.object({
  sessionId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  /** Hook type (open-ended: 'chat.user', 'chat.assistant', 'chat.tool', 'post_tool_use', etc.). */
  hookType: z.string().min(1).max(100),
  text: z.string().min(1).max(200_000),
  toolName: z.string().min(1).max(200).optional(),
  toolInput: z.string().max(200_000).optional(),
  toolOutput: z.string().max(200_000).optional(),
  scopes: z.array(ScopeTagInputSchema).max(20).default([])
});

export function registerObservationsRoute(app: FastifyInstance, dbPath: string): void {
  const obsRepo = new ObservationRepo(openDatabase(dbPath));

  app.get('/api/v1/observations', async (request, reply) => {
    const query = ListQuerySchema.parse(request.query);
    const list = query.unprocessedOnly
      ? obsRepo.listUnprocessed(TENANT_DEFAULT, query.limit)
      : obsRepo.listUnprocessed(TENANT_DEFAULT, query.limit); // v1: same path; v1.1 will add a "list all" method
    return reply.code(200).send({ observations: list, total: list.length });
  });

  app.post('/api/v1/observations', async (request, reply) => {
    const body = CreateObservationSchema.parse(request.body);
    // For chat.* observations, the message id + role get stashed into
    // `tool_input` as a small JSON envelope so the idempotency check
    // (sessionId, messageId) can locate the existing record without a
    // schema change. The actual chat body lives in `tool_output`.
    // v0.5.4: scopes get persisted to scopes_json so consolidation
    // can inherit them onto the promoted memory.
    const envelope: Record<string, unknown> = { messageId: body.messageId };
    if (body.toolInput) envelope.toolInput = body.toolInput;
    if (body.toolName) envelope.toolName = body.toolName;
    if (body.scopes.length > 0) envelope.scopes = body.scopes;
    const toolInput = JSON.stringify(envelope);
    const scopesJson = JSON.stringify(body.scopes);
    const { record, created } = obsRepo.createOrGetByMessageId({
      sessionId: body.sessionId,
      tenantId: TENANT_DEFAULT,
      hookType: body.hookType,
      toolName: body.toolName ?? null,
      toolInput,
      toolOutput: body.text,
      memoryId: null,
      messageId: body.messageId,
      scopes: scopesJson
    });
    return reply.code(created ? 201 : 200).send({ observation: record, created });
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

