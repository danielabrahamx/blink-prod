// Frontend mirror of the backend claims types. Kept in sync manually; in a
// later iteration we'll generate these from backend/src/claims/types.ts.

export type ClaimStatus =
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'denied'
  | 'paid';

export type ClaimType = 'damage' | 'theft' | 'loss' | 'malfunction';

export type FraudFlag =
  | 'age_vs_amount'
  | 'constant_max_multiplier'
  | 'device_mismatch'
  | 'impossible_incident_date'
  | 'rapid_amount_escalation';

export interface EvidenceRef {
  filename: string;
  mimetype: string;
  sizeBytes: number;
  storageUri: string;
  uploadedAt: number;
}

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
  denialReason?: string;
  denialDetail?: string;
  payoutTxHash?: string;
}

export interface SettlementReceipt {
  claimId: string;
  recipientAddress: string;
  amountUsdc: number;
  txHash: string;
  network: string;
  blockNumber?: number;
  paidAt: number;
}

export interface Policy {
  id: string;
  payoutCapUsdc: number;
  createdAt: number;
  claimWaitingUntil: number;
  active: boolean;
  deviceFingerprintHash: string | null;
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
};

export const FRAUD_LABEL: Record<FraudFlag, string> = {
  age_vs_amount: 'Young policy, high amount',
  constant_max_multiplier: 'Signals at max multiplier',
  device_mismatch: 'Device mismatch',
  impossible_incident_date: 'Incident date impossible',
  rapid_amount_escalation: 'Rapid top-ups pre-claim',
};
