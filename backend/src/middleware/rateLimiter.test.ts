import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MemoryRedis } from '../lib/memoryRedis.js';
import { rateLimiter } from './rateLimiter.js';
import { errorHandler } from './errorHandler.js';

function build(redis: MemoryRedis, max: number, windowMs: number, nowMs?: () => number) {
  const app = express();
  app.use(rateLimiter(redis, { max, windowMs, nowMs }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler());
  return app;
}

describe('rateLimiter middleware', () => {
  it('allows up to max within the window', async () => {
    const redis = new MemoryRedis();
    const app = build(redis, 2, 60_000);
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    const denied = await request(app).get('/x');
    expect(denied.status).toBe(429);
    expect(denied.body.error.code).toBe('RATE_LIMITED');
  });

  it('evicts expired entries after window rolls', async () => {
    const redis = new MemoryRedis();
    let now = 1_000_000;
    const nowMs = () => now;
    const app = build(redis, 1, 1_000, nowMs);
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
    now += 1_500;
    expect((await request(app).get('/x')).status).toBe(200);
  });

  it('separates keys by client ip', async () => {
    const redis = new MemoryRedis();
    const app = build(redis, 1, 60_000);
    expect(
      (await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1')).status,
    ).toBe(200);
    expect(
      (await request(app).get('/x').set('X-Forwarded-For', '2.2.2.2')).status,
    ).toBe(200);
    expect(
      (await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1')).status,
    ).toBe(429);
  });
});
