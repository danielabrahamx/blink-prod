import { describe, it, expect, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import * as deviceKey from './index.js';
import * as sessionKey from '../session-key/index.js';
import * as keytarMock from '../__mocks__/keytar.js';

ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed.etc.concatBytes(...m));

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('device-key', () => {
  beforeEach(() => {
    keytarMock.__reset();
  });

  it('generates a long-lived device keypair on first call', async () => {
    const pub = await deviceKey.getPublicKey();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a different keychain slot than session-key', async () => {
    const device = await deviceKey.getPublicKey();
    const session = await sessionKey.getPublicKey();
    expect(device).not.toBe(session);
    expect(keytarMock.__size()).toBe(2);
  });

  it('rotate() replaces the device key', async () => {
    const original = await deviceKey.getPublicKey();
    const rotated = await deviceKey.rotate();
    expect(rotated).not.toBe(original);
  });

  it('sign produces a signature verifiable against the device pubkey', async () => {
    const pub = await deviceKey.getPublicKey();
    const msg = new TextEncoder().encode('signal-envelope-canonical-bytes');
    const sig = await deviceKey.sign(msg);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    expect(await ed.verifyAsync(sig, msg, fromHex(pub))).toBe(true);
  });

  it('fingerprint is a 64-char hex SHA-256', async () => {
    const fp = await deviceKey.fingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across calls on the same machine', async () => {
    const a = await deviceKey.fingerprint();
    const b = await deviceKey.fingerprint();
    expect(a).toBe(b);
  });

  it('__reset clears the device-key slot but leaves session-key alone', async () => {
    await deviceKey.getPublicKey();
    await sessionKey.getPublicKey();
    expect(keytarMock.__size()).toBe(2);
    await deviceKey.__reset();
    expect(keytarMock.__size()).toBe(1);
  });
});
