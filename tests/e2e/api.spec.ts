import { test, expect } from '@playwright/test';
import { apiGet, apiPost } from './helpers/api';

/**
 * Backend API integration tests - direct HTTP calls to http://localhost:3001.
 * Run standalone: npm run test:e2e:api
 */

/* ------------------------------------------------------------------ */
/*  /api/health                                                       */
/* ------------------------------------------------------------------ */
test.describe('API - /api/health', () => {
  test('returns 200 with status ok and timestamp', async () => {
    const res = await apiGet('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.message).toContain('Blink');
    expect(body).toHaveProperty('timestamp');
  });
});

/* ------------------------------------------------------------------ */
/*  /api/status                                                       */
/* ------------------------------------------------------------------ */
test.describe('API - /api/status', () => {
  test('returns service info with seller address and network', async () => {
    const res = await apiGet('/api/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('active');
    expect(body.sellerAddress).toBeTruthy();
    expect(body.network).toBe('eip155:5042002');
  });
});

/* ------------------------------------------------------------------ */
/*  /api/balance/:address                                             */
/* ------------------------------------------------------------------ */
test.describe('API - /api/balance/:address', () => {
  test('returns 400 for invalid address', async () => {
    const res = await apiGet('/api/balance/not-an-address');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid address');
  });

  test('returns USDC and USYC balances for valid address', async () => {
    const res = await apiGet('/api/balance/0xa4d42d3f0ae0e03df1937cdb0f14c58e64581359');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('usdc');
    expect(body).toHaveProperty('usyc');
    expect(parseFloat(body.usdc)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(body.usyc)).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ */
/*  x402 paid endpoints - return 402 without payment header           */
/* ------------------------------------------------------------------ */
test.describe('API - x402 paid endpoints (integration)', () => {
  test('GET /api/insure/active returns 402 without payment', async () => {
    const res = await apiGet('/api/insure/active');
    expect(res.status).toBe(402);
  });

  test('GET /api/insure/idle returns 402 without payment', async () => {
    const res = await apiGet('/api/insure/idle');
    expect(res.status).toBe(402);
  });
});

/* ------------------------------------------------------------------ */
/*  /api/admin/deposit-reserve - validation                           */
/* ------------------------------------------------------------------ */
test.describe('API - /api/admin/deposit-reserve', () => {
  test('returns 400 when amountUsyc is missing', async () => {
    const res = await apiPost('/api/admin/deposit-reserve', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('amountUsyc required');
  });

  test('returns 400 when amountUsyc is zero', async () => {
    const res = await apiPost('/api/admin/deposit-reserve', { amountUsyc: 0 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('amountUsyc required');
  });

  test('returns 400 when amountUsyc is negative', async () => {
    const res = await apiPost('/api/admin/deposit-reserve', { amountUsyc: -5 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('amountUsyc required');
  });
});

/* ------------------------------------------------------------------ */
/*  /api/admin/trigger-claim - validation                             */
/* ------------------------------------------------------------------ */
test.describe('API - /api/admin/trigger-claim', () => {
  test('returns 400 when recipientAddress is missing', async () => {
    const res = await apiPost('/api/admin/trigger-claim', { amountUsdc: 1 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('recipientAddress');
  });

  test('returns 400 when recipientAddress is invalid', async () => {
    const res = await apiPost('/api/admin/trigger-claim', {
      recipientAddress: 'not-an-address',
      amountUsdc: 1,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('recipientAddress');
  });

  test('returns 400 when amountUsdc is missing', async () => {
    const res = await apiPost('/api/admin/trigger-claim', {
      recipientAddress: '0xa4d42d3f0ae0e03df1937cdb0f14c58e64581359',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('amountUsdc');
  });
});
