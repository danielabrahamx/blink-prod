import type { RedisLike } from './redis.js';

/**
 * In-process Redis stub used in tests and dev-without-redis. Implements
 * only the subset of commands the rate limiter and nonce store require.
 */
export class MemoryRedis implements RedisLike {
  private sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  private kv = new Map<string, { value: string; expiresAt: number | null }>();

  private purgeExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.kv) {
      if (v.expiresAt !== null && v.expiresAt <= now) this.kv.delete(k);
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const arr = this.sortedSets.get(key) ?? [];
    const idx = arr.findIndex((e) => e.member === member);
    if (idx >= 0) {
      arr[idx] = { score, member };
      this.sortedSets.set(key, arr);
      return 0;
    }
    arr.push({ score, member });
    arr.sort((a, b) => a.score - b.score);
    this.sortedSets.set(key, arr);
    return 1;
  }

  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    const arr = this.sortedSets.get(key);
    if (!arr) return 0;
    const minN = typeof min === 'number' ? min : Number.parseFloat(min);
    const maxN = typeof max === 'number' ? max : Number.parseFloat(max);
    const before = arr.length;
    const kept = arr.filter((e) => e.score < minN || e.score > maxN);
    this.sortedSets.set(key, kept);
    return before - kept.length;
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.length ?? 0;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async set(
    key: string,
    value: string,
    _mode: 'EX',
    duration: number,
    nx: 'NX',
  ): Promise<'OK' | null> {
    this.purgeExpired();
    if (nx === 'NX' && this.kv.has(key)) return null;
    this.kv.set(key, {
      value,
      expiresAt: Date.now() + duration * 1000,
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.purgeExpired();
    return this.kv.get(key)?.value ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) n += 1;
      if (this.sortedSets.delete(k)) n += 1;
    }
    return n;
  }
}
