import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  createPrivateKey,
} from 'node:crypto';
import { jcs } from '../lib/jcs.js';
import { verifyEnvelopeSignature } from './signature.js';
import type { SignalEnvelope } from '../types/index.js';
import { UnauthorizedError } from '../lib/errors.js';

function makePair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32); // last 32 bytes of SPKI = raw Ed25519 pubkey
  return { privateKey, publicKey, rawPub };
}

function signEnvelope(env: SignalEnvelope, privateKey: ReturnType<typeof createPrivateKey>) {
  const canonical = Buffer.from(jcs(env), 'utf8');
  return cryptoSign(null, canonical, privateKey).toString('base64');
}

const envelope: SignalEnvelope = {
  schema_version: '1.0',
  policy_id: 'pol_test',
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

describe('verifyEnvelopeSignature', () => {
  it('accepts a valid signature (raw 32-byte pubkey as hex)', () => {
    const { privateKey, rawPub } = makePair();
    const sig = signEnvelope(envelope, privateKey);
    expect(() =>
      verifyEnvelopeSignature(envelope, sig, rawPub.toString('hex')),
    ).not.toThrow();
  });

  it('accepts a valid signature (raw 32-byte pubkey as base64)', () => {
    const { privateKey, rawPub } = makePair();
    const sig = signEnvelope(envelope, privateKey);
    expect(() =>
      verifyEnvelopeSignature(envelope, sig, rawPub.toString('base64')),
    ).not.toThrow();
  });

  it('rejects a tampered envelope', () => {
    const { privateKey, rawPub } = makePair();
    const sig = signEnvelope(envelope, privateKey);
    const tampered = {
      ...envelope,
      signals: { ...envelope.signals, wifi_trust: 'public' as const },
    };
    expect(() =>
      verifyEnvelopeSignature(tampered, sig, rawPub.toString('hex')),
    ).toThrow(UnauthorizedError);
  });

  it('rejects a bad signature', () => {
    const { rawPub } = makePair();
    const fakeSig = Buffer.alloc(64, 0).toString('base64');
    expect(() =>
      verifyEnvelopeSignature(envelope, fakeSig, rawPub.toString('hex')),
    ).toThrow(UnauthorizedError);
  });

  it('rejects an unreadable pubkey', () => {
    const { privateKey } = makePair();
    const sig = signEnvelope(envelope, privateKey);
    expect(() =>
      verifyEnvelopeSignature(envelope, sig, 'not-hex-not-base64?!'),
    ).toThrow(UnauthorizedError);
  });

  it('rejects a pubkey of wrong length', () => {
    const { privateKey } = makePair();
    const sig = signEnvelope(envelope, privateKey);
    expect(() =>
      verifyEnvelopeSignature(envelope, sig, '00'.repeat(16)),
    ).toThrow(UnauthorizedError);
  });
});
