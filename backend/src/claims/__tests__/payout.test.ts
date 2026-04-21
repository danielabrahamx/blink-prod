import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { executePayout } from '../payout.js';
import type { ReserveClient } from '../payout.js';
import { makeRepository } from '../repository.js';
import { buildClaim, buildPolicy, fixedClock } from './fixtures.js';

function makeClient(): ReserveClient & { calls: Array<{ amountUsdc: number }> } {
  const calls: Array<{ amountUsdc: number }> = [];
  return {
    calls,
    async transferPayout(input) {
      calls.push({ amountUsdc: input.amountUsdc });
      return { success: true, txHash: `0xhash_${calls.length}`, network: 'mock' };
    },
  };
}

function makeFailingClient(): ReserveClient {
  return {
    async transferPayout() {
      return { success: false, error: 'revert: insufficient_pool' };
    },
  };
}

describe('claims/payout', () => {
  it('pays an approved claim and records a settlement receipt', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    repo.createClaim(buildClaim({ status: 'approved' }));
    const client = makeClient();
    const res = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: client,
      clock: fixedClock(),
    });
    assert.equal(res.ok, true);
    assert.equal(res.txHash, '0xhash_1');
    assert.equal(res.receipt?.amountUsdc, 300);
    assert.equal(repo.getClaim('clm_fix1')?.status, 'paid');
    assert.equal(repo.getReceipt('clm_fix1')?.txHash, '0xhash_1');
  });

  it('is idempotent when called twice', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    repo.createClaim(buildClaim({ status: 'approved' }));
    const client = makeClient();
    const first = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: client,
      clock: fixedClock(),
    });
    const second = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: client,
      clock: fixedClock(),
    });
    assert.equal(first.txHash, second.txHash);
    assert.equal(second.idempotent, true);
    assert.equal(client.calls.length, 1);
  });

  it('keeps claim in approved state on failure and schedules a retry', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    repo.createClaim(buildClaim({ status: 'approved' }));
    const res = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: makeFailingClient(),
      clock: fixedClock(),
    });
    assert.equal(res.ok, false);
    const stored = repo.getClaim('clm_fix1');
    assert.equal(stored?.status, 'approved');
    assert.ok(res.retryScheduledAt);
    assert.equal(stored?.payoutAttempts?.length, 1);
  });

  it('escalates after maxAttempts failures (no retryScheduledAt)', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    repo.createClaim(buildClaim({ status: 'approved' }));
    const client = makeFailingClient();
    const a = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: client,
      clock: fixedClock(),
      maxAttempts: 2,
    });
    assert.ok(a.retryScheduledAt);
    const b = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: client,
      clock: fixedClock(),
      maxAttempts: 2,
    });
    assert.equal(b.ok, false);
    assert.equal(b.retryScheduledAt, undefined);
    const stored = repo.getClaim('clm_fix1');
    assert.equal(stored?.denialReason, 'payout_failed');
  });

  it('refuses to pay a non-approved claim', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    repo.createClaim(buildClaim({ status: 'submitted' }));
    const res = await executePayout('clm_fix1', {
      repository: repo,
      reserveClient: makeClient(),
      clock: fixedClock(),
    });
    assert.equal(res.ok, false);
    assert.ok(res.error?.startsWith('claim_not_approved'));
  });

  it('404s when claim is missing', async () => {
    const repo = makeRepository();
    const res = await executePayout('clm_absent', {
      repository: repo,
      reserveClient: makeClient(),
      clock: fixedClock(),
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'claim_not_found');
  });
});
