// In-memory repository for claims, policies, signals, and settlement receipts.
// Mirrors the Postgres schema Agent B is building so routes and tests share a
// single storage interface. Swap at the boundary when Agent B's migrations ship.

import crypto from 'node:crypto';
import type {
  Claim,
  ClaimFilter,
  ClaimStatus,
  Policy,
  AuditScoreRow,
  SettlementReceipt,
} from './types.js';

const ACTIVE_STATUSES: ReadonlyArray<ClaimStatus> = [
  'submitted',
  'under_review',
  'approved',
];

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export interface ClaimsRepository {
  upsertPolicy(policy: Partial<Policy> & { id?: string }): Policy;
  getPolicy(id: string): Policy | null;
  listPolicies(): Policy[];

  appendAuditScore(policyId: string, row: AuditScoreRow): AuditScoreRow;
  getAuditHistory(policyId: string): AuditScoreRow[];

  createClaim(
    claim: Omit<Claim, 'id'> & { id?: string }
  ): Claim;
  updateClaim(id: string, patch: Partial<Claim>): Claim | null;
  getClaim(id: string): Claim | null;
  listClaims(filter?: ClaimFilter): Claim[];
  listByWallet(wallet: string): Claim[];
  findActiveClaimForPolicy(policyId: string, excludeId?: string | null): Claim | null;

  saveReceipt(receipt: SettlementReceipt): SettlementReceipt;
  getReceipt(claimId: string): SettlementReceipt | null;

  reset(): void;
}

export function makeRepository(): ClaimsRepository {
  const policies = new Map<string, Policy>();
  const claims = new Map<string, Claim>();
  const auditScores = new Map<string, AuditScoreRow[]>();
  const receipts = new Map<string, SettlementReceipt>();

  return {
    upsertPolicy(input) {
      const id = input.id ?? randomId('pol');
      const existing = policies.get(id);
      const merged: Policy = {
        id,
        policyholderWallet: input.policyholderWallet ?? existing?.policyholderWallet ?? '',
        active: input.active ?? existing?.active ?? false,
        createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
        boundAt: input.boundAt ?? existing?.boundAt ?? Date.now(),
        claimWaitingUntil:
          input.claimWaitingUntil ??
          existing?.claimWaitingUntil ??
          (input.boundAt ?? existing?.boundAt ?? Date.now()) + 24 * 60 * 60 * 1000,
        payoutCapUsdc: input.payoutCapUsdc ?? existing?.payoutCapUsdc ?? 0,
        deviceFingerprintHash:
          input.deviceFingerprintHash ?? existing?.deviceFingerprintHash ?? null,
        devicePubkey: input.devicePubkey ?? existing?.devicePubkey ?? null,
        topUps: input.topUps ?? existing?.topUps ?? [],
      };
      policies.set(id, merged);
      return merged;
    },

    getPolicy(id) {
      return policies.get(id) ?? null;
    },

    listPolicies() {
      return Array.from(policies.values());
    },

    appendAuditScore(policyId, row) {
      const list = auditScores.get(policyId) ?? [];
      list.push(row);
      auditScores.set(policyId, list);
      return row;
    },

    getAuditHistory(policyId) {
      return auditScores.get(policyId) ?? [];
    },

    createClaim(input) {
      const id = input.id ?? randomId('clm');
      const claim: Claim = { ...(input as Claim), id };
      claims.set(id, claim);
      return claim;
    },

    updateClaim(id, patch) {
      const existing = claims.get(id);
      if (!existing) return null;
      const merged: Claim = { ...existing, ...patch };
      claims.set(id, merged);
      return merged;
    },

    getClaim(id) {
      return claims.get(id) ?? null;
    },

    listClaims(filter = {}) {
      const all = Array.from(claims.values());
      let filtered = all;
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        const set = new Set<ClaimStatus>(statuses);
        filtered = filtered.filter((c) => set.has(c.status));
      }
      if (filter.policyholderWallet) {
        const wanted = filter.policyholderWallet.toLowerCase();
        filtered = filtered.filter(
          (c) => c.policyholderWallet.toLowerCase() === wanted,
        );
      }
      return filtered;
    },

    listByWallet(wallet) {
      const wanted = wallet.toLowerCase();
      return Array.from(claims.values()).filter(
        (c) => c.policyholderWallet.toLowerCase() === wanted,
      );
    },

    findActiveClaimForPolicy(policyId, excludeId = null) {
      for (const claim of claims.values()) {
        if (claim.policyId !== policyId) continue;
        if (excludeId && claim.id === excludeId) continue;
        if (ACTIVE_STATUSES.includes(claim.status)) return claim;
      }
      return null;
    },

    saveReceipt(receipt) {
      receipts.set(receipt.claimId, receipt);
      return receipt;
    },

    getReceipt(claimId) {
      return receipts.get(claimId) ?? null;
    },

    reset() {
      policies.clear();
      claims.clear();
      auditScores.clear();
      receipts.clear();
    },
  };
}

// Default repository instance. Server.js binds to this at startup; tests
// build their own via makeRepository().
export const defaultRepository: ClaimsRepository = makeRepository();
