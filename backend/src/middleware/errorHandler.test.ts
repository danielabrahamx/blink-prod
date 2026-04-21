import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import pino from 'pino';
import { errorHandler, notFoundHandler } from './errorHandler.js';
import {
  BadRequestError,
  ConflictError,
  RateLimitError,
  UnauthorizedError,
  NotImplementedError,
} from '../lib/errors.js';

function build(handler: express.RequestHandler) {
  const app = express();
  // attach silent logger so error handler can call req.log.* without crashing
  const log = pino({ level: 'silent' });
  app.use((req, _res, next) => {
    (req as unknown as { log: pino.Logger }).log = log;
    next();
  });
  app.get('/boom', handler);
  app.use(notFoundHandler);
  app.use(errorHandler());
  return app;
}

describe('errorHandler', () => {
  it('maps BadRequestError to 400', async () => {
    const app = build((_req, _res, next) => next(new BadRequestError('bad input')));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toBe('bad input');
  });

  it('maps UnauthorizedError to 401', async () => {
    const app = build((_req, _res, next) => next(new UnauthorizedError()));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('maps ConflictError to 409', async () => {
    const app = build((_req, _res, next) => next(new ConflictError('dup')));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('maps RateLimitError to 429', async () => {
    const app = build((_req, _res, next) => next(new RateLimitError()));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('maps NotImplementedError to 501', async () => {
    const app = build((_req, _res, next) => next(new NotImplementedError('later')));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('maps ZodError to 400 with field details', async () => {
    const app = build((_req, _res, next) => {
      try {
        z.object({ x: z.string() }).parse({ x: 42 });
      } catch (e) {
        next(e);
        return;
      }
      next();
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toBeDefined();
  });

  it('maps unknown errors to 500', async () => {
    const app = build((_req, _res, next) => next(new Error('weird')));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('notFoundHandler returns 404 with path', async () => {
    const app = build((_req, _res, next) => next());
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.path).toBe('/nope');
  });
});
