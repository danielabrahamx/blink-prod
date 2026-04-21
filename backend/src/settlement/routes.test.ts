import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FakePool, fakeUuidFactory } from '../db/fake';
import { buildSettlementRouter } from './routes';

function buildApp(db: FakePool) {
  const app = express();
  app.use('/settlement', buildSettlementRouter({ db, webhookSecret: 'shh' }));
  return app;
}

describe('settlement routes', () => {
  let db: FakePool;
  beforeEach(() => {
    db = new FakePool();
    db.setIdFactory(fakeUuidFactory('rt'));
  });

  it('POST /authorize 400s on missing fields', async () => {
    const app = buildApp(db);
    const res = await request(app).post('/settlement/authorize').send({ policyId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('POST /authorize stores a valid auth and returns 201', async () => {
    const app = buildApp(db);
    const res = await request(app).post('/settlement/authorize').send({
      policyId: 'p-1',
      userWallet: '0x1111111111111111111111111111111111111111',
      sessionPubkey: '0x2222222222222222222222222222222222222222',
      capUsdc: '50.000000',
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      signature: '0x' + '11'.repeat(65),
      nonce: '0x' + 'ab'.repeat(32),
      chainId: 5_042_002,
    });
    expect(res.status).toBe(201);
    expect(res.body.policyId).toBe('p-1');
    expect(res.body.capUsdc).toBe('50.000000');
  });

  it('GET /status returns aggregate counts', async () => {
    const app = buildApp(db);
    await request(app).post('/settlement/authorize').send({
      policyId: 'p-2',
      userWallet: '0x1111111111111111111111111111111111111111',
      sessionPubkey: '0x2222222222222222222222222222222222222222',
      capUsdc: '50.000000',
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      signature: '0x' + '22'.repeat(65),
      nonce: '0x' + 'cd'.repeat(32),
      chainId: 5_042_002,
    });
    const res = await request(app).get('/settlement/status/p-2');
    expect(res.status).toBe(200);
    expect(res.body.capUsdc).toBe('50.000000');
    expect(res.body.consumedUsdc).toBe('0.000000');
    expect(res.body.ratio).toBe(0);
    expect(res.body.receiptsPending).toBe(0);
  });

  it('POST /revoke marks the auth revoked', async () => {
    const app = buildApp(db);
    const created = await request(app).post('/settlement/authorize').send({
      policyId: 'p-3',
      userWallet: '0x1111111111111111111111111111111111111111',
      sessionPubkey: '0x2222222222222222222222222222222222222222',
      capUsdc: '50.000000',
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      signature: '0x' + '33'.repeat(65),
      nonce: '0x' + 'ef'.repeat(32),
      chainId: 5_042_002,
    });
    const res = await request(app).post(`/settlement/revoke/${created.body.authId}`);
    expect(res.status).toBe(200);
    expect(res.body.revokedAt).toBeTruthy();
  });

  it('GET /status returns 404 when no active auth', async () => {
    const app = buildApp(db);
    const res = await request(app).get('/settlement/status/unknown');
    expect(res.status).toBe(404);
  });
});
