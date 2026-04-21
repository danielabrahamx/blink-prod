import { describe, it, expect } from 'vitest';
import {
  extractFeatures,
  wifiTrustScore,
  atDeskConfidence,
  deviceAgeRisk,
  activitySignal,
  policyAgeDays,
  timeOfDayFromCountry,
} from './index.js';
import type { SignalEnvelope } from '../types/index.js';

function env(overrides: Partial<SignalEnvelope['signals']> = {}): SignalEnvelope {
  return {
    schema_version: '1.0',
    policy_id: 'p1',
    client_ts: '2026-04-21T13:30:00Z',
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
      ...overrides,
    },
  };
}

describe('features extractor', () => {
  it('wifiTrustScore covers all tiers', () => {
    expect(wifiTrustScore('home')).toBe(1);
    expect(wifiTrustScore('known')).toBeCloseTo(0.8);
    expect(wifiTrustScore('public')).toBeCloseTo(0.2);
    expect(wifiTrustScore('unknown')).toBeCloseTo(0.1);
    expect(wifiTrustScore('offline')).toBe(0);
  });

  it('atDeskConfidence peaks with lid open + ac + active', () => {
    expect(atDeskConfidence(env())).toBeCloseTo(1);
    expect(
      atDeskConfidence(env({ charging_state: 'battery' })),
    ).toBeCloseTo(0.7);
    expect(
      atDeskConfidence(env({ lid_state: 'closed' })),
    ).toBeCloseTo(0.5);
  });

  it('deviceAgeRisk defaults to 0.3 on null', () => {
    expect(deviceAgeRisk(null)).toBeCloseTo(0.3);
    expect(deviceAgeRisk(100)).toBeCloseTo(0);
    expect(deviceAgeRisk(50)).toBeCloseTo(0.5);
    expect(deviceAgeRisk(-10)).toBeCloseTo(1); // clamp
    expect(deviceAgeRisk(999)).toBeCloseTo(0); // clamp
  });

  it('activitySignal follows lid then idle', () => {
    expect(activitySignal(env({ lid_state: 'closed' }))).toBe('sleep');
    expect(activitySignal(env({ input_idle_flag: true }))).toBe('idle');
    expect(activitySignal(env())).toBe('active');
  });

  it('policyAgeDays handles malformed ts', () => {
    expect(policyAgeDays('junk', new Date())).toBe(0);
  });

  it('timeOfDayFromCountry uses UTC hour', () => {
    const h = timeOfDayFromCountry(new Date('2026-04-21T23:00:00Z'), 'GB');
    expect(h).toBe(23);
  });

  it('jurisdiction_match case insensitive', () => {
    const fv = extractFeatures({
      envelope: env(),
      ip_country: 'gb',
      policy: {
        policy_id: 'p',
        home_country: 'GB',
        created_at: '2026-04-01T00:00:00Z',
      },
    });
    expect(fv.jurisdiction_match).toBe(true);
  });

  it('jurisdiction_match false on mismatch or null', () => {
    const fvMismatch = extractFeatures({
      envelope: env(),
      ip_country: 'DE',
      policy: {
        policy_id: 'p',
        home_country: 'GB',
        created_at: '2026-04-01T00:00:00Z',
      },
    });
    expect(fvMismatch.jurisdiction_match).toBe(false);
    const fvNull = extractFeatures({
      envelope: env(),
      ip_country: null,
      policy: {
        policy_id: 'p',
        home_country: 'GB',
        created_at: '2026-04-01T00:00:00Z',
      },
    });
    expect(fvNull.jurisdiction_match).toBe(false);
  });
});
