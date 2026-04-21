// Backend CSV builder contract test. Mirrors the frontend csv.test.ts so a
// Wave 3 merge is obvious when shapes drift.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { policyToCsv, COLUMNS } = require('../csv');

const POLICY = {
  policy_id: 'pol_test_0001',
  wallet_addr: '0x2222222222222222222222222222222222222222',
  breakdown: { rulebook_version: 'v1.0.0' },
  accrual_ledger: [
    {
      minute_index: 0,
      ts: '2026-04-21T09:00:00.000Z',
      rate_usdc: 0.000005,
      multiplier: 1.0,
      accrued_usdc: 0.0003,
      state: 'active',
    },
    {
      minute_index: 1,
      ts: '2026-04-21T09:01:00.000Z',
      rate_usdc: 0.000005,
      multiplier: 1.12,
      accrued_usdc: 0.000336,
      state: 'active',
    },
  ],
};

describe('backend csv policyToCsv', () => {
  it('emits the canonical header row', () => {
    const csv = policyToCsv(POLICY);
    expect(csv.split('\n')[0]).toBe(COLUMNS.join(','));
  });

  it('emits one row per accrual-ledger entry', () => {
    const csv = policyToCsv(POLICY);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1 + POLICY.accrual_ledger.length);
  });

  it('quotes cells that contain commas', () => {
    const policy = {
      ...POLICY,
      wallet_addr: '0x1,with,commas',
    };
    const csv = policyToCsv(policy);
    expect(csv).toContain('"0x1,with,commas"');
  });

  it('doubles embedded quotes inside quoted cells', () => {
    const policy = {
      ...POLICY,
      wallet_addr: '0x"quoted"',
      accrual_ledger: [
        { ...POLICY.accrual_ledger[0], state: 'active' },
      ],
    };
    const csv = policyToCsv(policy);
    expect(csv).toContain('"0x""quoted"""');
  });
});
