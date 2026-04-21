// Shared fixtures for claims v1 tests.

import type { ClaimsRepository } from '../repository.js';
import type {
  AuditScoreRow,
  Claim,
  ClaimSubmission,
  Policy,
  PolicyTopUp,
} from '../types.js';

export const DAY = 24 * 60 * 60 * 1000;
export const FIXED_NOW = 1_700_000_000_000;
export const WALLET_A = '0x1111111111111111111111111111111111111aaa';
export const WALLET_B = '0x2222222222222222222222222222222222222bbb';
export const ADMIN_WALLET = '0x9999999999999999999999999999999999999999';
export const DEVICE_HASH = 'fp_bind_hash_v1';
export const DEVICE_PUBKEY = 'edpk_device_bind';
export const POLICY_CAP_USDC = 1500;

export function buildPolicy(
  repository: ClaimsRepository,
  overrides: Partial<Policy> = {},
): Policy {
  const now = FIXED_NOW;
  return repository.upsertPolicy({
    id: 'pol_fix1',
    policyholderWallet: WALLET_A,
    active: true,
    createdAt: now - 10 * DAY,
    boundAt: now - 10 * DAY,
    claimWaitingUntil: now - 9 * DAY,
    payoutCapUsdc: POLICY_CAP_USDC,
    deviceFingerprintHash: DEVICE_HASH,
    devicePubkey: DEVICE_PUBKEY,
    topUps: [],
    ...overrides,
  });
}

export function buildSubmission(
  overrides: Partial<ClaimSubmission> = {},
): ClaimSubmission {
  return {
    policyId: 'pol_fix1',
    policyholderWallet: WALLET_A,
    claimType: 'damage',
    incidentDescription: 'dropped laptop on airport floor',
    incidentDate: FIXED_NOW - DAY,
    amountClaimedUsdc: 300,
    deviceFingerprint: DEVICE_HASH,
    devicePubkey: DEVICE_PUBKEY,
    policeReportRef: null,
    evidence: [
      {
        filename: 'damage.jpg',
        mimetype: 'image/jpeg',
        sizeBytes: 120_000,
        storageUri: 'file:///tmp/damage.jpg',
        uploadedAt: FIXED_NOW,
      },
    ],
    ...overrides,
  };
}

export function buildClaim(
  overrides: Partial<Claim> = {},
): Claim {
  return {
    id: 'clm_fix1',
    policyId: 'pol_fix1',
    policyholderWallet: WALLET_A,
    claimType: 'damage',
    amountClaimedUsdc: 300,
    incidentDescription: 'dropped laptop',
    incidentDate: FIXED_NOW - DAY,
    evidence: [],
    policeReportRef: null,
    deviceFingerprintSubmitted: DEVICE_HASH,
    devicePubkeySubmitted: DEVICE_PUBKEY,
    status: 'submitted',
    fraudFlags: [],
    submittedAt: FIXED_NOW,
    reviewByAt: FIXED_NOW + 24 * 60 * 60 * 1000,
    payoutByAt: FIXED_NOW + 72 * 60 * 60 * 1000,
    ...overrides,
  };
}

export function buildAuditRows(
  count: number,
  atMaxRatio: number,
): AuditScoreRow[] {
  const atMax = Math.floor(count * atMaxRatio);
  const rows: AuditScoreRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const isMax = i < atMax;
    rows.push({
      policyId: 'pol_fix1',
      multiplier: isMax ? 3 : 1,
      maxMultiplier: 3,
      ts: FIXED_NOW - (count - i) * 60_000,
    });
  }
  return rows;
}

export function buildTopUps(count: number, spacingMs: number, start: number):
  PolicyTopUp[] {
  return Array.from({ length: count }, (_, i) => ({
    amountUsdc: 10,
    addedAt: start + i * spacingMs,
  }));
}

// Clock factory: returns a fn yielding FIXED_NOW + offset.
export function fixedClock(offsetMs = 0): () => number {
  return () => FIXED_NOW + offsetMs;
}
