// Device-identity key: long-lived Ed25519 keypair bound to this install.
// Separate namespace from the session key -- rotating the session key does
// NOT rotate the device key. Device pubkey is registered once during
// onboarding (Module 0) and attests every outbound signal envelope
// (Module 1, `envelope.ts`).

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import * as keytar from 'keytar';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import { KEYCHAIN } from '../shared/constants.js';
import type { KeyInfo } from '../shared/types.js';

// Wire sha512 on @noble/ed25519 v2 so sign/verify work in Node.
ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed.etc.concatBytes(...m));

const SERVICE = KEYCHAIN.service;
const ACCOUNT = KEYCHAIN.accounts.deviceKey;

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
    throw new Error('device-key: corrupt keychain record');
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
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('device-key: invalid hex byte');
    out[i] = byte;
  }
  return out;
}

async function generate(): Promise<PersistedKey> {
  return {
    privKeyHex: toHex(ed.utils.randomPrivateKey()),
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

/** Returns the device public key (hex). Generates on first call. */
export async function getPublicKey(): Promise<string> {
  return (await toKeyInfo(await loadOrGenerate())).publicKey;
}

export async function getInfo(): Promise<KeyInfo> {
  return toKeyInfo(await loadOrGenerate());
}

/** Rare operation -- requires re-registration with the backend afterwards. */
export async function rotate(): Promise<string> {
  const next = await generate();
  next.rotatedAt = new Date().toISOString();
  await keytar.setPassword(SERVICE, ACCOUNT, encode(next));
  return (await toKeyInfo(next)).publicKey;
}

export async function sign(message: Uint8Array): Promise<Uint8Array> {
  const persisted = await loadOrGenerate();
  return ed.signAsync(message, fromHex(persisted.privKeyHex));
}

/**
 * SHA-256 fingerprint of (hostname || primary MAC || platform).
 * Stable across reboots without exposing raw system identifiers to the server.
 * Used by the backend to detect device-key reuse and bind policies to hardware.
 */
export async function fingerprint(): Promise<string> {
  const hostname = os.hostname();
  const macs = Object.values(os.networkInterfaces())
    .flatMap((ifaces) => ifaces ?? [])
    .filter((i) => !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
    .map((i) => i.mac)
    .sort();
  const primaryMac = macs[0] ?? 'unknown';
  const payload = `${hostname}|${primaryMac}|${os.platform()}`;
  return createHash('sha256').update(payload).digest('hex');
}

export async function __reset(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
