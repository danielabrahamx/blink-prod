// Types, enums, and constants for Claims v1.
// This module defines the wire contracts and internal domain types used across
// the intake, review, payout, fraud-flag, and routing layers.
//
// Everything is exported so the tests, the router, and the eventual Postgres
// migration in Agent B's worktree share a single canonical shape.

export const CLAIM_STATUS = [
  'submitted',
  'under_review',
  'approved',
  'denied',
  'paid',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUS)[number];

export const DENIAL_REASON = [
  'policy_inactive',
  'waiting_period',
  'duplicate_active_claim',
  'amount_exceeds_cap',
  'fingerprint_mismatch',
  'police_report_missing',
  'impossible_incident_date',
  'sanctions_hit',
  'admin_denied',
  'payout_failed',
] as const;
export type DenialReason = (typeof DENIAL_REASON)[number];

export const CLAIM_TYPE = ['damage', 'theft', 'loss', 'malfunction'] as const;
export type ClaimType = (typeof CLAIM_TYPE)[number];

// Fraud flag identifiers. New flags added in v1 beyond the three flags in the
// design doc, per Agent H spec.
export const FRAUD_FLAG = [
  'age_vs_amount',
  'constant_max_multiplier',
  'device_mismatch',
  'impossible_incident_date',
  'rapid_amount_escalation',
] as const;
export type FraudFlag = (typeof FRAUD_FLAG)[number];

// Hard constants from the design doc.
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const REVIEW_SLA_MS = 24 * 60 * 60 * 1000;
export const PAYOUT_SLA_MS = 48 * 60 * 60 * 1000;
export const WAITING_PERIOD_MS = 24 * 60 * 60 * 1000;
export const POLICE_REPORT_THRESHOLD_USD = 500;
export const YOUNG_POLICY_DAYS = 7;
export const YOUNG_POLICY_MS = YOUNG_POLICY_DAYS * MS_PER_DAY;
export const YOUNG_POLICY_AMOUNT_CAP_RATIO = 0.5;
export const CONSTANT_MAX_MULTIPLIER_THRESHOLD = 0.8;
export const RAPID_TOPUP_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RAPID_TOPUP_THRESHOLD = 3;

// Policy shape required by the claims module. Matches Agent B's target schema.
export interface Policy {
  id: string;
  policyholderWallet: string;
  active: boolean;
  createdAt: number;
  boundAt: number;
  claimWaitingUntil: number;
  payoutCapUsdc: number;
  deviceFingerprintHash: string | null;
  devicePubkey: string | null;
  topUps?: PolicyTopUp[];
}

export interface PolicyTopUp {
  amountUsdc: number;
  addedAt: number;
}

// Audit score row shape used by fraud flags (constant-max-multiplier rule).
export interface AuditScoreRow {
  policyId: string;
  multiplier: number;
  maxMultiplier: number;
  ts: number;
}

// Evidence reference attached to a submitted claim.
export interface EvidenceRef {
  filename: string;
  mimetype: string;
  sizeBytes: number;
  storageUri: string;
  uploadedAt: number;
}

// Incoming HTTP payload (pre-validation).
export interface ClaimSubmission {
  policyId: string;
  policyholderWallet: string;
  claimType: ClaimType;
  incidentDescription: string;
  incidentDate: number;
  amountClaimedUsdc: number;
  deviceFingerprint: string;
  devicePubkey?: string | null;
  policeReportRef?: string | null;
  evidence: EvidenceRef[];
}

// Persisted claim row.
export interface Claim {
  id: string;
  policyId: string;
  policyholderWallet: string;
  claimType: ClaimType;
  amountClaimedUsdc: number;
  incidentDescription: string;
  incidentDate: number;
  evidence: EvidenceRef[];
  policeReportRef: string | null;
  deviceFingerprintSubmitted: string;
  devicePubkeySubmitted: string | null;
  status: ClaimStatus;
  fraudFlags: FraudFlag[];
  submittedAt: number;
  reviewByAt: number;
  payoutByAt: number;
  reviewStartedAt?: number;
  reviewedBy?: string;
  approvedAt?: number;
  deniedAt?: number;
  paidAt?: number;
  denialReason?: DenialReason;
  denialDetail?: string;
  sanctionsScreenedAt?: number;
  sanctionsResult?: SanctionsResult;
  payoutTxHash?: string;
  payoutAttempts?: PayoutAttempt[];
}

// Settlement receipt persisted alongside a paid claim.
export interface SettlementReceipt {
  claimId: string;
  recipientAddress: string;
  amountUsdc: number;
  txHash: string;
  network: string;
  blockNumber?: number;
  paidAt: number;
}

// Payout retry bookkeeping.
export interface PayoutAttempt {
  attempt: number;
  ts: number;
  error?: string;
  txHash?: string;
}

// Sanctions screen result shape. Consumed by review workflow.
export interface SanctionsResult {
  clear: boolean;
  list?: string;
  reason?: string;
  hits?: Array<{ list: string; entry: string }>;
  checkedAt: number;
}

// Admin review decision input.
export type ReviewDecision = 'approve' | 'deny';

// Eligibility return — matches spec verbatim.
export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  denialReason?: DenialReason;
}

// Payout result returned to callers.
export interface PayoutResult {
  ok: boolean;
  claimId: string;
  txHash?: string;
  receipt?: SettlementReceipt;
  idempotent: boolean;
  error?: string;
  retryScheduledAt?: number;
}

// Claim review input / output helpers.
export interface ClaimReview {
  claim: Claim;
  policy: Policy | null;
  signalHistory: AuditScoreRow[];
  fraudFlags: FraudFlag[];
}

// Admin context carried on authorised requests.
export interface AdminContext {
  adminId: string;
  wallet: string;
}

// Claim list filter.
export interface ClaimFilter {
  status?: ClaimStatus | ClaimStatus[];
  policyholderWallet?: string;
}

// Utility: compute SLA timestamps from a submission time.
export function computeSlaTimestamps(submittedAt: number): {
  reviewByAt: number;
  payoutByAt: number;
} {
  const reviewByAt = submittedAt + REVIEW_SLA_MS;
  return {
    reviewByAt,
    payoutByAt: reviewByAt + PAYOUT_SLA_MS,
  };
}
