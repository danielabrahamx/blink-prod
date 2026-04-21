// Session key: Ed25519 keypair used to auto-sign 402 settlement responses.
// Persisted in the OS credential store via keytar (Windows Credential Manager
// on the pilot target). The private key never leaves this module -- callers
// request signatures through `sign(message)`.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import * as keytar from 'keytar';
import { KEYCHAIN } from '../shared/constants.js';
import type { KeyInfo } from '../shared/types.js';

// @noble/ed25519 v2 is pure-esm and sync-hash-less by default.
// Wire sha512 on `ed.etc` so the async signing paths are deterministic
// without requiring WebCrypto polyfills in the Node runtime.
ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed.etc.concatBytes(...m));

const SERVICE = KEYCHAIN.service;
const ACCOUNT = KEYCHAIN.accounts.sessionKey;

// Persisted shape: `${privKeyHex}:${createdAtIso}[:${rotatedAtIso}]`
// Keeping it as a single string avoids a second keychain slot and makes
// rotation atomic (either the whole record is replaced or it isn't).
interface PersistedKey {
  privKeyHex: string;
  createdAt: string;
  rotatedAt: string | null;
}

function encode(p: PersistedKey): string {
  return `${p.privKeyHex}:${p.createdAt}:${p.rotatedAt ?? ''}`;
}

function decode(raw: string): PersistedKey {
  const [privKeyHex, createdAt, rotatedAt] = raw.split(':');
  if (!privKeyHex || !createdAt) {
    throw new Error('session-key: corrupt keychain record');
  }
  return {
    privKeyHex,
    createdAt,
    rotatedAt: rotatedAt && rotatedAt.length > 0 ? rotatedAt : null,
  };
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return s;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('session-key: invalid hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('session-key: invalid hex byte');
    out[i] = byte;
  }
  return out;
}

async function generate(): Promise<PersistedKey> {
  // ed25519 private key is 32 random bytes.
  const priv = ed.utils.randomPrivateKey();
  return {
    privKeyHex: toHex(priv),
    createdAt: new Date().toISOString(),
    rotatedAt: null,
  };
}

async function loadOrGenerate(): Promise<PersistedKey> {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  if (raw) return decode(raw);
  const next = await generate();
  await keytar.setPassword(SERVICE, ACCOUNT, encode(next));
  return next;
}

async function toKeyInfo(p: PersistedKey): Promise<KeyInfo> {
  const pub = await ed.getPublicKeyAsync(fromHex(p.privKeyHex));
  return { publicKey: toHex(pub), createdAt: p.createdAt, rotatedAt: p.rotatedAt };
}

/** Return the public key + metadata, generating + persisting a keypair if absent. */
export async function getPublicKey(): Promise<string> {
  const info = await toKeyInfo(await loadOrGenerate());
  return info.publicKey;
}

/** Full key info for diagnostics + onboarding registration. */
export async function getInfo(): Promise<KeyInfo> {
  return toKeyInfo(await loadOrGenerate());
}

/** Replace the stored keypair. Existing authorizations bound to the old key
 *  become invalid server-side -- the backend must issue a fresh challenge. */
export async function rotate(): Promise<string> {
  const next = await generate();
  next.rotatedAt = new Date().toISOString();
  await keytar.setPassword(SERVICE, ACCOUNT, encode(next));
  const info = await toKeyInfo(next);
  return info.publicKey;
}

/** Sign an arbitrary byte message with the session key. Main-process only. */
export async function sign(message: Uint8Array): Promise<Uint8Array> {
  const persisted = await loadOrGenerate();
  return ed.signAsync(message, fromHex(persisted.privKeyHex));
}

/** Test helper: clear the keychain slot. Not exposed over IPC. */
export async function __reset(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
