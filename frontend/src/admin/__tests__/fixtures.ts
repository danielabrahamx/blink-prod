import type { AdminMetrics, PolicyInspectorData, ReplayResult } from '../types';

export const fixturePolicy: PolicyInspectorData = {
  policy_id: 'pol_test_0001',
  wallet_addr: '0x2222222222222222222222222222222222222222',
  current_state: 'active',
  current_multiplier: 1.12,
  breakdown: {
    base: 1.0,
    factors: [
      { signal: 'wifi.ssid_trust', weight: 0.4, contribution: -0.02, note: 'Home SSID' },
      { signal: 'location.geo_ip', weight: 0.25, contribution: 0.09, note: 'Abroad' },
    ],
    multiplier: 1.12,
    rulebook_version: 'v1.0.0',
    computed_at: '2026-04-21T10:00:00.000Z',
  },
  signal_timeline_24h: [
    {
      signal_id: 'sig_0001',
      kind: 'wifi',
      received_at: '2026-04-21T09:00:00.000Z',
      latency_ms: 40,
      verified: true,
      payload_digest: '0xdeadbeef0001',
    },
  ],
  feature_history: [
    {
      computed_at: '2026-04-21T09:00:00.000Z',
      rulebook_version: 'v1.0.0',
      features: { ssid_trust: 1, lid_open: 1 },
      multiplier: 1.0,
    },
  ],
  accrual_ledger: [
    {
      minute_index: 0,
      ts: '2026-04-21T09:00:00.000Z',
      rate_usdc: 0.000005,
      multiplier: 1.0,
      accrued_usdc: 0.0003,
      state: 'active',
    },
    {
      minute_index: 1,
      ts: '2026-04-21T09:01:00.000Z',
      rate_usdc: 0.000005,
      multiplier: 1.12,
      accrued_usdc: 0.000336,
      state: 'active',
    },
  ],
  escrow_authorization: {
    authorization_id: 'auth_test_0001',
    cap_usdc: 50,
    consumed_usdc: 12.5,
    consumption_pct: 25,
    valid_until: '2026-05-21T00:00:00.000Z',
    session_key_pubkey: '0xabcdef0123456789',
    revoked: false,
  },
  settlement_receipts: [
    {
      receipt_id: 'rcpt_0001',
      settled_at: '2026-04-20T23:00:00.000Z',
      amount_usdc: 6.25,
      tx_hash: '0xbeef',
      status: 'settled',
    },
  ],
  claims: [],
  fsm_log: [
    {
      ts: '2026-04-21T09:00:00.000Z',
      from: 'calibrating',
      to: 'active',
      reason: 'calibration_window_elapsed',
      actor: 'system',
    },
  ],
};

export const fixtureMetrics: AdminMetrics = {
  generated_at: '2026-04-21T12:00:00.000Z',
  active_policies: 7,
  avg_multiplier: 1.08,
  ingest_latency_ms: { p50: 42, p95: 110, p99: 185 },
  claim_queue_depth: 0,
  authorization_consumption_pct: 21.5,
};

export const fixtureReplay: ReplayResult = {
  request: {
    policy_id: 'pol_test_0001',
    window_start: '2026-04-21T09:00',
    window_end: '2026-04-21T10:00',
    model_version: 'v1.0.0',
  },
  generated_at: '2026-04-21T12:00:00.000Z',
  minute_series: [
    {
      ts: '2026-04-21T09:00:00.000Z',
      multiplier_replay: 1.0,
      multiplier_actual: 1.0,
      delta: 0,
      accrued_delta_usdc: 0,
    },
    {
      ts: '2026-04-21T09:01:00.000Z',
      multiplier_replay: 1.05,
      multiplier_actual: 1.02,
      delta: 0.03,
      accrued_delta_usdc: 0.0000009,
    },
  ],
  total_accrued_delta_usdc: 0.0000009,
};
