import { describe, expect, it, beforeEach } from 'vitest';
import { FakePool, fakeUuidFactory } from '../db/fake';
import {
  storeAuthorization,
  getActive,
  getById,
  consume,
  revoke,
  ConsumeRejected,
} from './authorization';
import type { AuthorizationInput } from './types';

const WALLET = '0x1111111111111111111111111111111111111111';
const SESSION = '0x2222222222222222222222222222222222222222';
const NONCE = '0x' + 'ab'.repeat(32);
const SIG = ('0x' + '11'.repeat(65)) as `0x${string}`;

function baseInput(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    policyId: 'pol-1',
    userWallet: WALLET as `0x${string}`,
    sessionPubkey: SESSION as `0x${string}`,
    capUsdc: '50.000000',
    validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    signature: SIG,
    nonce: NONCE as `0x${string}`,
    chainId: 5_042_002,
    ...overrides,
  };
}

describe('authorization', () => {
  let db: FakePool;
  beforeEach(() => {
    db = new FakePool();
    db.setIdFactory(fakeUuidFactory('auth'));
  });

  it('stores a valid authorization and echoes fields back', async () => {
    const stored = await storeAuthorization(baseInput(), db);
    expect(stored.policyId).toBe('pol-1');
    expect(stored.capUsdc).toBe('50.000000');
    expect(stored.consumedUsdc).toBe('0.000000');
    expect(stored.authId).toMatch(/^auth-/);
    expect(stored.revokedAt).toBeNull();
  });

  it('rejects chainId mismatch', async () => {
    await expect(storeAuthorization(baseInput({ chainId: 1 }), db)).rejects.toThrow(/chainId/);
  });

  it('rejects past validity', async () => {
    await expect(
      storeAuthorization(baseInput({ validUntil: new Date(Date.now() - 1000) }), db),
    ).rejects.toThrow(/(past|validUntil)/);
  });

  it('rejects zero cap', async () => {
    await expect(storeAuthorization(baseInput({ capUsdc: '0' }), db)).rejects.toThrow(/capUsdc/);
  });

  it('rejects malformed signature', async () => {
    await expect(
      storeAuthorization(baseInput({ signature: '0xdeadbeef' as `0x${string}` }), db),
    ).rejects.toThrow(/signature/);
  });

  it('rejects malformed nonce', async () => {
    await expect(
      storeAuthorization(baseInput({ nonce: '0xabcd' as `0x${string}` }), db),
    ).rejects.toThrow(/nonce/);
  });

  it('getActive returns the most recent non-revoked auth', async () => {
    await storeAuthorization(baseInput(), db);
    const second = await storeAuthorization(
      baseInput({ nonce: ('0x' + 'cd'.repeat(32)) as `0x${string}` }),
      db,
    );
    const active = await getActive('pol-1', db);
    expect(active?.authId).toBe(second.authId);
  });

  it('consume atomically enforces cap and returns updated state', async () => {
    const stored = await storeAuthorization(baseInput({ capUsdc: '1.000000' }), db);
    const after1 = await consume(stored.authId, '0.300000', db);
    expect(after1.consumedUsdc).toBe('0.300000');
    const after2 = await consume(stored.authId, '0.400000', db);
    expect(after2.consumedUsdc).toBe('0.700000');
  });

  it('consume rejects overspend with cap_exceeded', async () => {
    const stored = await storeAuthorization(baseInput({ capUsdc: '1.000000' }), db);
    await consume(stored.authId, '0.900000', db);
    try {
      await consume(stored.authId, '0.200000', db);
      expect.fail('expected ConsumeRejected');
    } catch (err) {
      expect(err).toBeInstanceOf(ConsumeRejected);
      expect((err as ConsumeRejected).reason).toBe('cap_exceeded');
    }
    // state remains unchanged after reject
    const state = await getById(stored.authId, db);
    expect(state?.consumedUsdc).toBe('0.900000');
  });

  it('consume is idempotent: zero-dollar charge is a no-op', async () => {
    const stored = await storeAuthorization(baseInput(), db);
    const after = await consume(stored.authId, '0.000000', db);
    expect(after.consumedUsdc).toBe('0.000000');
  });

  it('revoke flips revoked_at and blocks further consume', async () => {
    const stored = await storeAuthorization(baseInput(), db);
    const revoked = await revoke(stored.authId, db);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    await expect(consume(stored.authId, '0.100000', db)).rejects.toMatchObject({ reason: 'revoked' });
  });

  it('revoke twice is safe (second call returns null)', async () => {
    const stored = await storeAuthorization(baseInput(), db);
    await revoke(stored.authId, db);
    const second = await revoke(stored.authId, db);
    expect(second).toBeNull();
  });

  it('getActive returns null if auth expired', async () => {
    const stored = await storeAuthorization(
      baseInput({ validUntil: new Date(Date.now() + 50) }),
      db,
    );
    await new Promise((r) => setTimeout(r, 100));
    const active = await getActive(stored.policyId, db);
    expect(active).toBeNull();
  });

  it('consume rejects expired auth', async () => {
    const stored = await storeAuthorization(
      baseInput({ validUntil: new Date(Date.now() + 50) }),
      db,
    );
    await new Promise((r) => setTimeout(r, 100));
    await expect(consume(stored.authId, '0.100000', db)).rejects.toMatchObject({ reason: 'expired' });
  });
});
