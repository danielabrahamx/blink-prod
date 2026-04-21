import { describe, it, expect } from 'vitest';
import { MemoryRedis } from '../lib/memoryRedis.js';
import { checkAndRecord, enforceOrThrow } from './rateLimit.js';

describe('rateLimit', () => {
  it('allows first request', async () => {
    const r = new MemoryRedis();
    const res = await checkAndRecord(r, 'pol_1');
    expect(res.allowed).toBe(true);
    expect(res.short_count).toBe(1);
    expect(res.long_count).toBe(1);
  });

  it('blocks a second request within 20s (short window)', async () => {
    const r = new MemoryRedis();
    let now = 1_000_000;
    const nowMs = () => now;
    await checkAndRecord(r, 'pol_1', { nowMs });
    now += 5_000; // 5s later
    const res = await checkAndRecord(r, 'pol_1', { nowMs });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('short_window');
  });

  it('allows after 20s short window elapses', async () => {
    const r = new MemoryRedis();
    let now = 1_000_000;
    const nowMs = () => now;
    await checkAndRecord(r, 'pol_1', { nowMs });
    now += 21_000;
    const res = await checkAndRecord(r, 'pol_1', { nowMs });
    expect(res.allowed).toBe(true);
  });

  it('blocks a fourth request within the long window', async () => {
    // Shrink the short window so the test can queue three entries inside a
    // single long window without hitting the 1/20s cap.
    const opts = { shortWindowMs: 500, longWindowMs: 60_000 };
    const r = new MemoryRedis();
    let now = 1_000_000;
    const nowMs = () => now;
    for (let i = 0; i < 3; i += 1) {
      const res = await checkAndRecord(r, 'pol_1', { ...opts, nowMs });
      expect(res.allowed).toBe(true);
      now += 1_000;
    }
    // t=3s: long window still holds three entries; fourth must be denied.
    const fourth = await checkAndRecord(r, 'pol_1', { ...opts, nowMs });
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe('long_window');
  });

  it('enforceOrThrow throws on deny', async () => {
    const r = new MemoryRedis();
    await enforceOrThrow(r, 'pol_1');
    await expect(enforceOrThrow(r, 'pol_1')).rejects.toThrow(/rate limit/);
  });

  it('separates policies', async () => {
    const r = new MemoryRedis();
    await checkAndRecord(r, 'pol_1');
    const res = await checkAndRecord(r, 'pol_2');
    expect(res.allowed).toBe(true);
  });
});
