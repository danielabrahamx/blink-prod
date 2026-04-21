import { describe, it, expect, beforeEach } from 'vitest';
import { replay } from './replay.js';
import { setRiskEngine } from '../risk/index.js';
import type { Policy, SignalEnvelope } from '../types/index.js';

const policy: Policy = {
  policy_id: 'p1',
  wallet_addr: '0x' + '1'.repeat(40),
  home_country: 'US',
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
  calibrated_at: null,
  terminated_at: null,
};

const envelope: SignalEnvelope = {
  schema_version: '1.0',
  policy_id: 'p1',
  client_ts: '2026-04-21T12:00:00Z',
  client_nonce: 'n',
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

describe('admin replay', () => {
  beforeEach(() => {
    setRiskEngine({
      version: 'test_v1',
      score: (features) => ({
        multiplier: 1.0,
        model_version: 'test_v1',
        features,
        explanation: { factors: [], base_multiplier: 1, final_multiplier: 1 },
        computed_at: '2026-04-21T12:00:00Z',
      }),
    });
  });

  it('computes delta for one minute with matching charge', () => {
    const result = replay({
      policy,
      envelopes: [
        { envelope, ip_country: 'US', received_at: '2026-04-21T12:00:00Z' },
      ],
      originalAccrual: [
        {
          policy_id: 'p1',
          ts: '2026-04-21T12:00:00Z',
          duration_seconds: 60,
          base_rate_usdc: 0.000005,
          multiplier: 1,
          charged_usdc: 0.0003,
          model_version: 'rulebook_v1.0.0',
        },
      ],
      baseRateUsdc: 0.000005,
      secondsPerEnvelope: 60,
    });
    expect(result.model_version).toBe('test_v1');
    expect(result.points.length).toBe(1);
    expect(result.hypothetical_total_usdc).toBeCloseTo(0.0003);
    expect(result.delta_usdc).toBeCloseTo(0);
  });

  it('surfaces delta when model changes', () => {
    setRiskEngine({
      version: 'test_v2',
      score: (features) => ({
        multiplier: 2.0,
        model_version: 'test_v2',
        features,
        explanation: { factors: [], base_multiplier: 1, final_multiplier: 2 },
        computed_at: '2026-04-21T12:00:00Z',
      }),
    });
    const result = replay({
      policy,
      envelopes: [
        { envelope, ip_country: 'US', received_at: '2026-04-21T12:00:00Z' },
      ],
      originalAccrual: [
        {
          policy_id: 'p1',
          ts: '2026-04-21T12:00:00Z',
          duration_seconds: 60,
          base_rate_usdc: 0.000005,
          multiplier: 1,
          charged_usdc: 0.0003,
          model_version: 'rulebook_v1.0.0',
        },
      ],
      baseRateUsdc: 0.000005,
      secondsPerEnvelope: 60,
    });
    expect(result.hypothetical_total_usdc).toBeCloseTo(0.0006);
    expect(result.delta_usdc).toBeCloseTo(0.0003);
  });
});
