import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestId, REQUEST_ID_HEADER } from './requestId.js';

function buildApp() {
  const app = express();
  app.use(requestId());
  app.get('/x', (req, res) => {
    res.json({ request_id: req.request_id });
  });
  return app;
}

describe('requestId middleware', () => {
  it('generates a uuid when no header is supplied', async () => {
    const res = await request(buildApp()).get('/x');
    expect(res.status).toBe(200);
    expect(res.body.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers[REQUEST_ID_HEADER]).toBe(res.body.request_id);
  });

  it('respects an incoming x-request-id header', async () => {
    const incoming = 'client-trace-abc';
    const res = await request(buildApp())
      .get('/x')
      .set(REQUEST_ID_HEADER, incoming);
    expect(res.status).toBe(200);
    expect(res.body.request_id).toBe(incoming);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(incoming);
  });

  it('falls back to a generated id when header is blank', async () => {
    const res = await request(buildApp())
      .get('/x')
      .set(REQUEST_ID_HEADER, '');
    expect(res.status).toBe(200);
    expect(res.body.request_id.length).toBeGreaterThan(10);
  });
});
