import type { RedisLike } from '../lib/redis.js';
import { ConflictError } from '../lib/errors.js';

/**
 * Dedup store for client_nonce values. Prevents replay and duplicate-delivery
 * of offline-queued envelopes.
 *
 * Lifetime: 24h by default (much longer than the 60s signal cadence; enough
 * to cover offline-queue flush scenarios).
 */

const DEFAULT_TTL_SEC = 60 * 60 * 24;

export interface NonceStoreOptions {
  ttlSec?: number;
}

export async function claim(
  redis: RedisLike,
  policyId: string,
  nonce: string,
  opts: NonceStoreOptions = {},
): Promise<void> {
  const key = `nonce:${policyId}:${nonce}`;
  const ttl = opts.ttlSec ?? DEFAULT_TTL_SEC;
  const res = await redis.set(key, '1', 'EX', ttl, 'NX');
  if (res !== 'OK') {
    throw new ConflictError('duplicate nonce', { policy_id: policyId, nonce });
  }
}
