// Fraud-flag evaluation.
// Returns the list of triggered FraudFlag values without making any policy
// decision on top — that responsibility lives with the admin reviewer.
//
// Rules implemented (Agent H spec):
// - age_vs_amount:           policy age < 7d AND amount > 50% cap
// - constant_max_multiplier: >80% of audit_score rows at max multiplier
// - device_mismatch:         claim devicePubkey differs from registered pubkey
// - impossible_incident_date: incidentDate > now OR < policy.createdAt
// - rapid_amount_escalation: >3 top-ups in 48h window before claim

import type {
  AuditScoreRow,
  Claim,
  FraudFlag,
  Policy,
} from './types.js';
import {
  CONSTANT_MAX_MULTIPLIER_THRESHOLD,
  RAPID_TOPUP_THRESHOLD,
  RAPID_TOPUP_WINDOW_MS,
  YOUNG_POLICY_AMOUNT_CAP_RATIO,
  YOUNG_POLICY_MS,
} from './types.js';

export function isAgeVsAmountFlag(
  policy: Policy,
  claim: Claim,
  clock: () => number = Date.now,
): boolean {
  const age = clock() - policy.boundAt;
  if (age >= YOUNG_POLICY_MS) return false;
  if (!policy.payoutCapUsdc) return false;
  return claim.amountClaimedUsdc > policy.payoutCapUsdc * YOUNG_POLICY_AMOUNT_CAP_RATIO;
}

export function isConstantMaxMultiplierFlag(
  auditHistory: readonly AuditScoreRow[],
): boolean {
  if (!auditHistory.length) return false;
  const atMax = auditHistory.filter((r) => r.multiplier >= r.maxMultiplier).length;
  return atMax / auditHistory.length > CONSTANT_MAX_MULTIPLIER_THRESHOLD;
}

export function isDeviceMismatchFlag(policy: Policy, claim: Claim): boolean {
  const submitted = claim.devicePubkeySubmitted;
  const registered = policy.devicePubkey;
  if (!registered || !submitted) return false;
  return registered !== submitted;
}

export function isImpossibleIncidentDateFlag(
  policy: Policy,
  claim: Claim,
  clock: () => number = Date.now,
): boolean {
  const now = clock();
  if (!Number.isFinite(claim.incidentDate)) return true;
  if (claim.incidentDate > now) return true;
  if (claim.incidentDate < policy.createdAt) return true;
  return false;
}

export function isRapidAmountEscalationFlag(
  policy: Policy,
  claim: Claim,
  clock: () => number = Date.now,
): boolean {
  const topUps = policy.topUps ?? [];
  if (topUps.length === 0) return false;
  const submissionTs = claim.submittedAt || clock();
  const windowStart = submissionTs - RAPID_TOPUP_WINDOW_MS;
  const recent = topUps.filter(
    (t) => t.addedAt >= windowStart && t.addedAt <= submissionTs,
  );
  return recent.length > RAPID_TOPUP_THRESHOLD;
}

/**
 * Evaluate all fraud-flag rules and return the triggered set.
 * auditHistory is the list of audit_score rows for the policy.
 */
export function computeFraudFlags(
  claim: Claim,
  policy: Policy,
  auditHistory: readonly AuditScoreRow[],
  clock: () => number = Date.now,
): FraudFlag[] {
  const flags: FraudFlag[] = [];
  if (isAgeVsAmountFlag(policy, claim, clock)) flags.push('age_vs_amount');
  if (isConstantMaxMultiplierFlag(auditHistory)) flags.push('constant_max_multiplier');
  if (isDeviceMismatchFlag(policy, claim)) flags.push('device_mismatch');
  if (isImpossibleIncidentDateFlag(policy, claim, clock)) {
    flags.push('impossible_incident_date');
  }
  if (isRapidAmountEscalationFlag(policy, claim, clock)) {
    flags.push('rapid_amount_escalation');
  }
  return flags;
}
