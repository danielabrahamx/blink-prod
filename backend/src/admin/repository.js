// Admin data repository.
//
// Wave 1 seed: returns deterministic fixture data so the frontend is
// build-and-demoable without Postgres + Agent B's schema landing. Wave 3
// merge reconciles with the real repo that Agent A/E wires up.
//
// All timestamps are ISO 8601 UTC. Numbers are plain JS numbers (USDC
// formatted to 6 dp on render).

'use strict';

const FIXED_POLICY = {
  policy_id: 'pol_demo_0001',
  wallet_addr: '0x1111111111111111111111111111111111111111',
  current_state: 'active',
  current_multiplier: 1.12,
  breakdown: {
    base: 1.0,
    factors: [
      {
        signal: 'wifi.ssid_trust',
        weight: 0.4,
        contribution: -0.02,
        note: 'Home SSID confirmed',
      },
      {
        signal: 'lid.state',
        weight: 0.2,
        contribution: 0.0,
        note: 'Lid open',
      },
      {
        signal: 'power.battery_health',
        weight: 0.15,
        contribution: 0.05,
        note: 'Battery health 78%',
      },
      {
        signal: 'location.geo_ip',
        weight: 0.25,
        contribution: 0.09,
        note: 'Outside home country',
      },
    ],
    multiplier: 1.12,
    rulebook_version: 'v1.0.0',
    computed_at: '2026-04-21T10:00:00.000Z',
  },
  signal_timeline_24h: buildSignalTimeline(),
  feature_history: buildFeatureHistory(),
  accrual_ledger: buildAccrualLedger(),
  escrow_authorization: {
    authorization_id: 'auth_demo_0001',
    cap_usdc: 50,
    consumed_usdc: 12.5,
    consumption_pct: 25,
    valid_until: '2026-05-21T00:00:00.000Z',
    session_key_pubkey: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    revoked: false,
  },
  settlement_receipts: [
    {
      receipt_id: 'rcpt_0001',
      settled_at: '2026-04-20T23:00:00.000Z',
      amount_usdc: 6.25,
      tx_hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
      status: 'settled',
    },
    {
      receipt_id: 'rcpt_0002',
      settled_at: '2026-04-21T08:00:00.000Z',
      amount_usdc: 6.25,
      tx_hash: '0xdeadbeef00000000000000000000000000000000000000000000000000000002',
      status: 'settled',
    },
  ],
  claims: [],
  fsm_log: [
    {
      ts: '2026-04-19T09:00:00.000Z',
      from: 'calibrating',
      to: 'calibrating',
      reason: 'initial',
      actor: 'system',
    },
    {
      ts: '2026-04-21T09:00:00.000Z',
      from: 'calibrating',
      to: 'active',
      reason: 'calibration_window_elapsed',
      actor: 'system',
    },
  ],
};

function buildSignalTimeline() {
  const base = Date.parse('2026-04-21T09:00:00.000Z');
  const kinds = ['wifi', 'lid', 'power', 'location', 'windows', 'motion', 'time'];
  const out = [];
  for (let i = 0; i < 24; i += 1) {
    const kind = kinds[i % kinds.length];
    out.push({
      signal_id: `sig_${i.toString().padStart(4, '0')}`,
      kind,
      received_at: new Date(base + i * 60_000).toISOString(),
      latency_ms: 40 + (i % 7) * 15,
      verified: true,
      payload_digest: `0x${'a'.repeat(8)}${i.toString(16).padStart(4, '0')}`,
    });
  }
  return out;
}

function buildFeatureHistory() {
  const base = Date.parse('2026-04-21T09:00:00.000Z');
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    out.push({
      computed_at: new Date(base + i * 60_000).toISOString(),
      rulebook_version: 'v1.0.0',
      features: {
        ssid_trust: i % 3 === 0 ? 1 : 0,
        lid_open: 1,
        battery_health_pct: 78 - (i % 4),
        geo_in_home_country: i < 6 ? 1 : 0,
      },
      multiplier: 1.0 + (i % 6) * 0.02,
    });
  }
  return out;
}

function buildAccrualLedger() {
  const base = Date.parse('2026-04-21T09:00:00.000Z');
  const out = [];
  for (let i = 0; i < 60; i += 1) {
    const rate = 0.000005;
    const mult = 1.0 + (i % 10) * 0.01;
    out.push({
      minute_index: i,
      ts: new Date(base + i * 60_000).toISOString(),
      rate_usdc: rate,
      multiplier: mult,
      accrued_usdc: rate * 60 * mult,
      state: 'active',
    });
  }
  return out;
}

async function getPolicy(policyId) {
  return { ...FIXED_POLICY, policy_id: policyId || FIXED_POLICY.policy_id };
}

async function computeReplay({ policy_id, window_start, window_end, model_version }) {
  const start = Date.parse(window_start);
  const end = Date.parse(window_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw Object.assign(new Error('invalid_time_window'), { statusCode: 400 });
  }
  const stepMs = 60_000;
  const minutes = Math.min(180, Math.max(0, Math.floor((end - start) / stepMs)));
  const rate = 0.000005;
  const series = [];
  let total = 0;
  for (let i = 0; i < minutes; i += 1) {
    const ts = new Date(start + i * stepMs).toISOString();
    const actual = 1.0 + (i % 10) * 0.01;
    const replayMult = 1.0 + (i % 9) * 0.012;
    const delta = replayMult - actual;
    const accruedDelta = rate * 60 * delta;
    series.push({
      ts,
      multiplier_replay: replayMult,
      multiplier_actual: actual,
      delta,
      accrued_delta_usdc: accruedDelta,
    });
    total += accruedDelta;
  }
  return {
    request: { policy_id, window_start, window_end, model_version },
    generated_at: new Date().toISOString(),
    minute_series: series,
    total_accrued_delta_usdc: total,
  };
}

async function getMetrics() {
  return {
    generated_at: new Date().toISOString(),
    active_policies: 7,
    avg_multiplier: 1.08,
    ingest_latency_ms: { p50: 42, p95: 110, p99: 185 },
    claim_queue_depth: 0,
    authorization_consumption_pct: 21.5,
  };
}

module.exports = {
  getPolicy,
  computeReplay,
  getMetrics,
};
