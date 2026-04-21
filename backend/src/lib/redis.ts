import Redis from 'ioredis';

/**
 * Redis client factory. In tests we inject an in-memory stub via
 * {@link setRedisClient} to avoid requiring a live server.
 */

export interface RedisLike {
  zadd(key: string, score: number, member: string): Promise<number | string>;
  zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number>;
  zcard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    duration: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

let singleton: RedisLike | null = null;

export function setRedisClient(client: RedisLike | null): void {
  singleton = client;
}

export function getRedisClient(): RedisLike {
  if (singleton) return singleton;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL not set and no redis client injected. Call setRedisClient() in tests.',
    );
  }
  singleton = new Redis(url) as unknown as RedisLike;
  return singleton;
}
