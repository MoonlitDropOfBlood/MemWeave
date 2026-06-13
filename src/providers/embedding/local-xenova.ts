import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './index.js';

// `@xenova/transformers` is an optional dependency. We import it dynamically
// (see `getExtractor` below). The ambient type declaration lives in
// `src/types/xenova.d.ts` so the compiler can resolve the dynamic import.

export interface LocalXenovaEmbeddingOptions {
  model: string;
  dimensions: number;
  /** Per-call timeout in ms. Default: 60_000. Models can be slow on first load. */
  timeoutMs?: number;
  /**
   * On any failure (missing dep, network error, model error), fall back to a
   * deterministic noop embedding. Default: true. Set to false to surface errors.
   */
  fallbackOnError?: boolean;
}

/**
 * Local-xenova embedding provider.
 *
 * Uses `@xenova/transformers` (Hugging Face Transformers.js) running in-process.
 * The dependency is **optional** — we dynamically import it on first use. If the
 * package is not installed, this provider falls back to a deterministic noop
 * embedding (with a one-time `console.warn`) so the rest of the system stays
 * functional. The user can opt back in by running:
 *
 *   npm install @xenova/transformers
 *
 * Models are loaded lazily on the first `embed()` / `embedBatch()` call and
 * cached for the lifetime of this provider instance. The first call may be slow
 * (~10–60s) while the model weights are fetched from the HF Hub and cached
 * under `node_modules/@xenova/transformers/.cache/`.
 */
export class LocalXenovaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly timeoutMs: number;
  private readonly fallbackOnError: boolean;

  /**
   * Cached pipeline. `null` until the first embed call. We cache the *promise*
   * (not the resolved value) so concurrent callers share one load.
   */
  private extractorPromise: Promise<unknown> | null = null;

  /** Set to true after we've warned the user about the missing dep. Avoids spam. */
  private warnedMissingDep = false;

  constructor(options: LocalXenovaEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fallbackOnError = options.fallbackOnError ?? true;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let extractor: unknown;
    try {
      extractor = await this.getExtractor();
    } catch (err) {
      return this.handleError(err, texts);
    }

    // Type-narrowed access to the dynamic module. The library's official types
    // are not always present, so we keep the surface narrow and adapt at runtime.
    const pipeline = extractor as {
      (text: string | string[], options: Record<string, unknown>): Promise<{ data: ArrayLike<number> | Float32Array }>
    };

    try {
      const out = await Promise.race([
        pipeline(texts, { pooling: 'mean', normalize: true }),
        this.timeoutAfter(this.timeoutMs)
      ]);
      const flat = this.toNumberArray(out.data);
      // Per-text rows. The xenova pipeline returns [batch, dim] for batches
      // and [dim] for single inputs. Normalize to [text][dim].
      const rows = texts.length === 1
        ? [this.coerceLength(flat)]
        : this.splitRows(flat, texts.length);
      return rows.map((row) => this.coerceLength(row));
    } catch (err) {
      return this.handleError(err, texts);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async getExtractor(): Promise<unknown> {
    if (this.extractorPromise) return this.extractorPromise;

    this.extractorPromise = (async () => {
      // Dynamic import: the package is an optional dependency.
      const mod = await import('@xenova/transformers').catch((err: unknown) => {
        throw new XenovaMissingError(
          `@xenova/transformers is not installed. Run \`npm install @xenova/transformers\` to enable local embeddings. (cause: ${(err as Error).message})`
        );
      });
      const pipeline = mod.pipeline;
      if (typeof pipeline !== 'function') {
        throw new XenovaMissingError(
          '@xenova/transformers was loaded but exposes no `pipeline` function — incompatible version?'
        );
      }
      return await pipeline('feature-extraction', this.model);
    })();

    return this.extractorPromise;
  }

  private handleError(err: unknown, texts: string[]): Promise<number[][]> {
    if (err instanceof XenovaMissingError) {
      if (!this.warnedMissingDep) {
        // eslint-disable-next-line no-console
        console.warn(`[local-xenova] ${err.message} — falling back to noop embeddings.`);
        this.warnedMissingDep = true;
      }
      // Reset so a future install can pick it up.
      this.extractorPromise = null;
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[local-xenova] embedding failed: ${(err as Error).message}`);
      // Reset so transient errors (network blip, OOM) can recover.
      this.extractorPromise = null;
    }
    if (!this.fallbackOnError) throw err;
    return Promise.resolve(texts.map((t) => deriveFallbackVector(t, this.dimensions)));
  }

  private toNumberArray(data: ArrayLike<number> | Float32Array): number[] {
    const out: number[] = new Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  private splitRows(flat: number[], expectedRows: number): number[][] {
    if (flat.length === 0 || expectedRows === 0) return [];
    const dim = Math.floor(flat.length / expectedRows);
    const rows: number[][] = new Array(expectedRows);
    for (let r = 0; r < expectedRows; r++) {
      rows[r] = flat.slice(r * dim, (r + 1) * dim);
    }
    return rows;
  }

  /**
   * Coerce a vector to the configured `dimensions`. If shorter, pad with zeros.
   * If longer, truncate. Matches the graceful-degrade style of vector-search.ts.
   */
  private coerceLength(vec: number[]): number[] {
    if (vec.length === this.dimensions) return vec;
    if (vec.length > this.dimensions) return vec.slice(0, this.dimensions);
    const padded = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < vec.length; i++) padded[i] = vec[i];
    return padded;
  }

  private timeoutAfter(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`local-xenova timed out after ${ms}ms`)), ms);
      // Don't keep the event loop alive just for the timeout.
      if (typeof t.unref === 'function') t.unref();
    });
  }
}

class XenovaMissingError extends Error {
  override name = 'XenovaMissingError';
}

/**
 * Deterministic vector derived from a SHA-256 hash of the input. Used as the
 * fallback when `@xenova/transformers` is unavailable. The algorithm is
 * intentionally identical to `NoopEmbeddingProvider` so the search engine sees
 * a stable embedding space across both code paths.
 */
function deriveFallbackVector(text: string, dimensions: number): number[] {
  const out: number[] = new Array(dimensions);
  let counter = 0;
  let i = 0;
  while (i < dimensions) {
    const hash = createHash('sha256').update(`${text}::${counter++}`).digest();
    for (let b = 0; b < hash.length && i < dimensions; b++, i++) {
      // Map byte to [-1, 1] deterministically.
      out[i] = (hash[b] / 255) * 2 - 1;
    }
  }
  return out;
}
