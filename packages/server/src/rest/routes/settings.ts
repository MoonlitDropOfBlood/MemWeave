import type { FastifyInstance } from 'fastify';
import { expandPath, loadConfig } from '../../core/config.js';

/**
 * GET /api/v1/settings — returns the loaded config with secrets masked.
 * The UI uses this to display "read-only" configuration in the Settings page.
 */
export function registerSettingsRoute(app: FastifyInstance, configPath?: string): void {
  app.get('/api/v1/settings', async (_request, reply) => {
    const config = loadConfig(configPath);

    // Mask secrets
    const maskIfString = (v: string | undefined): string | undefined => (v ? '***' : v);
    return reply.code(200).send({
      server: config.server,
      storage: { ...config.storage, path: expandPath(config.storage.path) },
      auth: {
        ...config.auth,
        deviceApiKey: maskIfString(config.auth.deviceApiKey)
      },
      embedding: { ...config.embedding, apiKey: maskIfString(config.embedding.apiKey) },
      llm: { ...config.llm, apiKey: maskIfString(config.llm.apiKey) },
      consolidation: config.consolidation,
      injection: config.injection,
      search: config.search
    });
  });
}
