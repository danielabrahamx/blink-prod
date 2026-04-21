// x402 client-side auto-signer -- EXPORTED INTERFACE ONLY.
// Agent F fills in the body on the `feat/settlement-x402` branch. This
// file defines what the main process, IPC layer, and renderer can
// depend on today: register an EIP-3009 authorization, read current
// settlement status, and let Agent F plug in the 402-response handler.

import type { EIP3009Authorization, SettlementStatus } from '../shared/types.js';

export interface AutoSignerInit {
  /** Provides the Ed25519 session-signing primitive. */
  session: { sign(message: Uint8Array): Promise<Uint8Array> };
}

export interface Handle402Input {
  /** Raw 402 response body from the backend accrual loop. */
  challenge: unknown;
}

export interface Handle402Output {
  /** Signed payment bundle to POST back to the accrual endpoint. */
  response: unknown;
}

export interface AutoSigner {
  registerAuthorization(auth: EIP3009Authorization): Promise<void>;
  getStatus(): Promise<SettlementStatus>;
  /**
   * Agent F implements: validates cap + validity, signs with session key,
   * returns the settled response. Stub throws so misconfigured callers are
   * loud during Agent C's wave.
   */
  handle402(input: Handle402Input): Promise<Handle402Output>;
}

export async function createAutoSigner(_init: AutoSignerInit): Promise<AutoSigner> {
  let authorization: EIP3009Authorization | null = null;

  return {
    async registerAuthorization(auth: EIP3009Authorization): Promise<void> {
      authorization = auth;
    },
    async getStatus(): Promise<SettlementStatus> {
      return {
        state: authorization ? 'active' : 'awaiting_auth',
        authorization,
        consumed: '0',
        remaining: authorization?.cap ?? '0',
        lastSettlementAt: null,
        pendingCount: 0,
        confirmedCount: 0,
      };
    },
    async handle402(_input: Handle402Input): Promise<Handle402Output> {
      throw new Error('auto-signer: handle402 not yet implemented (Agent F scope)');
    },
  };
}

export type { EIP3009Authorization, SettlementStatus } from '../shared/types.js';
