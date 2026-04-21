import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody, validateQuery } from './zodValidator.js';
import { errorHandler } from './errorHandler.js';

describe('zod validator middleware', () => {
  const bodySchema = z.object({ name: z.string().min(1), count: z.number().int() });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.post('/echo', validateBody(bodySchema), (req, res) => {
      res.json({ ok: true, body: req.body });
    });
    const querySchema = z.object({ q: z.string().min(1) });
    app.get('/search', validateQuery(querySchema), (req, res) => {
      res.json({ q: (req.query as { q: string }).q });
    });
    app.use(errorHandler());
    return app;
  }

  it('passes a valid body through and exposes parsed data', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .send({ name: 'a', count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: 'a', count: 2 });
  });

  it('rejects an invalid body with BAD_REQUEST', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .send({ name: '', count: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toBeDefined();
  });

  it('validates query params too', async () => {
    const res = await request(buildApp()).get('/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
