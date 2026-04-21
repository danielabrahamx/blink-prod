// End-to-end happy path: submit -> review -> approve -> payout -> paid.
// The reserve client is a deterministic mock of MockBlinkReserve.sol. In CI
// with hardhat available this can be swapped to a real deployment via
// `createEthersMock` — kept simple here so the test suite runs without a
// local hardhat fork dependency.

import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { createClaimsRouter } from '../routes.js';
import { makeRepository } from '../repository.js';
import type { ReserveClient } from '../payout.js';
import {
  ADMIN_WALLET,
  buildPolicy,
  buildSubmission,
  fixedClock,
} from './fixtures.js';

// A minimal in-memory MockBlinkReserve: tracks pool + emits a "tx hash" for
// each payoutClaim call.
function makeMockReserve(initialPoolUsdc = 10_000): ReserveClient & {
  pool: () => number;
  events: Array<{ claimId: string; recipient: string; amount: number; tx: string }>;
} {
  let pool = initialPoolUsdc;
  const events: Array<{ claimId: string; recipient: string; amount: number; tx: string }> = [];
  return {
    pool: () => pool,
    events,
    async transferPayout({ claimId, recipientAddress, amountUsdc }) {
      if (pool < amountUsdc) {
        return { success: false, error: 'insufficient_pool' };
      }
      pool -= amountUsdc;
      const tx = `0x${(events.length + 1).toString(16).padStart(64, '0')}`;
      events.push({
        claimId,
        recipient: recipientAddress,
        amount: amountUsdc,
        tx,
      });
      return { success: true, txHash: tx, network: 'mock-arc-testnet' };
    },
  };
}

describe('claims/integration (submit -> review -> approve -> payout)', () => {
  it('completes the full flow and debits the mock reserve', async () => {
    const repo = makeRepository();
    buildPolicy(repo);
    const reserve = makeMockReserve(10_000);
    const app = express();
    app.use(
      '/claims',
      createClaimsRouter({
        repository: repo,
        reserveClient: reserve,
        sanctionsScreener: async () => ({ clear: true, checkedAt: 1 }),
        clock: fixedClock(),
        adminWallets: [ADMIN_WALLET],
      }),
    );
    const head = { 'x-admin-wallet': ADMIN_WALLET, 'x-admin-id': 'admin-1' };

    const submit = await supertest(app)
      .post('/claims/submit')
      .send(buildSubmission({ amountClaimedUsdc: 500 }));
    assert.equal(submit.status, 201);
    const claimId: string = submit.body.claim.id;

    const reviewed = await supertest(app)
      .post(`/claims/${claimId}/review`)
      .set(head);
    assert.equal(reviewed.body.claim.status, 'under_review');
    assert.ok(Array.isArray(reviewed.body.claim.fraudFlags));

    const approved = await supertest(app)
      .post(`/claims/${claimId}/approve`)
      .set(head);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.claim.status, 'paid');
    assert.equal(approved.body.payout.txHash, reserve.events[0].tx);

    // Verify the pool was debited + the receipt was persisted.
    assert.equal(reserve.pool(), 9500);
    const receipt = repo.getReceipt(claimId);
    assert.ok(receipt);
    assert.equal(receipt?.amountUsdc, 500);
  });
});
