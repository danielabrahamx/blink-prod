import { describe, it, expect } from 'vitest';
import {
  SIGNAL_WHITELIST,
  CLIENT_SIGNAL_KEYS,
  ENVELOPE_TOP_LEVEL_KEYS,
  validateEnvelopeShape,
} from '../src/shared/signal-whitelist';

describe('signal whitelist', () => {
  it('has exactly the 7 signals specified by the design doc', () => {
    expect([...SIGNAL_WHITELIST].sort()).toEqual(
      [
        'app_category',
        'battery_health_pct',
        'charging_state',
        'input_idle_flag',
        'ip_country',
        'lid_state',
        'wifi_trust',
      ].sort(),
    );
    expect(SIGNAL_WHITELIST.length).toBe(7);
  });

  it('does NOT contain motion_magnitude (dropped per rev 7)', () => {
    expect(SIGNAL_WHITELIST).not.toContain('motion_magnitude' as never);
  });

  it('client keys exclude server-derived ip_country', () => {
    expect(CLIENT_SIGNAL_KEYS).not.toContain('ip_country' as never);
    expect(CLIENT_SIGNAL_KEYS.length).toBe(6);
  });

  it('envelope top-level keys match the contract', () => {
    expect([...ENVELOPE_TOP_LEVEL_KEYS].sort()).toEqual(
      [
        'client_nonce',
        'client_ts',
        'event_signal',
        'policy_id',
        'schema_version',
        'signals',
        'trigger',
      ].sort(),
    );
  });
});

describe('validateEnvelopeShape', () => {
  const validBody = {
    schema_version: '1.0',
    policy_id: 'pol_1',
    client_ts: '2026-04-21T12:00:00Z',
    client_nonce: 'n1',
    trigger: 'scheduled',
    event_signal: null,
    signals: {
      wifi_trust: 'home',
      charging_state: 'ac',
      lid_state: 'open',
      app_category: 'productivity',
      input_idle_flag: false,
      battery_health_pct: 95,
    },
  };

  it('accepts a clean envelope', () => {
    expect(validateEnvelopeShape(validBody)).toBeNull();
  });

  it('rejects unexpected top-level fields', () => {
    const bad = { ...validBody, extra_debug_payload: 'oops' };
    const reason = validateEnvelopeShape(bad);
    expect(reason).toMatch(/unexpected top-level/);
  });

  it('rejects unexpected signal fields (e.g. motion_magnitude)', () => {
    const bad = { ...validBody, signals: { ...validBody.signals, motion_magnitude: 0.2 } };
    const reason = validateEnvelopeShape(bad);
    expect(reason).toMatch(/unexpected signal: motion_magnitude/);
  });

  it('rejects missing signals object', () => {
    const bad = { ...validBody, signals: undefined };
    delete (bad as Record<string, unknown>).signals;
    expect(validateEnvelopeShape(bad)).toMatch(/signals/);
  });

  it('rejects non-object envelope', () => {
    expect(validateEnvelopeShape(null)).toMatch(/object/);
    expect(validateEnvelopeShape('nope')).toMatch(/object/);
  });
});
