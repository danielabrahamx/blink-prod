import { describe, it, expect } from 'vitest';
import {
  canonicalizeEnvelope,
  signEnvelope,
  verifyEnvelope,
  generateDeviceKey,
} from '../src/signal-collector/envelope';
import type { Envelope } from '../src/signal-collector/types';
import canonicalize from 'canonicalize';

// RFC 8785 Appendix B.4 test vector (a.k.a. the "composite" vector from
// the reference cyberphone/json-canonicalization suite). Keys must be
// UTF-16 code-unit sorted and numbers must use the shortest round-trippable
// form (ES6 number-to-string).
const JCS_VECTORS: Array<[unknown, string]> = [
  // Empty object
  [{}, '{}'],
  // Simple sort
  [
    { b: 1, a: 2 },
    '{"a":2,"b":1}',
  ],
  // Nested sort + primitive types
  [
    { z: null, a: true, m: 'x' },
    '{"a":true,"m":"x","z":null}',
  ],
  // Arrays preserve order
  [
    { a: [3, 1, 2], b: 'hi' },
    '{"a":[3,1,2],"b":"hi"}',
  ],
  // UTF-16 sort: 'Z' (U+005A) comes before 'a' (U+0061)
  [
    { a: 1, Z: 2 },
    '{"Z":2,"a":1}',
  ],
  // Unicode escape handling: canonical form does NOT escape printable
  // non-ASCII; the canonicalize lib emits raw UTF-8 per RFC 8785 sec 3.2.2.2
  [
    { key: 'Iñtërnâtiônàlizætiøn' },
    '{"key":"Iñtërnâtiônàlizætiøn"}',
  ],
  // Number formatting: no trailing zeros, lower-case 'e'
  [{ n: 1.5 }, '{"n":1.5}'],
  [{ n: 1e21 }, '{"n":1e+21}'],
];

describe('JCS canonicalization', () => {
  it.each(JCS_VECTORS)('vector %# matches RFC 8785 expected output', (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });
});

function fixtureEnvelope(): Envelope {
  return {
    schema_version: '1.0',
    policy_id: 'pol_01HXAMPLE',
    client_ts: '2026-04-21T13:30:00Z',
    client_nonce: '018f7d48-6c9c-7b4c-a0e1-000000000001',
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
}

describe('canonicalizeEnvelope', () => {
  it('produces the same string regardless of input key order', () => {
    const env1 = fixtureEnvelope();
    const env2: Envelope = {
      signals: {
        battery_health_pct: 92,
        input_idle_flag: false,
        app_category: 'productivity',
        lid_state: 'open',
        charging_state: 'ac',
        wifi_trust: 'home',
      },
      event_signal: null,
      trigger: 'scheduled',
      client_nonce: '018f7d48-6c9c-7b4c-a0e1-000000000001',
      client_ts: '2026-04-21T13:30:00Z',
      policy_id: 'pol_01HXAMPLE',
      schema_version: '1.0',
    };
    expect(canonicalizeEnvelope(env1)).toBe(canonicalizeEnvelope(env2));
  });

  it('sorts top-level keys lexicographically', () => {
    const out = canonicalizeEnvelope(fixtureEnvelope());
    const indexOf = (s: string) => out.indexOf(`"${s}"`);
    expect(indexOf('client_nonce')).toBeLessThan(indexOf('client_ts'));
    expect(indexOf('client_ts')).toBeLessThan(indexOf('event_signal'));
    expect(indexOf('event_signal')).toBeLessThan(indexOf('policy_id'));
    expect(indexOf('policy_id')).toBeLessThan(indexOf('schema_version'));
    expect(indexOf('schema_version')).toBeLessThan(indexOf('signals'));
    expect(indexOf('signals')).toBeLessThan(indexOf('trigger'));
  });
});

describe('signEnvelope + verifyEnvelope round-trip', () => {
  it('valid signature verifies', () => {
    const key = generateDeviceKey();
    const env = fixtureEnvelope();
    const signed = signEnvelope(env, key);
    expect(verifyEnvelope(signed)).toBe(true);
  });

  it('mutated envelope fails verification', () => {
    const key = generateDeviceKey();
    const signed = signEnvelope(fixtureEnvelope(), key);
    const tampered = {
      ...signed,
      envelope: {
        ...signed.envelope,
        signals: { ...signed.envelope.signals, charging_state: 'battery' as const },
      },
    };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  it('mutated signature fails verification', () => {
    const key = generateDeviceKey();
    const signed = signEnvelope(fixtureEnvelope(), key);
    const buf = Buffer.from(signed.signature, 'base64');
    buf[0] ^= 0xff;
    const tampered = { ...signed, signature: buf.toString('base64') };
    expect(verifyEnvelope(tampered)).toBe(false);
  });

  it('different key fails verification', () => {
    const kA = generateDeviceKey();
    const kB = generateDeviceKey();
    const signed = signEnvelope(fixtureEnvelope(), kA);
    const wrong = { ...signed, public_key: Buffer.from(kB.publicKey).toString('base64') };
    expect(verifyEnvelope(wrong)).toBe(false);
  });

  it('rejects envelope with unexpected signal field at sign time', () => {
    const key = generateDeviceKey();
    const bad = fixtureEnvelope() as unknown as Record<string, unknown>;
    (bad.signals as Record<string, unknown>).motion_magnitude = 0.1;
    expect(() => signEnvelope(bad as unknown as Envelope, key)).toThrow(/whitelist/);
  });
});
