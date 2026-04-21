import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { decide, isAdminWallet, submitForReview } from '../review.js';
import { makeRepository } from '../repository.js';
import type { SanctionsScreener } from '../sanctions.js';
import type { ReserveClient } from '../payout.js';
import {
  buildClaim,
  buildPolicy,
  fixedClock,
  WALLET_A,
  ADMIN_WALLET,
} from './fixtures.js';

function mockScreener(clear = true): SanctionsScreener {
  return async () =>
    clear
      ? { clear: true, checkedAt: 1 }
      : { clear: false, reason: 'ofac_hit', list: 'OFAC', checkedAt: 1 };
}

function mockReserveOk(): ReserveClient {
  return {
    async transferPayout() {
      return { success: true, txHash: '0xabc', network: 'mock' };
    },
  };
}

function mockReserveFail(): ReserveClient {
  return {
    async transferPayout() {
      return { success: false, error: 'revert: insufficient_pool' };
    },
  };
}

function seed(repo: ReturnType<typeof makeRepository>): void {
  buildPolicy(repo);
  repo.createClaim(buildClaim({ id: 'clm_fix1', policyholderWallet: WALLET_A }));
}

describe('claims/review', () => {
  describe('submitForReview', () => {
    it('transitions submitted to under_review and writes fraud flags', async () => {
      const repo = makeRepository();
      seed(repo);
      const result = await submitForReview(
        'clm_fix1',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        { repository: repo, sanctionsScreener: mockScreener(true), clock: fixedClock() },
      );
      assert.equal(result.ok, true);
      assert.equal(result.claim?.status, 'under_review');
      assert.equal(result.claim?.reviewedBy, 'admin-1');
      assert.equal(result.sanctions?.clear, true);
    });

    it('denies claim when sanctions screen fails', async () => {
      const repo = makeRepository();
      seed(repo);
      const result = await submitForReview(
        'clm_fix1',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        { repository: repo, sanctionsScreener: mockScreener(false), clock: fixedClock() },
      );
      assert.equal(result.ok, true);
      assert.equal(result.claim?.status, 'denied');
      assert.equal(result.claim?.denialReason, 'sanctions_hit');
    });

    it('404s when claim does not exist', async () => {
      const repo = makeRepository();
      const result = await submitForReview(
        'missing',
        { adminId: 'x', wallet: ADMIN_WALLET },
        { repository: repo, sanctionsScreener: mockScreener(true), clock: fixedClock() },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, 'claim_not_found');
    });
  });

  describe('decide(approve)', () => {
    it('approves + triggers payout + status becomes paid', async () => {
      const repo = makeRepository();
      seed(repo);
      repo.updateClaim('clm_fix1', { status: 'under_review' });
      const result = await decide(
        'clm_fix1',
        'approve',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        {
          repository: repo,
          sanctionsScreener: mockScreener(true),
          reserveClient: mockReserveOk(),
          clock: fixedClock(),
        },
      );
      assert.equal(result.ok, true);
      assert.equal(result.claim?.status, 'paid');
      assert.equal(result.payout?.txHash, '0xabc');
    });

    it('keeps claim in approved state when payout fails, schedules retry', async () => {
      const repo = makeRepository();
      seed(repo);
      repo.updateClaim('clm_fix1', { status: 'under_review' });
      const result = await decide(
        'clm_fix1',
        'approve',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        {
          repository: repo,
          sanctionsScreener: mockScreener(true),
          reserveClient: mockReserveFail(),
          clock: fixedClock(),
        },
      );
      assert.equal(result.ok, false);
      const stored = repo.getClaim('clm_fix1');
      assert.equal(stored?.status, 'approved');
      assert.ok(result.payout?.retryScheduledAt);
    });
  });

  describe('decide(deny)', () => {
    it('requires a reason', async () => {
      const repo = makeRepository();
      seed(repo);
      const result = await decide(
        'clm_fix1',
        'deny',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        {
          repository: repo,
          sanctionsScreener: mockScreener(true),
          reserveClient: mockReserveOk(),
          clock: fixedClock(),
        },
        '  ',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, 'reason_required');
    });

    it('writes the denial reason when provided', async () => {
      const repo = makeRepository();
      seed(repo);
      const result = await decide(
        'clm_fix1',
        'deny',
        { adminId: 'admin-1', wallet: ADMIN_WALLET },
        {
          repository: repo,
          sanctionsScreener: mockScreener(true),
          reserveClient: mockReserveOk(),
          clock: fixedClock(),
        },
        'evidence insufficient',
      );
      assert.equal(result.ok, true);
      assert.equal(result.claim?.status, 'denied');
      assert.equal(result.claim?.denialDetail, 'evidence insufficient');
    });
  });

  describe('isAdminWallet', () => {
    it('returns true when wallet is on allowlist', () => {
      const env = { ADMIN_WALLETS: `0xAAA,${ADMIN_WALLET}` } as NodeJS.ProcessEnv;
      assert.equal(isAdminWallet(ADMIN_WALLET, env), true);
    });
    it('returns false when allowlist is empty', () => {
      assert.equal(isAdminWallet(ADMIN_WALLET, { ADMIN_WALLETS: '' } as NodeJS.ProcessEnv), false);
    });
    it('returns false when wallet is not on allowlist', () => {
      const env = { ADMIN_WALLETS: '0xabc' } as NodeJS.ProcessEnv;
      assert.equal(isAdminWallet(ADMIN_WALLET, env), false);
    });
  });
});
