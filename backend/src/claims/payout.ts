// Payout execution: wires BlinkReserve contract's `payoutClaim` function via
// an injected ReserveClient. Writes a SettlementReceipt and updates the claim
// to `paid`. Idempotent on repeat calls and retryable on failure.
//
// - Idempotency: if claim.status === 'paid' AND we already stored a receipt,
//   return the existing tx_hash without calling the chain again.
// - Retry: transient failures (reverts, RPC errors) stay in `approved` state
//   and schedule a retry with exponential backoff (attempt 1 @ 60s, 2 @ 5m,
//   3 @ 30m). After 3 attempts the claim carries an `escalated` flag for
//   admin alerting.

import type { ClaimsRepository } from './repository.js';
import type {
  Claim,
  PayoutAttempt,
  PayoutResult,
  SettlementReceipt,
} from './types.js';

export interface ReserveClient {
  transferPayout(input: {
    claimId: string;
    recipientAddress: string;
    amountUsdc: number;
  }): Promise<ReserveTransferResult>;
}

export interface ReserveTransferResult {
  success: boolean;
  txHash?: string;
  network?: string;
  blockNumber?: number;
  error?: string;
}

export interface PayoutOptions {
  repository: ClaimsRepository;
  reserveClient: ReserveClient;
  clock?: () => number;
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
}

const DEFAULT_BACKOFF = (attempt: number): number => {
  // attempt 1 -> 60s, 2 -> 5m, 3 -> 30m. Exponential enough for a pilot.
  if (attempt <= 1) return 60_000;
  if (attempt === 2) return 5 * 60_000;
  return 30 * 60_000;
};

/**
 * Execute a payout for an approved claim. Idempotent + retryable.
 */
export async function executePayout(
  claimId: string,
  {
    repository,
    reserveClient,
    clock = Date.now,
    maxAttempts = 3,
    backoffMs = DEFAULT_BACKOFF,
  }: PayoutOptions,
): Promise<PayoutResult> {
  const claim = repository.getClaim(claimId);
  if (!claim) {
    return { ok: false, claimId, idempotent: false, error: 'claim_not_found' };
  }

  // Idempotent fast-path: already paid with a stored tx hash.
  if (claim.status === 'paid' && claim.payoutTxHash) {
    const receipt = repository.getReceipt(claimId);
    return {
      ok: true,
      claimId,
      txHash: claim.payoutTxHash,
      idempotent: true,
      receipt: receipt ?? undefined,
    };
  }

  if (claim.status !== 'approved' && claim.status !== 'paid') {
    return {
      ok: false,
      claimId,
      idempotent: false,
      error: `claim_not_approved:${claim.status}`,
    };
  }

  const now = clock();
  const attempts = claim.payoutAttempts ?? [];
  const attemptIndex = attempts.length + 1;

  let result: ReserveTransferResult;
  try {
    result = await reserveClient.transferPayout({
      claimId,
      recipientAddress: claim.policyholderWallet,
      amountUsdc: claim.amountClaimedUsdc,
    });
  } catch (err) {
    result = {
      success: false,
      error: (err as Error).message ?? 'reserve_client_threw',
    };
  }

  if (!result.success || !result.txHash) {
    const attemptRecord: PayoutAttempt = {
      attempt: attemptIndex,
      ts: now,
      error: result.error ?? 'payout_failed',
    };
    const nextAttempts = [...attempts, attemptRecord];
    const escalated = nextAttempts.length >= maxAttempts;
    const retryScheduledAt = escalated
      ? undefined
      : now + backoffMs(attemptIndex);
    repository.updateClaim(claimId, {
      payoutAttempts: nextAttempts,
      ...(escalated
        ? {
            denialReason: 'payout_failed',
            denialDetail: `retry_exhausted:${result.error ?? 'unknown'}`,
          }
        : {}),
    });
    return {
      ok: false,
      claimId,
      idempotent: false,
      error: result.error ?? 'payout_failed',
      retryScheduledAt,
    };
  }

  const paidAt = now;
  const receipt: SettlementReceipt = {
    claimId,
    recipientAddress: claim.policyholderWallet,
    amountUsdc: claim.amountClaimedUsdc,
    txHash: result.txHash,
    network: result.network ?? 'arc-testnet',
    blockNumber: result.blockNumber,
    paidAt,
  };
  repository.saveReceipt(receipt);

  const updatedAttempts: PayoutAttempt[] = [
    ...attempts,
    { attempt: attemptIndex, ts: now, txHash: result.txHash },
  ];
  const updated: Partial<Claim> = {
    status: 'paid',
    paidAt,
    payoutTxHash: result.txHash,
    payoutAttempts: updatedAttempts,
  };
  repository.updateClaim(claimId, updated);

  return {
    ok: true,
    claimId,
    txHash: result.txHash,
    receipt,
    idempotent: false,
  };
}

// BlinkReserve contract adapter (ethers.js). Used by server.js to build a
// real ReserveClient at startup.
export interface EthersPayoutDeps {
  signer: {
    sendTransaction?: unknown;
  };
  contract: {
    payoutClaim: (
      claimIdBytes32: string,
      recipient: string,
      amountWei: bigint,
    ) => Promise<{
      wait: () => Promise<{
        hash: string;
        blockNumber?: number;
      }>;
      hash: string;
    }>;
  };
  network?: string;
  decimals?: number;
}

export function makeEthersReserveClient(
  deps: EthersPayoutDeps,
): ReserveClient {
  const decimals = deps.decimals ?? 6;
  return {
    async transferPayout({ claimId, recipientAddress, amountUsdc }) {
      try {
        const bytes32 = toBytes32(claimId);
        const amountWei =
          BigInt(Math.round(amountUsdc * 10 ** decimals));
        const tx = await deps.contract.payoutClaim(bytes32, recipientAddress, amountWei);
        const receipt = await tx.wait();
        return {
          success: true,
          txHash: receipt.hash ?? tx.hash,
          blockNumber: receipt.blockNumber,
          network: deps.network ?? 'arc-testnet',
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  };
}

function toBytes32(claimId: string): string {
  // bytes32 expected — pad the ASCII representation of the id so it lines up
  // with the MockBlinkReserve signature.
  const buf = Buffer.alloc(32);
  buf.write(claimId.slice(0, 32), 'utf8');
  return `0x${buf.toString('hex')}`;
}
