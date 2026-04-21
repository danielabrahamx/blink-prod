import type { RedisLike } from '../lib/redis.js';
import { RateLimitError } from '../lib/errors.js';

/**
 * Per-policy sliding-window rate limit for /signals ingest.
 *
 * Design doc Module 1: "1 envelope per policy per 20s hard, 3/min sustained
 * (Redis sliding window). Duplicate client_nonce returns 409."
 *
 * Two windows tracked in parallel:
 *   - short window: 20s, limit 1
 *   - long window: 60s, limit 3
 */

export interface RateLimitOptions {
  nowMs?: () => number;
  shortWindowMs?: number;
  shortLimit?: number;
  longWindowMs?: number;
  longLimit?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'short_window' | 'long_window';
  short_count: number;
  long_count: number;
}

const DEFAULTS = {
  shortWindowMs: 20_000,
  shortLimit: 1,
  longWindowMs: 60_000,
  longLimit: 3,
};

export async function checkAndRecord(
  redis: RedisLike,
  policyId: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const now = opts.nowMs ? opts.nowMs() : Date.now();
  const shortWindowMs = opts.shortWindowMs ?? DEFAULTS.shortWindowMs;
  const shortLimit = opts.shortLimit ?? DEFAULTS.shortLimit;
  const longWindowMs = opts.longWindowMs ?? DEFAULTS.longWindowMs;
  const longLimit = opts.longLimit ?? DEFAULTS.longLimit;

  const key = `ratelimit:signals:${policyId}`;
  // Evict anything outside the longest window.
  await redis.zremrangebyscore(key, 0, now - longWindowMs);

  // Probe window counts without inserting yet.
  // Counting via zcard gives us the long-window size; short-window requires
  // a separate evict-and-count against a short-window key.
  const shortKey = `${key}:short`;
  await redis.zremrangebyscore(shortKey, 0, now - shortWindowMs);

  const shortCount = await redis.zcard(shortKey);
  const longCount = await redis.zcard(key);

  if (shortCount >= shortLimit) {
    return {
      allowed: false,
      reason: 'short_window',
      short_count: shortCount,
      long_count: longCount,
    };
  }
  if (longCount >= longLimit) {
    return {
      allowed: false,
      reason: 'long_window',
      short_count: shortCount,
      long_count: longCount,
    };
  }

  // Allowed: record now under both windows.
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await redis.zadd(key, now, member);
  await redis.zadd(shortKey, now, member);
  await redis.expire(key, Math.ceil(longWindowMs / 1000) + 5);
  await redis.expire(shortKey, Math.ceil(shortWindowMs / 1000) + 5);

  return {
    allowed: true,
    short_count: shortCount + 1,
    long_count: longCount + 1,
  };
}

export async function enforceOrThrow(
  redis: RedisLike,
  policyId: string,
  opts: RateLimitOptions = {},
): Promise<void> {
  const r = await checkAndRecord(redis, policyId, opts);
  if (!r.allowed) {
    throw new RateLimitError(`rate limit exceeded (${r.reason})`, r);
  }
}
