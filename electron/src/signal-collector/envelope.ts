/**
 * envelope.ts - assembles, canonicalizes, and signs signal envelopes.
 *
 * Canonicalization: RFC 8785 JCS via the `canonicalize` npm package.
 * Signature: Ed25519 via `tweetnacl`. The device public + private key pair
 * is generated during onboarding and stored in the OS credential vault
 * (keytar). The orchestrator is responsible for providing the secret - this
 * module does not touch the vault itself so that the signing logic remains
 * pure and unit-testable.
 *
 * Public output shape:
 * {
 *   envelope: <Envelope>,
 *   signature: base64(64-byte ed25519),
 *   public_key: base64(32-byte ed25519 public)
 * }
 */

import canonicalize from 'canonicalize';
import nacl from 'tweetnacl';

import type { Envelope, SignedEnvelope } from './types';
import { validateEnvelopeShape } from '../shared/signal-whitelist';

export function canonicalizeEnvelope(envelope: Envelope): string {
  const result = canonicalize(envelope);
  if (typeof result !== 'string') {
    throw new Error('canonicalize returned non-string');
  }
  return result;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export interface DeviceKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Ed25519 sign-detached over the JCS-canonicalized envelope.
 */
export function signEnvelope(envelope: Envelope, key: DeviceKey): SignedEnvelope {
  const shape = validateEnvelopeShape(envelope);
  if (shape !== null) {
    throw new Error(`envelope rejected by whitelist: ${shape}`);
  }
  const canonical = canonicalizeEnvelope(envelope);
  const msg = new TextEncoder().encode(canonical);
  const sig = nacl.sign.detached(msg, key.secretKey);
  return {
    envelope,
    signature: toBase64(sig),
    public_key: toBase64(key.publicKey),
  };
}

/**
 * Round-trip verifier. Returns true when the supplied signature is valid for
 * the embedded envelope under the embedded public key.
 */
export function verifyEnvelope(signed: SignedEnvelope): boolean {
  const shape = validateEnvelopeShape(signed.envelope);
  if (shape !== null) return false;
  const canonical = canonicalizeEnvelope(signed.envelope);
  const msg = new TextEncoder().encode(canonical);
  const sig = fromBase64(signed.signature);
  const pk = fromBase64(signed.public_key);
  try {
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

/** Ed25519 key-pair generator (for onboarding + tests). */
export function generateDeviceKey(): DeviceKey {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}
