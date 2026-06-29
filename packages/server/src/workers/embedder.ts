import { openDatabase } from '../db/database.js';
import { VectorRepo } from '../db/repositories/vector-repo.js';
import type { EmbeddingProvider } from '../providers/embedding/index.js';
import { logger } from '../server/logger.js';

export interface EmbedderOptions {
  dbPath: string;
  provider: EmbeddingProvider;
  /** Embedding vector dimensions (must match `provider.dimensions`). */
  dimensions: number;
  /** Tenant id (default: 'tenant_default'). */
  tenantId?: string;
  /** Max memories to embed per run. Default: 16. */
  batchSize?: number;
  /** Poll interval between runs in milliseconds. Default: 30s. */
  intervalMs?: number;
  /** Run immediately on start. Default: false. */
  runOnStart?: boolean;
  /** Abort signal for graceful shutdown. */
  signal?: AbortSignal;
  /** Callback fired after each run. */
  onRun?: (result: { embedded: number; skipped: number; failed: number; timestamp: number }) => void;
}

export interface EmbedderHandle {
  stop(): void;
  runNow(): Promise<{ embedded: number; skipped: number; failed: number; timestamp: number }>;
}

interface MemoryRowForEmbedding {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  summary: string;
  concepts_text: string | null;
}

/**
 * Background embedder worker.
 *
 * Polls the `memories` table for rows that don't yet have a corresponding
 * entry in the `memory_vectors` table, generates embeddings via the
 * configured provider, and writes them as Float32Array BLOBs.
 *
 * When the embedding provider is `noop`, this is effectively a no-op for
 * actual embeddings but the loop still runs so the structure is exercised.
 */
export function startEmbedderWorker(options: EmbedderOptions): EmbedderHandle {
  const tenantId = options.tenantId ?? 'tenant_default';
  const batchSize = options.batchSize ?? 16;
  const interval = options.intervalMs ?? 30_000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function runOnce(): Promise<{ embedded: number; skipped: number; failed: number; timestamp: number }> {
    const db = openDatabase(options.dbPath, { vectorDimensions: options.dimensions });
    const result = { embedded: 0, skipped: 0, failed: 0, timestamp: Date.now() };
    try {
      const vecRepo = new VectorRepo(db, options.dimensions);
      // Find candidate memories that lack a vector entry for the active
      // dimension. memory_vectors is a single table keyed by (memory_id,
      // dimensions), so the LEFT JOIN filters on both.
      const candidates = db.prepare(`
        SELECT m.id, m.tenant_id, m.title, m.content, m.summary, m.concepts_text
        FROM memories m
        LEFT JOIN memory_vectors v ON v.memory_id = m.id AND v.dimensions = ?
        WHERE m.tenant_id = ? AND m.deleted_at IS NULL AND v.memory_id IS NULL
        ORDER BY m.created_at ASC
        LIMIT ?
      `).all(options.dimensions, tenantId, batchSize) as MemoryRowForEmbedding[];

      if (candidates.length > 0) {
        const texts = candidates.map((m) => [m.title, m.summary, m.content, m.concepts_text ?? ''].filter(Boolean).join('\n'));
        try {
          const vectors = await options.provider.embedBatch(texts);
          for (let i = 0; i < candidates.length; i++) {
            const m = candidates[i];
            const v = vectors[i];
            if (!v) {
              result.failed++;
              continue;
            }
            try {
              vecRepo.upsert(m.id, m.tenant_id, v);
              result.embedded++;
            } catch {
              result.failed++;
            }
          }
        } catch (err) {
          logger.error({ err: (err as Error).message }, 'batch embedding failed');
          result.failed = candidates.length;
        }
      }
    } finally {
      db.close();
    }
    options.onRun?.(result);
    return result;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } catch (err) {
        logger.error({ err }, 'run failed');
      }
      schedule();
    }, interval);
  }

  if (options.signal) {
    if (options.signal.aborted) stopped = true;
    else options.signal.addEventListener('abort', () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });
  }

  if (options.runOnStart) {
    void runOnce();
  }
  schedule();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    runNow: runOnce
  };
}
