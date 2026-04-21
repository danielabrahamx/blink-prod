import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  insureActiveHandler,
  insureIdleHandler,
  getTotalPremiumsUsdc,
  _resetLegacyCountersForTests,
} from './insure.js';

function mockRes(): Response {
  const body: { payload?: unknown } = {};
  return {
    json: (payload: unknown) => {
      body.payload = payload;
      return body.payload;
    },
    get payload() {
      return body.payload;
    },
  } as unknown as Response;
}

function mockReq(paymentMeta = {}): Request {
  return { payment: paymentMeta } as unknown as Request;
}

describe('legacy insure handlers', () => {
  beforeEach(() => _resetLegacyCountersForTests());

  it('active handler preserves body shape', () => {
    const res = mockRes();
    insureActiveHandler(
      mockReq({
        payer: '0xabc',
        amount: '0.000005',
        network: 'eip155:5042002',
        transaction: '0xdeadbeef',
      }),
      res,
    );
    const payload = (res as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.covered).toBe(true);
    expect(payload.mode).toBe('active');
    expect(payload.duration).toBe('1s');
    expect(payload.payer).toBe('0xabc');
    expect(payload.amount).toBe('0.000005');
    expect(payload.network).toBe('eip155:5042002');
    expect(payload.transaction).toBe('0xdeadbeef');
  });

  it('idle handler preserves body shape', () => {
    const res = mockRes();
    insureIdleHandler(mockReq(), res);
    const payload = (res as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload.mode).toBe('idle');
  });

  it('accumulates premiums per mode', () => {
    insureActiveHandler(mockReq(), mockRes());
    insureActiveHandler(mockReq(), mockRes());
    insureIdleHandler(mockReq(), mockRes());
    expect(getTotalPremiumsUsdc()).toBeCloseTo(0.000005 * 2 + 0.00001, 8);
  });
});
