import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { expandPath, loadConfig } from '../core/config.js';
import { createHttpServer } from './http.js';
import { startConsolidationScheduler } from './scheduler.js';
import { startEmbedderWorker } from '../workers/embedder.js';
import { createLlmProvider } from '../providers/llm/index.js';
import type { LlmProvider } from '../providers/llm/index.js';
import { createEmbeddingProvider } from '../providers/embedding/index.js';
import type { EmbeddingProvider } from '../providers/embedding/index.js';
import { logger } from './logger.js';

// Resolution order for the config file:
//   1. $MEMWEAVE_CONFIG (explicit override)
//   2. ~/.memweave/config.jsonc (the default `memweave init` target)
// Without step 2, a global `npm i -g @mem-weave/server` install would silently
// fall back to schema defaults and the user has no signal that their config
// file was ignored.
const explicit = process.env.MEMWEAVE_CONFIG;
const fallback = join(homedir(), '.memweave', 'config.jsonc');
const configPath = explicit ?? (existsSync(fallback) ? fallback : undefined);
const config = loadConfig(configPath);
const dbPath = expandPath(config.storage.path);

// ── Provider bus ───────────────────────────────────────────────────────────
// Construct the LLM + embedding providers ONCE at startup. This is the wiring
// that was previously missing: createLlmProvider/createEmbeddingProvider were
// defined but never called, so every LLM/embedding-dependent worker
// (compressor, graph-worker, embedder, value-gate LLM version) was dead code.
//
// The providers are passed into createHttpServer (for MCP tools / REST search)
// and startConsolidationScheduler (for the consolidation pipeline). They are
// also exported for any future worker that needs them.
const llmProvider: LlmProvider = await createLlmProvider(config.llm.provider, config.llm as Record<string, unknown>);
const embeddingProvider: EmbeddingProvider = createEmbeddingProvider({
  kind: config.embedding.provider,
  baseUrl: config.embedding.baseUrl,
  apiKey: config.embedding.apiKey,
  model: config.embedding.model,
  dimensions: config.embedding.dimensions
});
logger.info(
  { llm: config.llm.provider, embedding: config.embedding.provider, dims: config.embedding.dimensions },
  'providers initialized'
);

// Exported so workers / tests can access the process-wide providers without
// re-constructing them (which would re-trigger Ollama ensure / model load).
export const providers = { llm: llmProvider, embedding: embeddingProvider };

const app = await createHttpServer({ dbPath, configPath, llmProvider, embeddingProvider });

// Background consolidation: every 6 hours, also run once on startup so any
// pending promotions/evictions are applied. Disable by setting MEMWEAVE_NO_SCHEDULER=1.
if (process.env.MEMWEAVE_NO_SCHEDULER !== '1') {
  const scheduler = startConsolidationScheduler({
    dbPath,
    intervalMs: 6 * 60 * 60 * 1000,
    runOnStart: true,
    llmProvider,
    embeddingProvider,
    onRun: (r) => {
      logger.info({ event: 'consolidation', ...r }, r.summary);
    }
  });

  // Stop the scheduler gracefully on process exit
  const shutdown = (): void => {
    scheduler.stop();
    embedderHandle?.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // ── Background embedder worker ─────────────────────────────────────────
  // Backfills vectors for memories that don't yet have one. Previously this
  // worker was NEVER started (startEmbedderWorker was defined but uncalled),
  // so the memory_vectors table stayed empty and the vector layer had nothing
  // to search. The enricher also embeds on its own writes, but this worker is
  // the catch-all for memories created before enrichment or when the enricher
  // is disabled. Skip when the embedding provider is noop (no point embedding
  // with a hash vector) or when MEMWEAVE_NO_EMBEDDER=1.
  let embedderHandle: ReturnType<typeof startEmbedderWorker> | undefined;
  const isNoopEmbedding = config.embedding.provider === 'noop';
  if (process.env.MEMWEAVE_NO_EMBEDDER !== '1' && !isNoopEmbedding) {
    embedderHandle = startEmbedderWorker({
      dbPath,
      provider: embeddingProvider,
      dimensions: config.embedding.dimensions,
      intervalMs: 5 * 60 * 1000, // every 5 minutes
      runOnStart: true
    });
    logger.info({ dims: config.embedding.dimensions, interval: '5m' }, 'embedder worker started');
  }
}

await app.listen({ host: config.server.host, port: config.server.port });
logger.info({ host: config.server.host, port: config.server.port }, 'memweave server listening');
