/**
 * Shared types for the x402 client-side auto-signer settlement layer.
 *
 * These definitions are intentionally narrow. The EIP-3009 authorization shape
 * mirrors the Circle Gateway `GatewayWalletBatched` domain fields documented at
 * https://developers.circle.com/gateway/nanopayments/howtos/eip-3009-signing .
 *
 * Anything electron-facing is re-exported by `electron/src/auto-signer/types.ts`
 * so the two sides stay in lockstep without cross-package imports.
 */

/** 0x-prefixed lowercase hex string of a given fixed byte length (not enforced at TS level). */
export type HexString = `0x${string}`;

/** Wall-clock instant in milliseconds since epoch, as returned by Date.now(). */
export type Millis = number;

/**
 * EIP-3009 TransferWithAuthorization payload as produced by the Electron
 * session-key auto-signer. Submitted to Circle Gateway via the x402 retry
 * request carrying the `PAYMENT-SIGNATURE` header.
 *
 * Amounts are expressed as USDC base units (6-decimals stringified integer) to
 * avoid JS number precision drift around sub-cent values.
 */
export interface EIP3009Authorization {
  /** Owner of the funds; matches the buyer's Gateway-wallet address. */
  from: HexString;
  /** Recipient; the seller (backend) address configured in `createGatewayMiddleware`. */
  to: HexString;
  /** USDC base units (6 decimals). MUST be supplied as a decimal string. */
  value: string;
  /** Unix seconds (stringified). Authorization is not valid before this. */
  validAfter: string;
  /** Unix seconds (stringified). Authorization is not valid at or after this. */
  validBefore: string;
  /** 32-byte hex nonce, unique per authorization. */
  nonce: HexString;
  /** 65-byte ECDSA signature over the EIP-712 typed-data digest. */
  signature: HexString;
  /** EIP-155 chain ID the signature targets. Must equal the Gateway's chain. */
  chainId: number;
}

/**
 * The application-layer pre-authorization a user signs at purchase. Stored in
 * `x402_authorizations` and consumed by every settlement the session key signs.
 */
export interface StoredAuthorization {
  authId: string;
  policyId: string;
  userWallet: HexString;
  sessionPubkey: HexString;
  capUsdc: string;       // decimal string, 6 dp
  consumedUsdc: string;  // decimal string, 6 dp
  validFrom: Date;
  validUntil: Date;
  signature: HexString;
  nonce: HexString;
  chainId: number;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Input to authorization.store(). */
export interface AuthorizationInput {
  policyId: string;
  userWallet: HexString;
  sessionPubkey: HexString;
  capUsdc: string;
  validFrom?: Date;
  validUntil: Date;
  signature: HexString;
  nonce: HexString;
  chainId?: number;
}

/** A half-open window [start, end) the accrual engine measured. */
export interface SettlementWindow {
  policyId: string;
  windowStart: Date;
  windowEnd: Date;
  multiplier: number;
  elapsedSeconds: number;
  baseRateUsdcPerSec: number;
}

/** Output of computeDelta(). */
export interface DeltaResult {
  policyId: string;
  windowStart: Date;
  windowEnd: Date;
  elapsedSeconds: number;
  multiplier: number;
  baseRateUsdcPerSec: number;
  deltaUsdc: string;       // decimal string, 6 dp
  cumulativeUsdc: string;  // decimal string, 6 dp
  paused: boolean;
  reason?: string;
}

export type ReceiptStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'skipped';

export interface SettlementReceipt {
  receiptId: string;
  policyId: string;
  authId: string | null;
  windowStart: Date;
  windowEnd: Date;
  amountUsdc: string;
  multiplier: number;
  elapsedSeconds: number;
  baseRateUsdcPerSec: number;
  status: ReceiptStatus;
  x402Payload: Record<string, unknown> | null;
  paymentResponse: Record<string, unknown> | null;
  circleTxHash: string | null;
  circleBatchId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Minimal common interface for a Circle webhook event. Circle's DCW webhook
 * format is documented and we ignore unknown fields. `settlement.completed`
 * carries `batchId` + per-authorization statuses; `transaction.status.*` comes
 * from DCW tx confirmations (the race-fix replacement for setTimeout(3000)).
 */
export interface CircleWebhookEvent {
  /** Globally unique event id; used as the idempotency key. */
  id: string;
  type:
    | 'settlement.completed'
    | 'settlement.failed'
    | 'transaction.confirmed'
    | 'transaction.failed'
    | string;
  createdDate?: string;
  data: CircleWebhookData;
}

export interface CircleWebhookData {
  batchId?: string;
  transactionHash?: string;
  state?: string;
  authorizations?: Array<{
    nonce: HexString;
    policyId?: string;
    status: 'confirmed' | 'failed';
    errorMessage?: string;
  }>;
  /** Raw passthrough for unhandled Circle fields. */
  [k: string]: unknown;
}

/**
 * Structured response produced by the Electron auto-signer, POSTed back to the
 * backend's `/signals` endpoint as the x402 retry. Mirrors what
 * `BatchEvmScheme.createPaymentPayload()` emits plus the session-key metadata
 * the backend needs for cap enforcement.
 */
export interface AutoSignerResponse {
  x402Version: number;
  authorization: EIP3009Authorization;
  /** Canonical resource URL the 402 was issued against. */
  resource: string;
  /** The payment option chosen from the 402 `accepts[]`. */
  accepted: Record<string, unknown>;
  /** Locally tracked policy+auth identity so the backend can bind to its ledger. */
  context: {
    policyId: string;
    authId: string;
    consumedAfter: string;
  };
}

/** Cap-monitor IPC events. */
export type CapMonitorEvent =
  | { kind: 'cap-warning'; policyId: string; consumedUsdc: string; capUsdc: string; ratio: number }
  | { kind: 'cap-exhausted'; policyId: string; consumedUsdc: string; capUsdc: string }
  | { kind: 'expiry-warning'; policyId: string; validUntil: Date; millisRemaining: number };

/** Structured config returned from POST /settlement/status/:policyId. */
export interface PolicyAuthStatus {
  policyId: string;
  authId: string;
  capUsdc: string;
  consumedUsdc: string;
  ratio: number;
  validUntil: string;
  revoked: boolean;
  receiptsPending: number;
  receiptsConfirmed: number;
}
