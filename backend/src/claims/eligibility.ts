// Eligibility rules for a claim submission.
// Returns a structured EligibilityResult with all triggered reasons — callers
// can surface multiple denials at once so the user sees a complete list.
//
// Rules enforced (design-doc Module 4 + Agent H spec):
// 1. Policy must be `active`.
// 2. 24h waiting period elapsed (policy.claimWaitingUntil < now).
// 3. No other claim in submitted/under_review/approved for same policy.
// 4. amountClaimedUsdc <= policy.payoutCapUsdc.
// 5. Device fingerprint in claim payload matches bind-time fingerprint on
//    the devices table (policy.deviceFingerprintHash).
// 6. incidentDate is not in the future and not before policy.createdAt.

import type {
  ClaimsRepository,
} from './repository.js';
import type {
  ClaimSubmission,
  DenialReason,
  EligibilityResult,
  Policy,
} from './types.js';
import { POLICE_REPORT_THRESHOLD_USD } from './types.js';

export interface EligibilityOptions {
  repository: ClaimsRepository;
  clock?: () => number;
}

/**
 * Test a full ClaimSubmission for eligibility. All failing rules are
 * accumulated so the caller can present a complete reason list.
 */
export function isEligible(
  submission: ClaimSubmission,
  { repository, clock = Date.now }: EligibilityOptions,
): EligibilityResult {
  const reasons: string[] = [];
  let denialReason: DenialReason | undefined;
  const now = clock();

  const policy = repository.getPolicy(submission.policyId);
  if (!policy) {
    return {
      eligible: false,
      reasons: ['policy_not_found'],
      denialReason: 'policy_inactive',
    };
  }

  if (!policy.active) {
    reasons.push('policy_not_active');
    denialReason ??= 'policy_inactive';
  }

  if (policy.claimWaitingUntil > now) {
    reasons.push(
      `waiting_period_not_elapsed:${new Date(policy.claimWaitingUntil).toISOString()}`,
    );
    denialReason ??= 'waiting_period';
  }

  const active = repository.findActiveClaimForPolicy(policy.id);
  if (active) {
    reasons.push(`duplicate_active_claim:${active.id}`);
    denialReason ??= 'duplicate_active_claim';
  }

  if (submission.amountClaimedUsdc > policy.payoutCapUsdc) {
    reasons.push(
      `amount_exceeds_cap:${submission.amountClaimedUsdc}>${policy.payoutCapUsdc}`,
    );
    denialReason ??= 'amount_exceeds_cap';
  }

  if (policy.deviceFingerprintHash) {
    if (submission.deviceFingerprint !== policy.deviceFingerprintHash) {
      reasons.push('device_fingerprint_mismatch');
      denialReason ??= 'fingerprint_mismatch';
    }
  } else {
    reasons.push('policy_missing_device_fingerprint');
    denialReason ??= 'fingerprint_mismatch';
  }

  if (!Number.isFinite(submission.incidentDate)) {
    reasons.push('incident_date_invalid');
    denialReason ??= 'impossible_incident_date';
  } else {
    if (submission.incidentDate > now) {
      reasons.push('incident_date_in_future');
      denialReason ??= 'impossible_incident_date';
    }
    if (submission.incidentDate < policy.createdAt) {
      reasons.push('incident_date_before_policy_created');
      denialReason ??= 'impossible_incident_date';
    }
  }

  if (
    submission.claimType === 'theft' &&
    submission.amountClaimedUsdc > POLICE_REPORT_THRESHOLD_USD &&
    !submission.policeReportRef
  ) {
    reasons.push(`police_report_required:theft>${POLICE_REPORT_THRESHOLD_USD}`);
    denialReason ??= 'police_report_missing';
  }

  if (reasons.length === 0) {
    return { eligible: true, reasons: [] };
  }
  return { eligible: false, reasons, denialReason };
}

/**
 * Overload for the spec signature: isEligible(policyId, amount).
 * Loads the policy and runs a partial check (no device / incident fields).
 * Used by UI pre-flight.
 */
export function isEligibleSimple(
  policyId: string,
  amount: number,
  { repository, clock = Date.now }: EligibilityOptions,
): EligibilityResult {
  const reasons: string[] = [];
  const policy = repository.getPolicy(policyId);
  if (!policy) {
    return {
      eligible: false,
      reasons: ['policy_not_found'],
      denialReason: 'policy_inactive',
    };
  }
  if (!policy.active) reasons.push('policy_not_active');
  if (policy.claimWaitingUntil > clock()) reasons.push('waiting_period_not_elapsed');
  const active = repository.findActiveClaimForPolicy(policy.id);
  if (active) reasons.push('duplicate_active_claim');
  if (amount > policy.payoutCapUsdc) reasons.push('amount_exceeds_cap');
  return reasons.length === 0
    ? { eligible: true, reasons: [] }
    : { eligible: false, reasons };
}

// Utility exposed for tests / inspectors.
export function summarisePolicyEligibility(policy: Policy, clock = Date.now): {
  waitingPeriodRemainingMs: number;
  isActive: boolean;
  hasFingerprint: boolean;
} {
  return {
    waitingPeriodRemainingMs: Math.max(0, policy.claimWaitingUntil - clock()),
    isActive: policy.active,
    hasFingerprint: Boolean(policy.deviceFingerprintHash),
  };
}
