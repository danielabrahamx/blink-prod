import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { createClaimsRouter } from '../routes.js';
import { makeRepository } from '../repository.js';
import type { ReserveClient } from '../payout.js';
import type { SanctionsScreener } from '../sanctions.js';
import {
  ADMIN_WALLET,
  buildPolicy,
  buildSubmission,
  fixedClock,
  WALLET_A,
} from './fixtures.js';

function makeApp(overrides: {
  reserveClient?: ReserveClient;
  sanctionsScreener?: SanctionsScreener;
} = {}) {
  const repository = makeRepository();
  const reserveClient: ReserveClient =
    overrides.reserveClient ?? {
      async transferPayout() {
        return { success: true, txHash: '0xfeedface', network: 'mock' };
      },
    };
  const sanctionsScreener: SanctionsScreener =
    overrides.sanctionsScreener ?? (async () => ({ clear: true, checkedAt: 1 }));
  const app = express();
  app.use(
    '/claims',
    createClaimsRouter({
      repository,
      reserveClient,
      sanctionsScreener,
      clock: fixedClock(),
      adminWallets: [ADMIN_WALLET],
    }),
  );
  return { app, repository };
}

function adminHeader(): Record<string, string> {
  return { 'x-admin-wallet': ADMIN_WALLET, 'x-admin-id': 'admin-1' };
}

describe('claims/routes', () => {
  it('POST /claims/submit rejects invalid bodies with 400', async () => {
    const { app } = makeApp();
    const res = await supertest(app).post('/claims/submit').send({ policyId: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_submission');
    assert.ok(Array.isArray(res.body.details));
  });

  it('POST /claims/submit writes SLA timestamps on the created claim', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository);
    const res = await supertest(app)
      .post('/claims/submit')
      .send(buildSubmission());
    assert.equal(res.status, 201);
    assert.equal(res.body.claim.status, 'submitted');
    assert.ok(res.body.claim.reviewByAt > res.body.claim.submittedAt);
    assert.ok(res.body.claim.payoutByAt > res.body.claim.reviewByAt);
  });

  it('GET /claims/:id requires matching wallet for user access', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository);
    const submit = await supertest(app).post('/claims/submit').send(buildSubmission());
    const claimId = submit.body.claim.id;
    const unauthorised = await supertest(app)
      .get(`/claims/${claimId}`)
      .set('x-user-wallet', '0xdeadbeef');
    assert.equal(unauthorised.status, 403);
    const authorised = await supertest(app)
      .get(`/claims/${claimId}`)
      .set('x-user-wallet', WALLET_A);
    assert.equal(authorised.status, 200);
  });

  it('GET /claims/admin/queue requires admin wallet', async () => {
    const { app } = makeApp();
    const anon = await supertest(app).get('/claims/admin/queue');
    assert.equal(anon.status, 401);
    const wrong = await supertest(app)
      .get('/claims/admin/queue')
      .set('x-admin-wallet', '0xnotadmin');
    assert.equal(wrong.status, 403);
    const ok = await supertest(app)
      .get('/claims/admin/queue')
      .set(adminHeader());
    assert.equal(ok.status, 200);
  });

  it('GET /claims/admin/queue is sorted by review_by_at ascending', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository, { id: 'pol_fix1' });
    buildPolicy(repository, { id: 'pol_fix2' });
    const a = await supertest(app)
      .post('/claims/submit')
      .send(buildSubmission({ policyId: 'pol_fix1' }));
    repository.updateClaim(a.body.claim.id, { reviewByAt: 10_000_000 });
    const b = await supertest(app)
      .post('/claims/submit')
      .send(buildSubmission({ policyId: 'pol_fix2' }));
    repository.updateClaim(b.body.claim.id, { reviewByAt: 5_000_000 });
    const queue = await supertest(app)
      .get('/claims/admin/queue')
      .set(adminHeader());
    assert.equal(queue.status, 200);
    assert.ok(queue.body.claims.length >= 2);
    assert.equal(queue.body.claims[0].reviewByAt, 5_000_000);
    assert.equal(queue.body.claims[1].reviewByAt, 10_000_000);
  });

  it('full happy path: submit -> review -> approve -> paid', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository);
    const submit = await supertest(app)
      .post('/claims/submit')
      .send(buildSubmission());
    const claimId = submit.body.claim.id;
    const reviewed = await supertest(app)
      .post(`/claims/${claimId}/review`)
      .set(adminHeader());
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.claim.status, 'under_review');
    const approved = await supertest(app)
      .post(`/claims/${claimId}/approve`)
      .set(adminHeader());
    assert.equal(approved.status, 200);
    assert.equal(approved.body.claim.status, 'paid');
    assert.equal(approved.body.payout.txHash, '0xfeedface');
  });

  it('POST /claims/:id/deny requires a reason', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository);
    const submit = await supertest(app).post('/claims/submit').send(buildSubmission());
    const claimId = submit.body.claim.id;
    const noReason = await supertest(app)
      .post(`/claims/${claimId}/deny`)
      .set(adminHeader())
      .send({});
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.error, 'reason_required');
    const withReason = await supertest(app)
      .post(`/claims/${claimId}/deny`)
      .set(adminHeader())
      .send({ reason: 'no evidence' });
    assert.equal(withReason.status, 200);
    assert.equal(withReason.body.claim.status, 'denied');
  });

  it('GET /claims/user/:wallet returns only the wallets claims', async () => {
    const { app, repository } = makeApp();
    buildPolicy(repository);
    await supertest(app).post('/claims/submit').send(buildSubmission());
    const res = await supertest(app)
      .get(`/claims/user/${WALLET_A}`)
      .set('x-user-wallet', WALLET_A);
    assert.equal(res.status, 200);
    assert.equal(res.body.claims.length, 1);
  });

  it('sanctions hit in review transitions to denied', async () => {
    const { app, repository } = makeApp({
      sanctionsScreener: async () => ({
        clear: false,
        reason: 'ofac_hit',
        list: 'OFAC',
        checkedAt: 1,
      }),
    });
    buildPolicy(repository);
    const submit = await supertest(app).post('/claims/submit').send(buildSubmission());
    const review = await supertest(app)
      .post(`/claims/${submit.body.claim.id}/review`)
      .set(adminHeader());
    assert.equal(review.body.claim.status, 'denied');
    assert.equal(review.body.claim.denialReason, 'sanctions_hit');
  });
});
