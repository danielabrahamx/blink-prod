import { describe, expect, it, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { FakePool } from '../db/fake';
import { runReconcile, StaticTotalsAdapter } from './reconcile';
import { storeAuthorization } from './authorization';
import { runForPolicy } from './accrual-loop';

describe('reconcile', () => {
  let db: FakePool;
  let tmpDir: string;

  beforeEach(async () => {
    db = new FakePool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-'));
  });

  it('finds no issue when totals agree', async () => {
    await seedConfirmedReceipt(db, 'pol-A', 0.001);
    const result = await runReconcile({
      db,
      now: () => new Date(Date.now() + 1000),
      adapter: new StaticTotalsAdapter({ 'pol-A': 0.001 }),
      logPath: path.join(tmpDir, 'reconcile.jsonl'),
    });
    expect(result.issues).toEqual([]);
  });

  it('flags a delta > $0.01', async () => {
    await seedConfirmedReceipt(db, 'pol-B', 1.0);
    const result = await runReconcile({
      db,
      now: () => new Date(Date.now() + 1000),
      adapter: new StaticTotalsAdapter({ 'pol-B': 0.5 }),
      logPath: path.join(tmpDir, 'reconcile.jsonl'),
    });
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]!.policyId).toBe('pol-B');
    expect(result.issues[0]!.deltaUsdc).toBeCloseTo(0.5, 6);
    // JSONL file was written
    const raw = await fs.readFile(path.join(tmpDir, 'reconcile.jsonl'), 'utf8');
    expect(raw).toMatch(/pol-B/);
  });

  it('ignores deltas at the threshold ($0.01 exactly)', async () => {
    await seedConfirmedReceipt(db, 'pol-C', 1.0);
    const result = await runReconcile({
      db,
      now: () => new Date(Date.now() + 1000),
      adapter: new StaticTotalsAdapter({ 'pol-C': 1.01 }),
      logPath: path.join(tmpDir, 'reconcile.jsonl'),
    });
    // delta is exactly 0.01 → ignored (threshold is strictly >)
    expect(result.issues).toEqual([]);
  });

  it('catches missing Circle side (backend logged but Circle did not)', async () => {
    await seedConfirmedReceipt(db, 'pol-D', 0.5);
    const result = await runReconcile({
      db,
      now: () => new Date(Date.now() + 1000),
      adapter: new StaticTotalsAdapter({}),
      logPath: path.join(tmpDir, 'reconcile.jsonl'),
    });
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]!.internalUsdc).toBeCloseTo(0.5, 6);
    expect(result.issues[0]!.circleUsdc).toBe(0);
  });
});

async function seedConfirmedReceipt(db: FakePool, policyId: string, usdc: number): Promise<void> {
  const auth = await storeAuthorization(
    {
      policyId,
      userWallet: '0x1111111111111111111111111111111111111111',
      sessionPubkey: '0x2222222222222222222222222222222222222222',
      capUsdc: '50.000000',
      validUntil: new Date(Date.now() + 3600_000),
      signature: ('0x' + '11'.repeat(65)) as `0x${string}`,
      nonce: ('0x' + Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64)) as `0x${string}`,
    },
    db,
  );
  // Use a high base rate so one 60s window produces the target USDC without
  // running into accrual's 86,400-second clamp.
  const start = new Date();
  const end = new Date(start.valueOf() + 60_000);
  await runForPolicy(
    {
      policyId,
      authId: auth.authId,
      baseRateUsdcPerSec: usdc / 60,
      multiplier: 1,
      paused: false,
      lastWindowEnd: start,
      now: end,
    },
    db,
  );
  // Flip the seeded receipt to confirmed so reconcile counts it.
  for (const row of db.tables.settlement_receipts) {
    if (row['policy_id'] === policyId) row['status'] = 'confirmed';
  }
}
