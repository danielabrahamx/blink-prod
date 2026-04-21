import { describe, it, expect, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import * as sessionKey from './index.js';
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

describe('session-key', () => {
  beforeEach(() => {
    keytarMock.__reset();
  });

  it('generates and persists a keypair on first access', async () => {
    const pub = await sessionKey.getPublicKey();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(keytarMock.__size()).toBe(1);
  });

  it('returns the same public key on subsequent calls', async () => {
    const first = await sessionKey.getPublicKey();
    const second = await sessionKey.getPublicKey();
    expect(second).toBe(first);
  });

  it('getInfo returns createdAt timestamp', async () => {
    const info = await sessionKey.getInfo();
    expect(info.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(info.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(info.rotatedAt).toBeNull();
  });

  it('rotate() replaces the stored keypair and records rotatedAt', async () => {
    const original = await sessionKey.getPublicKey();
    const rotated = await sessionKey.rotate();
    expect(rotated).not.toBe(original);
    const info = await sessionKey.getInfo();
    expect(info.publicKey).toBe(rotated);
    expect(info.rotatedAt).not.toBeNull();
  });

  it('sign produces a valid Ed25519 signature verifiable by the public key', async () => {
    const pub = await sessionKey.getPublicKey();
    const msg = new TextEncoder().encode('x402-authorization-v1');
    const sig = await sessionKey.sign(msg);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    const ok = await ed.verifyAsync(sig, msg, fromHex(pub));
    expect(ok).toBe(true);
  });

  it('sign produces different signatures after rotate() -- old sigs stop verifying', async () => {
    const msg = new TextEncoder().encode('receipt-1');
    const oldPub = await sessionKey.getPublicKey();
    const oldSig = await sessionKey.sign(msg);
    expect(await ed.verifyAsync(oldSig, msg, fromHex(oldPub))).toBe(true);

    await sessionKey.rotate();
    const newPub = await sessionKey.getPublicKey();
    const newSig = await sessionKey.sign(msg);
    expect(await ed.verifyAsync(newSig, msg, fromHex(newPub))).toBe(true);
    // Old signature must not verify against the new key.
    expect(await ed.verifyAsync(oldSig, msg, fromHex(newPub))).toBe(false);
  });

  it('__reset clears the credential store', async () => {
    await sessionKey.getPublicKey();
    expect(keytarMock.__size()).toBe(1);
    await sessionKey.__reset();
    expect(keytarMock.__size()).toBe(0);
  });

  it('throws on corrupt keychain payload', async () => {
    keytarMock.__seed('Blink', 'session-key', 'not-a-valid-record');
    await expect(sessionKey.getPublicKey()).rejects.toThrow(/corrupt keychain record/);
  });
});
