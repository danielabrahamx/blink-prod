/**
 * Electron session-key auto-signer.
 *
 * Responsibilities:
 *   - Intercept 402 responses from the backend's x402 endpoints.
 *   - Decode the PAYMENT-REQUIRED header per x402 spec.
 *   - Verify locally cached policy authorization:
 *       * active (auth present, not revoked),
 *       * within cap (consumed + amount <= cap),
 *       * within validity (now() < validUntil).
 *   - Sign the EIP-3009 payload with the session key (EVM ECDSA).
 *   - POST the retry with the PAYMENT-SIGNATURE header.
 *
 * The signer is a pure function over its dependencies so it can be unit-tested
 * without spinning up Electron IPC or a real fetch. The prod wire-up lives in
 * the Electron main process (Agent C's scope) which injects `getSessionKey()`
 * reading from the OS keychain.
 *
 * We intentionally do NOT verify the Circle signature locally (Gateway owns
 * that). The local checks are all cap / validity / revocation.
 */
import type { EIP3009Authorization, AutoSignerResponse, HexString } from './types';

/** Shape of a PAYMENT-REQUIRED accept entry the Gateway emits. */
export interface GatewayAcceptEntry {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  payTo: HexString;
  asset?: HexString;
  extra?: Record<string, unknown> & { name?: string };
  /** Unix-seconds window the authorization is valid for. */
  validAfter?: string | number;
  validBefore?: string | number;
}

export interface PaymentRequired {
  x402Version: number;
  accepts: GatewayAcceptEntry[];
}

export interface CachedPolicyAuth {
  policyId: string;
  authId: string;
  userWallet: HexString;
  sessionPubkey: HexString;
  capUsdc: string;
  consumedUsdc: string;
  validUntil: Date;
  chainId: number;
  revoked: boolean;
}

export interface SignerDeps {
  /** Returns a 32-byte hex private key for the session signer. */
  getSessionKey(policyId: string): Promise<HexString>;
  /** Returns the locally cached auth state (from IPC to main process). */
  getAuth(policyId: string): Promise<CachedPolicyAuth | null>;
  /**
   * Signs an EIP-3009 typed-data payload with the given private key.
   * Defaults to a viem-backed impl. Injected for testability.
   */
  signTypedData(params: SignTypedDataParams): Promise<HexString>;
  /** Wall clock. */
  now?: () => Date;
  /** Crypto-random 32-byte nonce in hex. */
  randomNonce?: () => HexString;
}

export interface SignTypedDataParams {
  privateKey: HexString;
  domain: { name: string; version: string; chainId: number; verifyingContract: HexString };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export class SigningRejected extends Error {
  constructor(
    public readonly reason:
      | 'no_auth'
      | 'revoked'
      | 'expired'
      | 'cap_exceeded'
      | 'chain_mismatch'
      | 'amount_invalid'
      | 'gateway_option_missing',
    public readonly context: Record<string, unknown>,
  ) {
    super(`auto-signer rejected: ${reason}`);
  }
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

function defaultRandomNonce(): HexString {
  const arr = new Uint8Array(32);
  // Crypto is available in both node and Electron renderer.
  (globalThis.crypto ?? require('crypto').webcrypto).getRandomValues(arr);
  return ('0x' +
    Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as HexString;
}

export class SessionKeyAutoSigner {
  private readonly deps: Required<SignerDeps>;

  constructor(deps: SignerDeps) {
    this.deps = {
      now: deps.now ?? (() => new Date()),
      randomNonce: deps.randomNonce ?? defaultRandomNonce,
      getSessionKey: deps.getSessionKey,
      getAuth: deps.getAuth,
      signTypedData: deps.signTypedData,
    };
  }

  /**
   * Given a 402 response body, produce the signed retry payload. Throws
   * SigningRejected for any application-layer guard failure; the caller
   * (fetch interceptor) then decides whether to surface the error or silently
   * pause (e.g., cap_exceeded triggers a UI nudge to re-authorize).
   */
  async sign(params: {
    policyId: string;
    paymentRequired: PaymentRequired;
    resource: string;
  }): Promise<AutoSignerResponse> {
    const auth = await this.deps.getAuth(params.policyId);
    if (!auth) {
      throw new SigningRejected('no_auth', { policyId: params.policyId });
    }
    if (auth.revoked) {
      throw new SigningRejected('revoked', { authId: auth.authId });
    }
    const now = this.deps.now();
    if (auth.validUntil.valueOf() <= now.valueOf()) {
      throw new SigningRejected('expired', { authId: auth.authId, validUntil: auth.validUntil });
    }

    const option = params.paymentRequired.accepts.find(
      (a) => a.extra?.['name'] === 'GatewayWalletBatched',
    );
    if (!option) {
      throw new SigningRejected('gateway_option_missing', { accepts: params.paymentRequired.accepts });
    }
    if (Number(option.network.split(':')[1] ?? 0) !== auth.chainId) {
      throw new SigningRejected('chain_mismatch', {
        optionNetwork: option.network,
        authChain: auth.chainId,
      });
    }

    const amountUnits = BigInt(option.maxAmountRequired);
    if (amountUnits <= 0n) {
      throw new SigningRejected('amount_invalid', { amount: option.maxAmountRequired });
    }
    const remaining = toUnits(auth.capUsdc) - toUnits(auth.consumedUsdc);
    if (amountUnits > remaining) {
      throw new SigningRejected('cap_exceeded', {
        authId: auth.authId,
        capUsdc: auth.capUsdc,
        consumedUsdc: auth.consumedUsdc,
        requestedUnits: String(amountUnits),
      });
    }

    const privateKey = await this.deps.getSessionKey(params.policyId);
    const nonce = this.deps.randomNonce();
    const nowSeconds = Math.floor(now.valueOf() / 1000);
    const validAfter = String(Number(option.validAfter ?? nowSeconds - 60));
    const validBefore = String(Number(option.validBefore ?? nowSeconds + 600));
    const verifyingContract = (option.asset ?? '0x0000000000000000000000000000000000000000') as HexString;

    const message = {
      from: auth.userWallet,
      to: option.payTo,
      value: amountUnits.toString(),
      validAfter,
      validBefore,
      nonce,
    } as const;

    const signature = await this.deps.signTypedData({
      privateKey,
      domain: {
        name: 'GatewayWalletBatched',
        version: '1',
        chainId: auth.chainId,
        verifyingContract,
      },
      types: EIP3009_TYPES as unknown as Record<string, Array<{ name: string; type: string }>>,
      primaryType: 'TransferWithAuthorization',
      message,
    });

    const authorization: EIP3009Authorization = {
      ...message,
      signature,
      chainId: auth.chainId,
    };

    return {
      x402Version: params.paymentRequired.x402Version,
      authorization,
      resource: params.resource,
      accepted: option as unknown as Record<string, unknown>,
      context: {
        policyId: auth.policyId,
        authId: auth.authId,
        consumedAfter: fromUnitsStr(toUnits(auth.consumedUsdc) + amountUnits),
      },
    };
  }
}

/**
 * Utility: decode Circle's base64 PAYMENT-REQUIRED header into a PaymentRequired.
 * Exposed so the fetch interceptor can share the same parsing logic tests use.
 */
export function decodePaymentRequired(header: string): PaymentRequired {
  const decoded = Buffer.from(header, 'base64').toString('utf8');
  const parsed = JSON.parse(decoded) as PaymentRequired;
  if (!Array.isArray(parsed.accepts)) {
    throw new Error('PAYMENT-REQUIRED missing accepts[]');
  }
  return parsed;
}

/**
 * Utility: encode the retry payload to base64 for the PAYMENT-SIGNATURE header.
 */
export function encodePaymentSignature(resp: AutoSignerResponse): string {
  return Buffer.from(JSON.stringify({
    x402Version: resp.x402Version,
    payload: {
      authorization: resp.authorization,
      signature: resp.authorization.signature,
    },
    resource: resp.resource,
    accepted: resp.accepted,
  })).toString('base64');
}

function toUnits(value: string): bigint {
  const [whole, frac = ''] = value.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole ?? '0') * 1_000_000n + BigInt(fracPadded);
}

function fromUnitsStr(units: bigint): string {
  const abs = units < 0n ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0');
  return `${units < 0n ? '-' : ''}${whole.toString()}.${frac}`;
}
