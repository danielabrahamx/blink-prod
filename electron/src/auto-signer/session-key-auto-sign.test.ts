import { describe, expect, it, vi } from 'vitest';
import {
  SessionKeyAutoSigner,
  SigningRejected,
  decodePaymentRequired,
  encodePaymentSignature,
  type CachedPolicyAuth,
  type PaymentRequired,
} from './session-key-auto-sign';
import type { HexString } from './types';

const WALLET = '0x1111111111111111111111111111111111111111' as HexString;
const SESSION_KEY = ('0x' + '11'.repeat(32)) as HexString;
const SESSION_PUB = '0x2222222222222222222222222222222222222222' as HexString;
const SELLER = '0x3333333333333333333333333333333333333333' as HexString;

function paymentRequired(amountUnits: string): PaymentRequired {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:5042002',
        maxAmountRequired: amountUnits,
        resource: 'https://api.blink.test/signals',
        payTo: SELLER,
        asset: '0x3600000000000000000000000000000000000000',
        extra: { name: 'GatewayWalletBatched' },
      },
    ],
  };
}

function baseAuth(overrides: Partial<CachedPolicyAuth> = {}): CachedPolicyAuth {
  return {
    policyId: 'pol-1',
    authId: 'auth-1',
    userWallet: WALLET,
    sessionPubkey: SESSION_PUB,
    capUsdc: '50.000000',
    consumedUsdc: '0.000000',
    validUntil: new Date(Date.now() + 3600 * 1000),
    chainId: 5_042_002,
    revoked: false,
    ...overrides,
  };
}

const fakeSig = ('0x' + 'aa'.repeat(65)) as HexString;
const signTypedData = vi.fn().mockResolvedValue(fakeSig);

describe('SessionKeyAutoSigner.sign', () => {
  it('produces a well-formed EIP-3009 authorization', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth(),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
      now: () => new Date('2026-04-21T12:00:00Z'),
      randomNonce: () => ('0x' + 'dd'.repeat(32)) as HexString,
    });
    const result = await signer.sign({
      policyId: 'pol-1',
      paymentRequired: paymentRequired('300'),
      resource: 'https://api.blink.test/signals',
    });
    expect(result.authorization.from).toBe(WALLET);
    expect(result.authorization.to).toBe(SELLER);
    expect(result.authorization.value).toBe('300');
    expect(result.authorization.chainId).toBe(5_042_002);
    expect(result.authorization.signature).toBe(fakeSig);
    expect(result.context.policyId).toBe('pol-1');
    expect(result.context.authId).toBe('auth-1');
    expect(result.context.consumedAfter).toBe('0.000300');
  });

  it('rejects when no auth cached', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => null,
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    await expect(
      signer.sign({ policyId: 'pol-none', paymentRequired: paymentRequired('100'), resource: 'https://x' }),
    ).rejects.toBeInstanceOf(SigningRejected);
  });

  it('rejects revoked auth', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth({ revoked: true }),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    const err = await signer.sign({ policyId: 'pol-1', paymentRequired: paymentRequired('100'), resource: 'https://x' }).catch((e) => e);
    expect(err).toBeInstanceOf(SigningRejected);
    expect((err as SigningRejected).reason).toBe('revoked');
  });

  it('rejects expired auth', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth({ validUntil: new Date(Date.now() - 1000) }),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    const err = await signer.sign({ policyId: 'pol-1', paymentRequired: paymentRequired('100'), resource: 'https://x' }).catch((e) => e);
    expect((err as SigningRejected).reason).toBe('expired');
  });

  it('rejects when consumed + amount would exceed cap', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth({ capUsdc: '0.000500', consumedUsdc: '0.000400' }),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    const err = await signer
      .sign({ policyId: 'pol-1', paymentRequired: paymentRequired('200'), resource: 'https://x' })
      .catch((e) => e);
    expect((err as SigningRejected).reason).toBe('cap_exceeded');
  });

  it('rejects mismatched chain', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth({ chainId: 1 }),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    const err = await signer
      .sign({ policyId: 'pol-1', paymentRequired: paymentRequired('10'), resource: 'https://x' })
      .catch((e) => e);
    expect((err as SigningRejected).reason).toBe('chain_mismatch');
  });

  it('rejects if 402 lacks a GatewayWalletBatched option', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth(),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
    });
    const noGw: PaymentRequired = {
      x402Version: 2,
      accepts: [{ ...paymentRequired('10').accepts[0]!, extra: { name: 'Other' } }],
    };
    const err = await signer.sign({ policyId: 'pol-1', paymentRequired: noGw, resource: 'https://x' }).catch((e) => e);
    expect((err as SigningRejected).reason).toBe('gateway_option_missing');
  });
});

describe('PAYMENT-REQUIRED codec', () => {
  it('round-trips base64 payloads', () => {
    const pr = paymentRequired('123');
    const encoded = Buffer.from(JSON.stringify(pr)).toString('base64');
    const decoded = decodePaymentRequired(encoded);
    expect(decoded.accepts[0]!.maxAmountRequired).toBe('123');
  });

  it('encodes retry payloads as base64', async () => {
    const signer = new SessionKeyAutoSigner({
      getAuth: async () => baseAuth(),
      getSessionKey: async () => SESSION_KEY,
      signTypedData,
      now: () => new Date('2026-04-21T12:00:00Z'),
      randomNonce: () => ('0x' + 'ee'.repeat(32)) as HexString,
    });
    const result = await signer.sign({
      policyId: 'pol-1',
      paymentRequired: paymentRequired('50'),
      resource: 'https://api.blink.test/signals',
    });
    const encoded = encodePaymentSignature(result);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.authorization.value).toBe('50');
  });
});
