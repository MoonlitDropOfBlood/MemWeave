/**
 * In-process token-bucket rate limiter. One bucket per (key, window) pair.
 * No external dependency; suitable for single-node MemWeave deployments.
 *
 * If you ever scale to multi-node, swap this for a Redis-backed limiter.
 * The interface (`RateLimiter.consume(key)` returning boolean) is the
 * only thing callers depend on.
 */

export interface RateLimitConfig {
  /** Max tokens per bucket (the burst size). */
  capacity: number;
  /** Tokens refilled per second (the steady-state rate). */
  refillPerSecond: number;
  /** Bucket sweep interval in ms. Default: 60s. Old buckets are GC'd. */
  sweepIntervalMs?: number;
}

export interface RateLimitResult {
  /** True if the call is allowed; false if it should be rejected. */
  allowed: boolean;
  /** Tokens remaining in the bucket after this attempt. */
  remaining: number;
  /** Seconds until the bucket refills by 1 token (hint for Retry-After). */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastSeenMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.capacity = config.capacity;
    this.refillPerMs = config.refillPerSecond / 1000;
    this.sweepIntervalMs = config.sweepIntervalMs ?? 60_000;
    // Periodic GC of buckets that have been idle longer than the time to
    // fully refill. Prevents the map from growing unbounded over the
    // process lifetime in long-running deployments.
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  /**
   * Attempt to consume one token. Returns whether the call is allowed.
   */
  consume(key: string, now: number = Date.now()): RateLimitResult {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now, lastSeenMs: now };
      this.buckets.set(key, bucket);
    } else {
      // Refill: add (elapsed * refillPerMs), capped at capacity.
      const elapsed = Math.max(0, now - bucket.lastRefillMs);
      const refilled = elapsed * this.refillPerMs;
      if (refilled > 0) {
        bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
        bucket.lastRefillMs = now;
      }
      bucket.lastSeenMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
    }
    // Compute how long until we have >= 1 token.
    const deficit = 1 - bucket.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / this.refillPerMs / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  /**
   * For tests / observability. Returns the number of live buckets.
   */
  size(): number {
    return this.buckets.size;
  }

  /**
   * Stop the sweep timer. Call before shutdown to allow the process to exit
   * cleanly.
   */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    // A bucket that hasn't been touched for the time-to-full-refill is
    // indistinguishable from a fresh one — drop it.
    const fullRefillMs = this.capacity / this.refillPerMs;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeenMs > fullRefillMs * 2) {
        this.buckets.delete(key);
      }
    }
  }
}
