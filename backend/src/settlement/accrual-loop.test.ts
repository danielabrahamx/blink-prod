import { describe, expect, it, beforeEach } from 'vitest';
import { FakePool, fakeUuidFactory } from '../db/fake';
import { computeDelta, runForPolicy } from './accrual-loop';

const BASE_RATE = 0.000005; // $0.000005/s ("active" mode)

describe('accrual-loop', () => {
  let db: FakePool;
  const windowStart = new Date('2026-01-01T00:00:00Z');
  const windowEnd = new Date('2026-01-01T00:01:00Z'); // +60s

  beforeEach(() => {
    db = new FakePool();
    db.setIdFactory(fakeUuidFactory('rec'));
  });

  it('synthetic 60s tick with multiplier 1.0 produces correct delta', async () => {
    const result = await runForPolicy(
      {
        policyId: 'pol-A',
        authId: 'auth-A',
        baseRateUsdcPerSec: BASE_RATE,
        multiplier: 1.0,
        paused: false,
        lastWindowEnd: windowStart,
        now: windowEnd,
      },
      db,
    );
    expect(result.delta.deltaUsdc).toBe('0.000300'); // 0.000005 * 1 * 60
    expect(result.delta.cumulativeUsdc).toBe('0.000300');
    expect(result.receipt?.status).toBe('pending');
    expect(result.noop).toBe(false);
  });

  it('varying multiplier is weighted correctly', async () => {
    // 1.5x multiplier over 60s
    const result = await runForPolicy(
      {
        policyId: 'pol-B',
        authId: null,
        baseRateUsdcPerSec: BASE_RATE,
        multiplier: 1.5,
        paused: false,
        lastWindowEnd: windowStart,
        now: windowEnd,
      },
      db,
    );
    expect(result.delta.deltaUsdc).toBe('0.000450'); // 0.000005 * 1.5 * 60
  });

  it('paused state yields zero delta and skips receipt creation', async () => {
    const result = await runForPolicy(
      {
        policyId: 'pol-C',
        authId: null,
        baseRateUsdcPerSec: BASE_RATE,
        multiplier: 0,
        paused: true,
        lastWindowEnd: windowStart,
        now: windowEnd,
      },
      db,
    );
    expect(result.delta.deltaUsdc).toBe('0.000000');
    expect(result.receipt).toBeNull();
    // Ledger entry is still written for audit
    expect(db.tables.accrual_ledger.length).toBe(1);
  });

  it('is idempotent on (policy, window_end)', async () => {
    const base = {
      policyId: 'pol-D',
      authId: null,
      baseRateUsdcPerSec: BASE_RATE,
      multiplier: 1.0,
      paused: false,
      lastWindowEnd: windowStart,
      now: windowEnd,
    };
    const first = await runForPolicy(base, db);
    const second = await runForPolicy(base, db);
    expect(first.receipt?.receiptId).toBe(second.receipt?.receiptId);
    expect(second.noop).toBe(true);
    expect(db.tables.settlement_receipts.length).toBe(1);
    expect(db.tables.accrual_ledger.length).toBe(1);
  });

  it('cumulative_usdc accumulates across ticks', async () => {
    const tick1End = new Date(windowStart.valueOf() + 60_000);
    const tick2End = new Date(windowStart.valueOf() + 120_000);
    await runForPolicy(
      { policyId: 'pol-E', authId: null, baseRateUsdcPerSec: BASE_RATE, multiplier: 1.0, paused: false, lastWindowEnd: windowStart, now: tick1End },
      db,
    );
    const r2 = await runForPolicy(
      { policyId: 'pol-E', authId: null, baseRateUsdcPerSec: BASE_RATE, multiplier: 1.0, paused: false, lastWindowEnd: tick1End, now: tick2End },
      db,
    );
    expect(r2.delta.cumulativeUsdc).toBe('0.000600');
  });

  it('sub-minReceipt deltas write ledger but skip receipt', async () => {
    // 1s tick at 0.000005/s = 0.000005 = 5 units. minReceiptUnits=10 suppresses.
    const result = await runForPolicy(
      {
        policyId: 'pol-F',
        authId: null,
        baseRateUsdcPerSec: BASE_RATE,
        multiplier: 1.0,
        paused: false,
        lastWindowEnd: windowStart,
        now: new Date(windowStart.valueOf() + 1000),
        minReceiptUnits: 10n,
      },
      db,
    );
    expect(result.delta.deltaUsdc).toBe('0.000005');
    expect(result.receipt).toBeNull();
    expect(db.tables.settlement_receipts.length).toBe(0);
    expect(db.tables.accrual_ledger.length).toBe(1);
  });

  it('computeDelta is pure-ish: no ledger/receipt side effects', async () => {
    const res = await computeDelta(
      {
        policyId: 'pol-G',
        authId: null,
        baseRateUsdcPerSec: BASE_RATE,
        multiplier: 1.0,
        paused: false,
        lastWindowEnd: windowStart,
        now: windowEnd,
      },
      db,
    );
    expect(res.deltaUsdc).toBe('0.000300');
    expect(db.tables.accrual_ledger.length).toBe(0);
    expect(db.tables.settlement_receipts.length).toBe(0);
  });
});
