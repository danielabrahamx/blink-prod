import type { Request, Response, NextFunction } from 'express';
import type { RedisLike } from '../lib/redis.js';
import { RateLimitError } from '../lib/errors.js';

/**
 * Generic Redis-backed sliding-window rate limiter middleware.
 *
 * For the specialised per-policy /signals limit (1/20s + 3/min) see
 * `src/ingest/rateLimit.ts` — that limiter is invoked from inside the
 * signals handler because the key is derived from the signed envelope body.
 *
 * This file exposes a reusable middleware for coarse-grained IP or wallet
 * buckets (login, fund, claim endpoints) that do not need the dual-window
 * semantics of the signals path.
 */

export interface RateLimiterOptions {
  /** Sliding window in ms. */
  windowMs: number;
  /** Max requests inside the window. */
  max: number;
  /** Key function; defaults to client IP. */
  keyFn?: (req: Request) => string;
  /** Injected "now" for deterministic tests. */
  nowMs?: () => number;
  /** Redis namespace prefix; scopes independent limiters on the same bucket. */
  namespace?: string;
}

const defaultKey = (req: Request): string => {
  const fwd = req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
};

export function rateLimiter(redis: RedisLike, opts: RateLimiterOptions) {
  const now = opts.nowMs ?? (() => Date.now());
  const keyFn = opts.keyFn ?? defaultKey;
  const ns = opts.namespace ?? 'http';
  const windowSec = Math.ceil(opts.windowMs / 1000) + 1;

  return async function rateLimiterMw(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const raw = keyFn(req);
      const key = `rl:${ns}:${raw}`;
      const t = now();
      await redis.zremrangebyscore(key, 0, t - opts.windowMs);
      const count = await redis.zcard(key);
      if (count >= opts.max) {
        throw new RateLimitError('too many requests', {
          windowMs: opts.windowMs,
          max: opts.max,
          count,
        });
      }
      const member = `${t}-${Math.random().toString(36).slice(2, 8)}`;
      await redis.zadd(key, t, member);
      await redis.expire(key, windowSec);
      next();
    } catch (err) {
      next(err);
    }
  };
}
