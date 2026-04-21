import { describe, expect, it, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';
import { FakePool, fakeUuidFactory } from '../db/fake';
import { buildWebhookHandler, verifySignature, applyWebhook } from './webhook';
import { storeAuthorization } from './authorization';
import { runForPolicy } from './accrual-loop';
import type { CircleWebhookEvent } from './types';

const SECRET = 'test-secret';
const NONCE = '0x' + 'ab'.repeat(32);

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function buildApp(db: FakePool) {
  const app = express();
  app.post('/settlement/webhook', express.raw({ type: 'application/json' }), buildWebhookHandler({ db, webhookSecret: SECRET }));
  return app;
}

describe('webhook.verifySignature', () => {
  it('validates a good signature', () => {
    const body = JSON.stringify({ ping: 1 });
    const sig = sign(body);
    expect(verifySignature({ rawBody: body, signature: sig, secret: SECRET })).toBe(true);
    expect(verifySignature({ rawBody: body, signature: `sha256=${sig}`, secret: SECRET })).toBe(true);
  });
  it('rejects a bad signature', () => {
    expect(verifySignature({ rawBody: 'x', signature: 'deadbeef', secret: SECRET })).toBe(false);
  });
});

describe('webhook handler', () => {
  let db: FakePool;
  beforeEach(() => {
    db = new FakePool();
    db.setIdFactory(fakeUuidFactory('seed'));
  });

  it('rejects 401 on missing signature', async () => {
    const app = buildApp(db);
    const body = { id: 'e-1', type: 'settlement.completed', data: {} };
    const res = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').send(JSON.stringify(body));
    expect(res.status).toBe(401);
  });

  it('rejects 401 on bad signature', async () => {
    const app = buildApp(db);
    const body = JSON.stringify({ id: 'e-2', type: 'settlement.completed', data: {} });
    const res = await request(app)
      .post('/settlement/webhook')
      .set('Content-Type', 'application/json')
      .set('Circle-Signature', 'beefcafe')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('returns 200 + replayed=true on duplicate webhook id', async () => {
    const app = buildApp(db);
    const body = JSON.stringify({ id: 'e-3', type: 'settlement.completed', data: { authorizations: [] } });
    const sig = sign(body);
    const first = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').set('Circle-Signature', sig).send(body);
    expect(first.status).toBe(200);
    const second = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').set('Circle-Signature', sig).send(body);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
  });

  it('updates matching settlement receipts on settlement.completed', async () => {
    // Seed: one pending receipt with nonce embedded in x402_payload.
    const auth = await storeAuthorization(
      {
        policyId: 'pol-W',
        userWallet: '0x1111111111111111111111111111111111111111',
        sessionPubkey: '0x2222222222222222222222222222222222222222',
        capUsdc: '10.000000',
        validUntil: new Date(Date.now() + 3600_000),
        signature: ('0x' + '11'.repeat(65)) as `0x${string}`,
        nonce: NONCE as `0x${string}`,
      },
      db,
    );
    const res = await runForPolicy(
      {
        policyId: 'pol-W',
        authId: auth.authId,
        baseRateUsdcPerSec: 0.000005,
        multiplier: 1,
        paused: false,
        lastWindowEnd: new Date('2026-01-01T00:00:00Z'),
        now: new Date('2026-01-01T00:01:00Z'),
      },
      db,
    );
    // Paste the x402_payload with our nonce so applyWebhook can match.
    const receipt = db.tables.settlement_receipts.find((r) => r['receipt_id'] === res.receipt?.receiptId);
    if (!receipt) throw new Error('seed receipt missing');
    receipt['x402_payload'] = { authorization: { nonce: NONCE } };

    const event: CircleWebhookEvent = {
      id: 'e-batch-1',
      type: 'settlement.completed',
      data: {
        batchId: 'batch-x',
        transactionHash: '0xhash',
        authorizations: [{ nonce: NONCE as `0x${string}`, status: 'confirmed' }],
      },
    };
    const out = await applyWebhook(event, db);
    expect(out.applied).toBe(1);
    expect(receipt['status']).toBe('confirmed');
    expect(receipt['circle_batch_id']).toBe('batch-x');

    const authRow = db.tables.x402_authorizations.find((r) => r['auth_id'] === auth.authId);
    expect(authRow?.['consumed_usdc']).toBe('0.000300');
  });

  it('applies 200 + applied=1 via the HTTP handler end-to-end', async () => {
    const auth = await storeAuthorization(
      {
        policyId: 'pol-H',
        userWallet: '0x1111111111111111111111111111111111111111',
        sessionPubkey: '0x2222222222222222222222222222222222222222',
        capUsdc: '10.000000',
        validUntil: new Date(Date.now() + 3600_000),
        signature: ('0x' + '22'.repeat(65)) as `0x${string}`,
        nonce: ('0x' + 'cd'.repeat(32)) as `0x${string}`,
      },
      db,
    );
    const res = await runForPolicy(
      {
        policyId: 'pol-H',
        authId: auth.authId,
        baseRateUsdcPerSec: 0.000005,
        multiplier: 1,
        paused: false,
        lastWindowEnd: new Date('2026-01-01T00:00:00Z'),
        now: new Date('2026-01-01T00:01:00Z'),
      },
      db,
    );
    const receipt = db.tables.settlement_receipts.find((r) => r['receipt_id'] === res.receipt?.receiptId);
    if (!receipt) throw new Error('seed receipt missing');
    const n2 = '0x' + 'cd'.repeat(32);
    receipt['x402_payload'] = { authorization: { nonce: n2 } };

    const app = buildApp(db);
    const body = JSON.stringify({
      id: 'e-http-1',
      type: 'settlement.completed',
      data: { batchId: 'b', transactionHash: '0xt', authorizations: [{ nonce: n2, status: 'confirmed' }] },
    });
    const sig = sign(body);
    const resp = await request(app).post('/settlement/webhook').set('Content-Type', 'application/json').set('Circle-Signature', sig).send(body);
    expect(resp.status).toBe(200);
    expect(resp.body.applied).toBe(1);
  });
});
