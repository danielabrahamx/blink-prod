import { describe, it, expect } from 'vitest';
import {
  envelopeSchema,
  signedEnvelopeSchema,
  registerDeviceSchema,
  createPolicySchema,
  fundPolicySchema,
} from './schema.js';

const goodEnvelope = {
  schema_version: '1.0',
  policy_id: 'pol_abc',
  client_ts: '2026-04-21T13:30:00Z',
  client_nonce: '01900000-0000-7000-8000-000000000000',
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

describe('schemas', () => {
  it('accepts a well-formed envelope', () => {
    expect(() => envelopeSchema.parse(goodEnvelope)).not.toThrow();
  });

  it('rejects unknown wifi_trust', () => {
    expect(() =>
      envelopeSchema.parse({
        ...goodEnvelope,
        signals: { ...goodEnvelope.signals, wifi_trust: 'banana' },
      }),
    ).toThrow();
  });

  it('allows null app_category and battery_health_pct', () => {
    expect(() =>
      envelopeSchema.parse({
        ...goodEnvelope,
        signals: {
          ...goodEnvelope.signals,
          app_category: null,
          battery_health_pct: null,
        },
      }),
    ).not.toThrow();
  });

  it('signed envelope requires signature and device_id', () => {
    expect(() =>
      signedEnvelopeSchema.parse({
        envelope: goodEnvelope,
        signature: 'abcd'.repeat(4),
        device_id: 'dev_1',
      }),
    ).not.toThrow();
    expect(() =>
      signedEnvelopeSchema.parse({ envelope: goodEnvelope }),
    ).toThrow();
  });

  it('rejects bad client_ts', () => {
    expect(() =>
      envelopeSchema.parse({ ...goodEnvelope, client_ts: 'nope' }),
    ).toThrow();
  });

  it('registerDevice requires hex wallet', () => {
    expect(() =>
      registerDeviceSchema.parse({
        wallet_addr: '0x' + '0'.repeat(40),
        device_pubkey: 'a'.repeat(64),
        platform: 'win32',
        os_version: '11.0',
      }),
    ).not.toThrow();
    expect(() =>
      registerDeviceSchema.parse({
        wallet_addr: 'not-a-wallet',
        device_pubkey: 'a'.repeat(64),
        platform: 'win32',
        os_version: '11.0',
      }),
    ).toThrow();
  });

  it('createPolicy requires 2-letter country', () => {
    expect(() =>
      createPolicySchema.parse({
        wallet_addr: '0x' + '1'.repeat(40),
        home_country: 'USA',
        session_key_pubkey: 'a'.repeat(64),
        authorization_signature: 'a'.repeat(128),
        cap_usdc: 50,
        validity_days: 30,
      }),
    ).toThrow();
  });

  it('fundPolicy requires positive amount', () => {
    expect(() =>
      fundPolicySchema.parse({ policy_id: 'p', amount_usdc: 0 }),
    ).toThrow();
  });
});
