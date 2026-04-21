// Claim intake: validate, check eligibility, persist, stamp SLA timestamps.
//
// Claims that fail eligibility are persisted as `denied` rows so the full
// history is visible to the policyholder and to the admin (users see the
// denial reason; admin can reverse if needed via a manual override flow —
// out of scope for v1).

import { z } from 'zod';
import type { ClaimsRepository } from './repository.js';
import { isEligible } from './eligibility.js';
import type {
  Claim,
  ClaimSubmission,
  DenialReason,
  EvidenceRef,
} from './types.js';
import { CLAIM_TYPE, computeSlaTimestamps } from './types.js';

const evidenceSchema = z.object({
  filename: z.string().min(1).max(512),
  mimetype: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  storageUri: z.string().min(1),
  uploadedAt: z.number().int(),
});

export const claimSubmissionSchema = z.object({
  policyId: z.string().min(1),
  policyholderWallet: z.string().min(1),
  claimType: z.enum(CLAIM_TYPE),
  incidentDescription: z.string().min(1).max(2000),
  incidentDate: z.coerce.number().int(),
  amountClaimedUsdc: z.number().positive().finite(),
  deviceFingerprint: z.string().min(1),
  devicePubkey: z.string().min(1).nullable().optional(),
  policeReportRef: z.string().min(1).nullable().optional(),
  evidence: z.array(evidenceSchema).max(5).default([]),
});

export type ParsedSubmission = z.infer<typeof claimSubmissionSchema>;

export interface SubmitOptions {
  repository: ClaimsRepository;
  clock?: () => number;
}

export interface SubmitResult {
  status: number;
  claim?: Claim;
  error?: string;
  details?: string[];
}

export function normaliseSubmission(input: unknown): {
  ok: true;
  submission: ClaimSubmission;
} | { ok: false; errors: string[] } {
  const parsed = claimSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    };
  }
  const data = parsed.data;
  const submission: ClaimSubmission = {
    policyId: data.policyId,
    policyholderWallet: data.policyholderWallet,
    claimType: data.claimType,
    incidentDescription: data.incidentDescription,
    incidentDate: data.incidentDate,
    amountClaimedUsdc: data.amountClaimedUsdc,
    deviceFingerprint: data.deviceFingerprint,
    devicePubkey: data.devicePubkey ?? null,
    policeReportRef: data.policeReportRef ?? null,
    evidence: (data.evidence ?? []) as EvidenceRef[],
  };
  return { ok: true, submission };
}

export function submitClaim(
  body: unknown,
  { repository, clock = Date.now }: SubmitOptions,
): SubmitResult {
  const parsed = normaliseSubmission(body);
  if (!parsed.ok) {
    return { status: 400, error: 'invalid_submission', details: parsed.errors };
  }
  const submission = parsed.submission;
  const eligibility = isEligible(submission, { repository, clock });
  const submittedAt = clock();
  const slas = computeSlaTimestamps(submittedAt);

  const base: Omit<Claim, 'id' | 'status' | 'fraudFlags'> = {
    policyId: submission.policyId,
    policyholderWallet: submission.policyholderWallet,
    claimType: submission.claimType,
    amountClaimedUsdc: submission.amountClaimedUsdc,
    incidentDescription: submission.incidentDescription,
    incidentDate: submission.incidentDate,
    evidence: submission.evidence,
    policeReportRef: submission.policeReportRef ?? null,
    deviceFingerprintSubmitted: submission.deviceFingerprint,
    devicePubkeySubmitted: submission.devicePubkey ?? null,
    submittedAt,
    reviewByAt: slas.reviewByAt,
    payoutByAt: slas.payoutByAt,
  };

  if (!eligibility.eligible) {
    const denialReason: DenialReason = eligibility.denialReason ?? 'policy_inactive';
    const claim = repository.createClaim({
      ...base,
      status: 'denied',
      fraudFlags: [],
      denialReason,
      denialDetail: eligibility.reasons.join('; '),
      deniedAt: submittedAt,
    });
    return { status: 200, claim };
  }

  const claim = repository.createClaim({
    ...base,
    status: 'submitted',
    fraudFlags: [],
  });
  return { status: 201, claim };
}
