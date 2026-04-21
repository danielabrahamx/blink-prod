// Backend admin-portal smoke tests. Agent A's Wave 3 merge replaces these
// fixture-backed handlers with the real TS stack; until then, these tests
// keep the route contracts honest.

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';

// Source modules are CommonJS so we bridge from ESM test files.
const require = createRequire(import.meta.url);
const { createAdminRouter } = require('../router');

const ALLOW_WALLET = '0xadmin0000000000000000000000000000000001';

function buildApp(allow = ALLOW_WALLET) {
  process.env.ADMIN_WALLETS = allow;
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter());
  return app;
}

describe('admin router', () => {
  beforeEach(() => {
    process.env.ADMIN_WALLETS = ALLOW_WALLET;
  });

  describe('GET /admin/role', () => {
    it('returns role=admin for an allowlisted wallet', async () => {
      const res = await request(buildApp())
        .get('/admin/role')
        .set('X-Admin-Wallet', ALLOW_WALLET);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('admin');
    });

    it('returns 403 for an unlisted wallet', async () => {
      const res = await request(buildApp())
        .get('/admin/role')
        .set('X-Admin-Wallet', '0x9999999999999999999999999999999999999999');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('admin_wallet_not_allowlisted');
    });

    it('returns 403 when the header is missing', async () => {
      const res = await request(buildApp()).get('/admin/role');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /admin/policy/:id', () => {
    it('returns a populated policy for allowlisted wallet', async () => {
      const res = await request(buildApp())
        .get('/admin/policy/pol_test_0001')
        .set('X-Admin-Wallet', ALLOW_WALLET);
      expect(res.status).toBe(200);
      expect(res.body.policy_id).toBe('pol_test_0001');
      expect(res.body).toHaveProperty('breakdown');
      expect(res.body).toHaveProperty('signal_timeline_24h');
      expect(res.body).toHaveProperty('accrual_ledger');
      expect(res.body).toHaveProperty('escrow_authorization');
      expect(res.body).toHaveProperty('settlement_receipts');
      expect(res.body).toHaveProperty('claims');
      expect(res.body).toHaveProperty('fsm_log');
    });

    it('rejects unlisted wallet with 403', async () => {
      const res = await request(buildApp())
        .get('/admin/policy/pol_test_0001')
        .set('X-Admin-Wallet', '0xdead');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /admin/replay', () => {
    it('returns a minute series when the window is valid', async () => {
      const res = await request(buildApp())
        .post('/admin/replay')
        .set('X-Admin-Wallet', ALLOW_WALLET)
        .send({
          policy_id: 'pol_test_0001',
          window_start: '2026-04-21T09:00:00Z',
          window_end: '2026-04-21T10:00:00Z',
          model_version: 'v1.0.0',
        });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.minute_series)).toBe(true);
      expect(res.body.minute_series.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('total_accrued_delta_usdc');
    });

    it('rejects with 400 when required fields are missing', async () => {
      const res = await request(buildApp())
        .post('/admin/replay')
        .set('X-Admin-Wallet', ALLOW_WALLET)
        .send({ policy_id: 'p' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/missing_fields/);
    });

    it('rejects with 400 when the window is inverted', async () => {
      const res = await request(buildApp())
        .post('/admin/replay')
        .set('X-Admin-Wallet', ALLOW_WALLET)
        .send({
          policy_id: 'p',
          window_start: '2026-04-21T10:00:00Z',
          window_end: '2026-04-21T09:00:00Z',
          model_version: 'v1.0.0',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid_time_window/);
    });
  });

  describe('GET /admin/metrics', () => {
    it('returns every required metric key', async () => {
      const res = await request(buildApp())
        .get('/admin/metrics')
        .set('X-Admin-Wallet', ALLOW_WALLET);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        active_policies: expect.any(Number),
        avg_multiplier: expect.any(Number),
        claim_queue_depth: expect.any(Number),
        authorization_consumption_pct: expect.any(Number),
      });
      expect(res.body.ingest_latency_ms).toMatchObject({
        p50: expect.any(Number),
        p95: expect.any(Number),
        p99: expect.any(Number),
      });
    });
  });

  describe('GET /admin/export/:id', () => {
    it('returns CSV with attachment headers', async () => {
      const res = await request(buildApp())
        .get('/admin/export/pol_test_0001')
        .set('X-Admin-Wallet', ALLOW_WALLET);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toMatch(/blink-policy-pol_test_0001\.csv/);
      const firstLine = res.text.split('\n')[0];
      expect(firstLine).toContain('policy_id');
      expect(firstLine).toContain('rulebook_version');
    });

    it('requires admin allowlist', async () => {
      const res = await request(buildApp())
        .get('/admin/export/pol_test_0001')
        .set('X-Admin-Wallet', '0xdead');
      expect(res.status).toBe(403);
    });
  });
});
