import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createApp } from './app.js';
import { MemoryRedis } from './lib/memoryRedis.js';
import { createMemoryStore } from './lib/store.js';
import { jcs } from './lib/jcs.js';
import { setRiskEngine } from './risk/index.js';
import { setGeoResolver, _resetForTests as resetGeo } from './ingest/geoip.js';
import { _resetForTests as resetMetrics } from './admin/metrics.js';
import { _resetLegacyCountersForTests } from './legacy/insure.js';

function buildApp() {
  const redis = new MemoryRedis();
  const store = createMemoryStore();
  return { redis, store, app: createApp({ redis, store }) };
}

describe('app integration', () => {
  beforeEach(() => {
    resetGeo();
    resetMetrics();
    _resetLegacyCountersForTests();
    setGeoResolver(() => 'US');
    setRiskEngine({
      version: 'test_v1',
      score: (features) => ({
        multiplier: 1.3,
        model_version: 'test_v1',
        features,
        explanation: { factors: [], base_multiplier: 1, final_multiplier: 1.3 },
        computed_at: '2026-04-21T12:00:00Z',
      }),
    });
  });

  it('exposes /api/health', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('legacy /api/insure/active returns preserved contract', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/api/insure/active');
    expect(r.status).toBe(200);
    expect(r.body.covered).toBe(true);
    expect(r.body.mode).toBe('active');
    expect(r.body.duration).toBe('1s');
    expect(typeof r.body.timestamp).toBe('string');
  });

  it('legacy /api/insure/idle returns preserved contract', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/api/insure/idle');
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('idle');
  });

  it('register -> create policy -> fund -> signal end-to-end', async () => {
    const { app, store } = buildApp();

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const rawPub = publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32);
    const walletAddr = '0x' + '1'.repeat(40);

    const reg = await request(app)
      .post('/devices/register')
      .send({
        wallet_addr: walletAddr,
        device_pubkey: rawPub.toString('hex'),
        platform: 'win32',
        os_version: '11.0',
      });
    expect(reg.status).toBe(201);
    const device_id = reg.body.device.device_id;

    const pol = await request(app)
      .post('/policies/create')
      .send({
        wallet_addr: walletAddr,
        home_country: 'US',
        session_key_pubkey: rawPub.toString('hex'),
        authorization_signature: 'a'.repeat(130),
        cap_usdc: 50,
        validity_days: 30,
      });
    expect(pol.status).toBe(201);
    const policy_id = pol.body.policy.policy_id;

    const fund = await request(app)
      .post('/policies/fund')
      .send({ policy_id, amount_usdc: 5 });
    expect(fund.status).toBe(200);
    expect(fund.body.policy.status).toBe('calibrating');

    const envelope = {
      schema_version: '1.0',
      policy_id,
      client_ts: new Date().toISOString(),
      client_nonce: 'n-' + Math.random().toString(36).slice(2),
      trigger: 'scheduled',
      event_signal: null,
      signals: {
        wifi_trust: 'home',
        charging_state: 'ac',
        lid_state: 'open',
        app_category: 'productivity',
        input_idle_flag: false,
        battery_health_pct: 92,
      },
    };
    const signature = cryptoSign(
      null,
      Buffer.from(jcs(envelope), 'utf8'),
      privateKey,
    ).toString('base64');

    const sig = await request(app)
      .post('/signals')
      .send({ envelope, signature, device_id });
    expect(sig.status).toBe(200);
    expect(sig.body.accepted).toBe(true);
    expect(sig.body.scored.multiplier).toBeCloseTo(1.3);
    expect(sig.body.features.wifi_trust_score).toBe(1);

    // second identical POST should be rejected (rate-limit or nonce).
    const dup = await request(app)
      .post('/signals')
      .send({ envelope, signature, device_id });
    expect([409, 429]).toContain(dup.status);

    expect(policy_id).toContain('pol_');
    expect(store).toBeTruthy();
  });

  it('cancel flips policy state', async () => {
    const { app } = buildApp();
    const walletAddr = '0x' + '2'.repeat(40);
    const pol = await request(app)
      .post('/policies/create')
      .send({
        wallet_addr: walletAddr,
        home_country: 'GB',
        session_key_pubkey: 'a'.repeat(64),
        authorization_signature: 'a'.repeat(130),
        cap_usdc: 50,
        validity_days: 30,
      });
    const policy_id = pol.body.policy.policy_id;
    await request(app).post('/policies/fund').send({ policy_id, amount_usdc: 5 });
    const cancel = await request(app)
      .post('/policies/cancel')
      .send({ policy_id });
    expect(cancel.status).toBe(200);
    expect(cancel.body.policy.status).toBe('cancelled_by_user');
    expect(cancel.body.policy.terminated_at).not.toBeNull();
  });

  it('topup returns current policy without state change', async () => {
    const { app } = buildApp();
    const walletAddr = '0x' + '3'.repeat(40);
    const pol = await request(app)
      .post('/policies/create')
      .send({
        wallet_addr: walletAddr,
        home_country: 'US',
        session_key_pubkey: 'a'.repeat(64),
        authorization_signature: 'a'.repeat(130),
        cap_usdc: 50,
        validity_days: 30,
      });
    const policy_id = pol.body.policy.policy_id;
    const tu = await request(app)
      .post('/policies/topup')
      .send({ policy_id, amount_usdc: 5 });
    expect(tu.status).toBe(200);
    expect(tu.body.policy.policy_id).toBe(policy_id);
    expect(tu.body.topup_usdc).toBe(5);
  });

  it('admin/metrics returns snapshot', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/admin/metrics');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('active_policies');
    expect(r.body).toHaveProperty('signal_latency_ms');
  });

  it('admin/policy/:id returns placeholder payload', async () => {
    const { app } = buildApp();
    const walletAddr = '0x' + '4'.repeat(40);
    const pol = await request(app)
      .post('/policies/create')
      .send({
        wallet_addr: walletAddr,
        home_country: 'US',
        session_key_pubkey: 'a'.repeat(64),
        authorization_signature: 'a'.repeat(130),
        cap_usdc: 50,
        validity_days: 30,
      });
    const policy_id = pol.body.policy.policy_id;
    const insp = await request(app).get(`/admin/policy/${policy_id}`);
    expect(insp.status).toBe(200);
    expect(insp.body.policy.policy_id).toBe(policy_id);

    const miss = await request(app).get('/admin/policy/missing');
    expect(miss.status).toBe(404);
  });

  it('claims endpoints surface NotImplemented', async () => {
    const { app } = buildApp();
    const submit = await request(app).post('/claims/submit').send({});
    expect(submit.status).toBe(501);
    const approve = await request(app).post('/claims/approve').send({});
    expect(approve.status).toBe(501);
    const replay = await request(app).post('/admin/replay').send({});
    expect(replay.status).toBe(501);
  });

  it('404 for unknown route', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/nope');
    expect(r.status).toBe(404);
  });

  it('400 for bad create payload', async () => {
    const { app } = buildApp();
    const r = await request(app).post('/policies/create').send({});
    expect(r.status).toBe(400);
  });

  it('500 for unknown crash is handled', async () => {
    const { app, store } = buildApp();
    // force a crash by monkeypatching one of the store methods
    store.policies.byId = async () => {
      throw new Error('boom');
    };
    const r = await request(app)
      .post('/policies/fund')
      .send({ policy_id: 'p', amount_usdc: 1 });
    expect(r.status).toBe(500);
  });
});
