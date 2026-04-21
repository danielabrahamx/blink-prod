import { describe, it, expect } from 'vitest';
import { loadInspector } from './inspector.js';
import type { Policy } from '../types/index.js';

const policy: Policy = {
  policy_id: 'p1',
  wallet_addr: '0x' + '1'.repeat(40),
  home_country: 'US',
  status: 'active',
  created_at: '2026-04-01T00:00:00Z',
  calibrated_at: '2026-04-03T00:00:00Z',
  terminated_at: null,
};

describe('admin inspector', () => {
  it('returns null when policy missing', async () => {
    const out = await loadInspector(
      {
        loadPolicy: async () => null,
        loadEnvelopes: async () => [],
        loadScores: async () => [],
        loadAccrual: async () => [],
        loadFsmLog: async () => [],
      },
      'missing',
    );
    expect(out).toBeNull();
  });

  it('assembles an inspector payload', async () => {
    const out = await loadInspector(
      {
        loadPolicy: async () => policy,
        loadEnvelopes: async () => [],
        loadScores: async () => [
          {
            multiplier: 1.2,
            model_version: 'rulebook_v1.0.0',
            features: {
              wifi_trust_score: 1,
              at_desk_confidence: 1,
              jurisdiction_match: true,
              device_age_risk: 0,
              time_of_day: 12,
              activity_signal: 'active',
              policy_age_days: 10,
            },
            explanation: {
              factors: [],
              base_multiplier: 1,
              final_multiplier: 1.2,
            },
            computed_at: '2026-04-21T00:00:00Z',
          },
        ],
        loadAccrual: async () => [],
        loadFsmLog: async () => [
          { from: 'draft', to: 'calibrating', ts: '2026-04-01T00:00:00Z' },
        ],
      },
      'p1',
    );
    expect(out).not.toBeNull();
    expect(out?.current_multiplier).toBeCloseTo(1.2);
    expect(out?.fsm_log.length).toBe(1);
  });

  it('emits null current_multiplier when no scores', async () => {
    const out = await loadInspector(
      {
        loadPolicy: async () => policy,
        loadEnvelopes: async () => [],
        loadScores: async () => [],
        loadAccrual: async () => [],
        loadFsmLog: async () => [],
      },
      'p1',
    );
    expect(out?.current_multiplier).toBeNull();
  });
});
