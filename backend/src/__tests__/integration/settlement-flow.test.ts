/**
 * Full-cycle integration test:
 *   signal → multiplier → 402 → client auto-sign → pending → webhook-confirmed → receipt updated.
 *
 * Uses the FakePool to avoid spinning Postgres in CI, and the Electron
 * auto-signer directly (no IPC) since both sides live in the same repo for
 * now. The test deliberately asserts the invariants called out in the design
 * doc: idempotency on (policy_id, window_end), cap enforcement, validity
 * expiry rejection.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';
import { FakePool, fakeUuidFactory } from '../../db/fake';
import { buildSettlementRouter } from '../../settlement/routes';
import { storeAuthorization, consume } from '../../settlement/authorization';
import { runForPolicy } from '../../settlement/accrual-loop';
import { applyWebhook } from '../../settlement/webhook';
import { SessionKeyAutoSigner } from '../../../../electron/src/auto-signer/session-key-auto-sign';
import type { CircleWebhookEvent } from '../../settlement/types';

const WEBHOOK_SECRET = 'integration-secret';
const WALLET = '0x1111111111111111111111111111111111111111';
const SESSION_PUB = '0x2222222222222222222222222222222222222222';
const SELLER = '0x3333333333333333333333333333333333333333';
const USDC_ASSET = '0x3600000000000000000000000000000000000000';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function buildApp(db: FakePool) {
  const app = express();
  app.use('/settlement', buildSettlementRouter({ db, webhookSecret: WEBHOOK_SECRET }));
  return app;
}

describe('integration: settlement full cycle', () => {
  let db: FakePool;
  beforeEach(() => {
    db = new FakePool();
    db.setIdFactory(fakeUuidFactory('int'));
  });

  it('full happy path: authorize → sign → pending → webhook confirms → receipt updated', async () => {
    // 1. Purchase: user authorizes via /settlement/authorize
    const nonce = '0x' + 'ab'.repeat(32);
    const app = buildApp(db);
    const auth = await request(app).post('/settlement/authorize').send({
      policyId: 'pol-int',
      userWallet: WALLET,
      sessionPubkey: SESSION_PUB,
      capUsdc: '10.000000',
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      signature: '0x' + '11'.repeat(65),
      nonce,
      chainId: 5_042_002,
    });
    expect(auth.status).toBe(201);
    const authId = auth.body.authId;

    // 2. Accrual loop: one 60s tick at multiplier 1.0 → pending receipt.
    const windowStart = new Date('2026-01-01T00:00:00Z');
    const windowEnd = new Date('2026-01-01T00:01:00Z');
    const result = await runForPolicy(
      {
        policyId: 'pol-int',
        authId,
        baseRateUsdcPerSec: 0.000005,
        multiplier: 1,
        paused: false,
        lastWindowEnd: windowStart,
        now: windowEnd,
      },
      db,
    );
    expect(result.delta.deltaUsdc).toBe('0.000300');
    expect(result.receipt?.status).toBe('pending');

    // 3. Simulate the x402 client (Electron) signing the 402 response.
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => ({
        policyId: 'pol-int',
        authId,
        userWallet: WALLET as `0x${string}`,
        sessionPubkey: SESSION_PUB as `0x${string}`,
        capUsdc: '10.000000',
        consumedUsdc: '0.000000',
        validUntil: new Date(Date.now() + 3600_000),
        chainId: 5_042_002,
        revoked: false,
      }),
      getSessionKey: async () => ('0x' + '11'.repeat(32)) as `0x${string}`,
      signTypedData: async () => ('0x' + 'bb'.repeat(65)) as `0x${string}`,
      randomNonce: () => nonce as `0x${string}`,
    });
    const signed = await signer.sign({
      policyId: 'pol-int',
      paymentRequired: {
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:5042002',
            maxAmountRequired: '300',
            resource: 'https://api.blink.test/signals',
            payTo: SELLER as `0x${string}`,
            asset: USDC_ASSET as `0x${string}`,
            extra: { name: 'GatewayWalletBatched' },
          },
        ],
      },
      resource: 'https://api.blink.test/signals',
    });
    expect(signed.authorization.nonce).toBe(nonce);

    // 4. Stamp the pending receipt with our x402_payload so the webhook can match it.
    const receipt = db.tables.settlement_receipts.find((r) => r['policy_id'] === 'pol-int');
    if (!receipt) throw new Error('receipt missing');
    receipt['x402_payload'] = { authorization: { nonce } };
    receipt['status'] = 'submitted';

    // 5. Circle posts the settlement.completed webhook.
    const event: CircleWebhookEvent = {
      id: 'e-int-1',
      type: 'settlement.completed',
      data: {
        batchId: 'batch-int',
        transactionHash: '0xint',
        authorizations: [{ nonce: nonce as `0x${string}`, status: 'confirmed' }],
      },
    };
    const body = JSON.stringify(event);
    const resp = await request(app)
      .post('/settlement/webhook')
      .set('Content-Type', 'application/json')
      .set('Circle-Signature', sign(body))
      .send(body);
    expect(resp.status).toBe(200);
    expect(resp.body.applied).toBe(1);

    // 6. Invariants: receipt is confirmed; consumed_usdc advanced.
    expect(receipt['status']).toBe('confirmed');
    expect(receipt['circle_batch_id']).toBe('batch-int');
    const authRow = db.tables.x402_authorizations.find((r) => r['auth_id'] === authId);
    expect(authRow?.['consumed_usdc']).toBe('0.000300');
  });

  it('cap-exceeded rejection: consume throws when multiplier blows the budget', async () => {
    const stored = await storeAuthorization(
      {
        policyId: 'pol-cap',
        userWallet: WALLET as `0x${string}`,
        sessionPubkey: SESSION_PUB as `0x${string}`,
        capUsdc: '0.001000',
        validUntil: new Date(Date.now() + 3600_000),
        signature: ('0x' + '11'.repeat(65)) as `0x${string}`,
        nonce: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      },
      db,
    );
    await consume(stored.authId, '0.001000', db);
    await expect(consume(stored.authId, '0.000100', db)).rejects.toMatchObject({ reason: 'cap_exceeded' });
  });

  it('validity-expired rejection: consume against stale auth is refused', async () => {
    const stored = await storeAuthorization(
      {
        policyId: 'pol-exp',
        userWallet: WALLET as `0x${string}`,
        sessionPubkey: SESSION_PUB as `0x${string}`,
        capUsdc: '10.000000',
        validUntil: new Date(Date.now() + 40),
        signature: ('0x' + '11'.repeat(65)) as `0x${string}`,
        nonce: ('0x' + 'bb'.repeat(32)) as `0x${string}`,
      },
      db,
    );
    await new Promise((r) => setTimeout(r, 80));
    await expect(consume(stored.authId, '0.000100', db)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('idempotent on (policy_id, window_end)', async () => {
    const stored = await storeAuthorization(
      {
        policyId: 'pol-idem',
        userWallet: WALLET as `0x${string}`,
        sessionPubkey: SESSION_PUB as `0x${string}`,
        capUsdc: '10.000000',
        validUntil: new Date(Date.now() + 3600_000),
        signature: ('0x' + '11'.repeat(65)) as `0x${string}`,
        nonce: ('0x' + 'cc'.repeat(32)) as `0x${string}`,
      },
      db,
    );
    const input = {
      policyId: 'pol-idem',
      authId: stored.authId,
      baseRateUsdcPerSec: 0.000005,
      multiplier: 1,
      paused: false,
      lastWindowEnd: new Date('2026-01-01T00:00:00Z'),
      now: new Date('2026-01-01T00:01:00Z'),
    };
    const first = await runForPolicy(input, db);
    const again = await runForPolicy(input, db);
    expect(first.receipt?.receiptId).toBe(again.receipt?.receiptId);
    expect(db.tables.settlement_receipts.length).toBe(1);
  });

  it('replayed webhook id is a no-op (200 replayed=true)', async () => {
    const app = buildApp(db);
    const event = { id: 'replay-1', type: 'settlement.completed', data: { authorizations: [] } };
    const body = JSON.stringify(event);
    const hdr = sign(body);
    const a = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').set('Circle-Signature', hdr).send(body);
    expect(a.status).toBe(200);
    const b = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').set('Circle-Signature', hdr).send(body);
    expect(b.body.replayed).toBe(true);

    // Unused import guard: applyWebhook is re-exported for future invariants.
    void applyWebhook;
  });
});
