// Admin review workflow: submitForReview, decide(approve|deny), inspector.
//
// - submitForReview(claimId, reviewer): transitions `submitted` ->
//   `under_review`, runs the sanctions screen against the payout wallet,
//   computes fraud flags, persists the reviewer identity. Admin-gated.
// - decide(claimId, decision, reason?): approve triggers payout (optional
//   reserveClient), deny writes a denial_reason. Admin-gated.

import type { ClaimsRepository } from './repository.js';
import { computeFraudFlags } from './fraud-flags.js';
import type {
  AdminContext,
  Claim,
  ClaimReview,
  DenialReason,
  FraudFlag,
  Policy,
  SanctionsResult,
} from './types.js';
import type { SanctionsScreener } from './sanctions.js';
import type { ReserveClient } from './payout.js';
import type { PayoutResult } from './types.js';
import { executePayout } from './payout.js';

export interface ReviewOptions {
  repository: ClaimsRepository;
  sanctionsScreener: SanctionsScreener;
  clock?: () => number;
}

export interface DecideOptions extends ReviewOptions {
  reserveClient: ReserveClient;
}

/**
 * Admin gate: verifies the caller's wallet is on the allowlist.
 * ADMIN_WALLETS is a comma-separated env var.
 */
export function isAdminWallet(wallet: string, env: NodeJS.ProcessEnv = process.env):
  boolean {
  const allowed = (env.ADMIN_WALLETS ?? env.VITE_ADMIN_WALLETS ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(wallet.toLowerCase());
}

export interface SubmitForReviewResult {
  ok: boolean;
  claim?: Claim;
  error?: string;
  sanctions?: SanctionsResult;
}

/**
 * Move a submitted claim into under_review. Runs sanctions, writes flags,
 * persists the reviewer.
 */
export async function submitForReview(
  claimId: string,
  reviewer: AdminContext,
  { repository, sanctionsScreener, clock = Date.now }: ReviewOptions,
): Promise<SubmitForReviewResult> {
  const claim = repository.getClaim(claimId);
  if (!claim) return { ok: false, error: 'claim_not_found' };
  if (claim.status === 'paid' || claim.status === 'denied') {
    return { ok: false, error: `terminal_state:${claim.status}`, claim };
  }

  const policy = repository.getPolicy(claim.policyId);
  const auditHistory = repository.getAuditHistory(claim.policyId);
  const flags: FraudFlag[] = policy
    ? computeFraudFlags(claim, policy, auditHistory, clock)
    : [];

  const sanctions = await sanctionsScreener(claim.policyholderWallet);
  const now = clock();

  if (!sanctions.clear) {
    const denied = repository.updateClaim(claimId, {
      status: 'denied',
      denialReason: 'sanctions_hit',
      denialDetail: sanctions.reason ?? 'sanctions_screen_failed',
      sanctionsScreenedAt: now,
      sanctionsResult: sanctions,
      fraudFlags: flags,
      reviewStartedAt: now,
      reviewedBy: reviewer.adminId,
      deniedAt: now,
    });
    return { ok: true, claim: denied ?? undefined, sanctions };
  }

  const updated = repository.updateClaim(claimId, {
    status: 'under_review',
    fraudFlags: flags,
    sanctionsScreenedAt: now,
    sanctionsResult: sanctions,
    reviewStartedAt: now,
    reviewedBy: reviewer.adminId,
  });
  return { ok: true, claim: updated ?? undefined, sanctions };
}

export interface DecideResult {
  ok: boolean;
  claim?: Claim;
  error?: string;
  payout?: PayoutResult;
}

/**
 * decide(claimId, 'approve') triggers payout.
 * decide(claimId, 'deny', reason) writes the denial reason.
 */
export async function decide(
  claimId: string,
  decision: 'approve' | 'deny',
  reviewer: AdminContext,
  options: DecideOptions,
  reason?: string | undefined,
): Promise<DecideResult> {
  const { repository, clock = Date.now } = options;
  const claim = repository.getClaim(claimId);
  if (!claim) return { ok: false, error: 'claim_not_found' };
  if (claim.status === 'paid') return { ok: false, error: 'already_paid', claim };
  if (claim.status === 'denied') return { ok: false, error: 'already_denied', claim };
  const now = clock();

  if (decision === 'deny') {
    if (!reason || !reason.trim()) {
      return { ok: false, error: 'reason_required' };
    }
    const denied = repository.updateClaim(claimId, {
      status: 'denied',
      denialReason: 'admin_denied',
      denialDetail: reason.slice(0, 1000),
      deniedAt: now,
      reviewedBy: reviewer.adminId,
    });
    return { ok: true, claim: denied ?? undefined };
  }

  // approve
  const approved = repository.updateClaim(claimId, {
    status: 'approved',
    approvedAt: now,
    reviewedBy: reviewer.adminId,
  });
  if (!approved) return { ok: false, error: 'update_failed' };
  const payout = await executePayout(claimId, {
    repository,
    reserveClient: options.reserveClient,
    clock,
  });
  return { ok: payout.ok, claim: repository.getClaim(claimId) ?? approved, payout };
}

/**
 * Admin inspector payload: claim + policy + signals + fingerprint match.
 */
export function buildInspector(
  claimId: string,
  repository: ClaimsRepository,
): ClaimReview | { error: string } {
  const claim = repository.getClaim(claimId);
  if (!claim) return { error: 'claim_not_found' };
  const policy = repository.getPolicy(claim.policyId);
  const signalHistory = repository.getAuditHistory(claim.policyId);
  return {
    claim,
    policy,
    signalHistory,
    fraudFlags: claim.fraudFlags,
  };
}

// Re-export for callers that want a one-stop-shop import.
export { computeFraudFlags };

// Utility: map an internal DenialReason to a human label. Consumed by tests
// and by frontend copy.
export const DENIAL_LABELS: Record<DenialReason, string> = {
  policy_inactive: 'Policy is not active',
  waiting_period: '24h waiting period has not elapsed',
  duplicate_active_claim: 'Another claim is already open for this policy',
  amount_exceeds_cap: 'Amount exceeds policy cap',
  fingerprint_mismatch: 'Device fingerprint does not match bind time',
  police_report_missing: 'Police report required for theft claims over $500',
  impossible_incident_date: 'Incident date is outside policy validity',
  sanctions_hit: 'Payout address failed sanctions screening',
  admin_denied: 'Admin denied',
  payout_failed: 'Payout failed after retries',
};

// Used by policy objects. Kept here so the review module is the one stop for
// admin-facing copy.
export function isTerminal(status: Policy['active'] | string): boolean {
  return status === 'paid' || status === 'denied';
}
