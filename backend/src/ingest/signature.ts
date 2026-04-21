import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { jcs } from '../lib/jcs.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { SignalEnvelope } from '../types/index.js';

/**
 * Verify Ed25519 signature over JCS(envelope).
 *
 * Signature and public-key inputs may be supplied in base64 or hex. Keys
 * may be raw 32-byte Ed25519 ("OKP") or DER-encoded SPKI; raw is auto-
 * wrapped as SPKI before feeding into node:crypto.
 */

const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function toBuf(input: string): Buffer {
  const s = input.trim();
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    return Buffer.from(s, 'hex');
  }
  try {
    return Buffer.from(s, 'base64');
  } catch {
    throw new UnauthorizedError('signature or pubkey is not valid hex/base64');
  }
}

function buildKeyObject(pubkeyInput: string) {
  const buf = toBuf(pubkeyInput);
  if (buf.length === 32) {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, buf]);
    return createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }
  if (buf.length > 32) {
    // Assume SPKI-DER already.
    return createPublicKey({ key: buf, format: 'der', type: 'spki' });
  }
  throw new UnauthorizedError('unsupported pubkey length');
}

export function verifyEnvelopeSignature(
  envelope: SignalEnvelope,
  signature: string,
  devicePubkey: string,
): void {
  let keyObj;
  try {
    keyObj = buildKeyObject(devicePubkey);
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    throw new UnauthorizedError('invalid device pubkey');
  }
  const sigBuf = toBuf(signature);
  const canonical = Buffer.from(jcs(envelope), 'utf8');
  // Ed25519 does not use a digest; pass null as algorithm.
  const ok = cryptoVerify(null, canonical, keyObj, sigBuf);
  if (!ok) {
    throw new UnauthorizedError('signature verification failed');
  }
}
