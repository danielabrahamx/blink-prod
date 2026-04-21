/**
 * Electron-side types for the x402 auto-signer. Intentionally duplicated from
 * backend/src/settlement/types.ts so we don't need a monorepo-wide package
 * boundary yet; the two pairs are kept in sync by the integration test.
 */
export type HexString = `0x${string}`;

export interface EIP3009Authorization {
  from: HexString;
  to: HexString;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: HexString;
  signature: HexString;
  chainId: number;
}

export interface AutoSignerResponse {
  x402Version: number;
  authorization: EIP3009Authorization;
  resource: string;
  accepted: Record<string, unknown>;
  context: {
    policyId: string;
    authId: string;
    consumedAfter: string;
  };
}

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

export type CapMonitorEvent =
  | { kind: 'cap-warning'; policyId: string; consumedUsdc: string; capUsdc: string; ratio: number }
  | { kind: 'cap-exhausted'; policyId: string; consumedUsdc: string; capUsdc: string }
  | { kind: 'expiry-warning'; policyId: string; validUntil: Date; millisRemaining: number };
