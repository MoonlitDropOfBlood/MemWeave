import { openDatabase } from '../db/database.js';
import { runConsolidation, type ConsolidationResult } from '../workers/consolidator.js';
import { enrichMemories } from '../workers/enricher.js';
import { ConsolidationRunRepo } from '../db/repositories/consolidation-run-repo.js';
import type { LlmProvider } from '../providers/llm/index.js';
import type { EmbeddingProvider } from '../providers/embedding/index.js';
import { logger } from './logger.js';

export interface SchedulerOptions {
  dbPath: string;
  /** Run interval in milliseconds. Default: 6 hours. */
  intervalMs?: number;
  /** Tenant ID to consolidate. Default: 'tenant_default'. */
  tenantId?: string;
  /** Run immediately on start. Default: false. */
  runOnStart?: boolean;
  /** LLM provider (for the enrichment phase — wired up in batch C). */
  llmProvider?: LlmProvider;
  /** Embedding provider (for the embedder worker — wired up in batch C/D). */
  embeddingProvider?: EmbeddingProvider;
  /** Callback fired after each run. Useful for logging. */
  onRun?: (result: { promoted: number; evicted: number; summary: string; timestamp: number }) => void;
  /** Abort signal for graceful shutdown. */
  signal?: AbortSignal;
}

export interface SchedulerHandle {
  stop(): void;
  /** Manually trigger a consolidation run (does not affect the interval). */
  runNow(): Promise<{ promoted: number; evicted: number; summary: string; timestamp: number }>;
}

/**
 * Starts a background consolidation loop. Returns a handle with stop() and runNow().
 *
 * Default interval: 6 hours. Default: does NOT run on start (set `runOnStart: true` to run once immediately).
 *
 * Each run is persisted to the `consolidation_runs` table so the Web UI's
 * Sleep page can render a history.
 */
export function startConsolidationScheduler(options: SchedulerOptions): SchedulerHandle {
  const interval = options.intervalMs ?? 6 * 60 * 60 * 1000;
  const tenantId = options.tenantId ?? 'tenant_default';
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function runOnce(): Promise<{ promoted: number; evicted: number; summary: string; timestamp: number }> {
    const startedAt = Date.now();
    const db = openDatabase(options.dbPath);
    try {
      const result: ConsolidationResult = runConsolidation(db, tenantId);
      const endedAt = Date.now();

      // Persist the run for the Sleep UI page. Swallow errors so the scheduler
      // loop stays alive even if the runs table is somehow missing.
      try {
        const runRepo = new ConsolidationRunRepo(db);
        runRepo.record({
          tenantId,
          startedAt,
          endedAt,
          promoted: result.promotedIds,
          evicted: result.evictedIds,
          merged: result.mergedPairs,
          edgesCreated: 0,
          contradictionFound: 0,
          dryRun: false,
          summary: result.summary
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'failed to record consolidation run');
      }

      const payload = {
        promoted: result.promoted,
        evicted: result.evicted,
        summary: result.summary,
        timestamp: endedAt
      };
      options.onRun?.(payload);

      // ── Async LLM enrichment (fire-and-forget) ──────────────────────────
      // After the synchronous rule-based consolidation, run the LLM enrichment
      // pass: generate real title/summary/concepts for memories that still have
      // raw-conversation text or empty concepts. This is the fix for the
      // "975/1015 memories have empty concepts" data-quality problem.
      //
      // Runs on its own DB connection (the main one closes in `finally` below)
      // and is NOT awaited — we don't want a slow LLM to block the next
      // scheduler interval. Failures are logged but never abort the run.
      if (options.llmProvider && !(options.llmProvider instanceof Object && 'call' in options.llmProvider && options.llmProvider.constructor.name === 'NoopLlmProvider')) {
        void enrichMemories(options.dbPath, tenantId, options.llmProvider, options.embeddingProvider)
          .then((r) => {
            if (r.enriched > 0) logger.info({ enriched: r.enriched, failed: r.failed }, 'enrichment pass complete');
          })
          .catch((err) => logger.warn({ err: (err as Error).message }, 'enrichment pass failed (non-fatal)'));
      }

      return payload;
    } finally {
      db.close();
    }
  }
  const runNow = runOnce;

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } catch (err) {
        // Swallow errors in background; the next interval will try again.
        // We intentionally do not throw here to keep the scheduler alive.
        logger.error({ err }, 'consolidation run failed');
      }
      schedule();
    }, interval);
  }

  // Listen for abort
  if (options.signal) {
    if (options.signal.aborted) {
      stopped = true;
    } else {
      options.signal.addEventListener('abort', () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      });
    }
  }

  if (options.runOnStart) {
    void runOnce();
  }
  schedule();

  const handle: SchedulerHandle = {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    runNow
  };
  return handle;
}
