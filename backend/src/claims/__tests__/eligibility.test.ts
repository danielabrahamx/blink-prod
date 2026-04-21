import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { isEligible, isEligibleSimple } from '../eligibility.js';
import { makeRepository } from '../repository.js';
import {
  buildPolicy,
  buildSubmission,
  DAY,
  DEVICE_HASH,
  FIXED_NOW,
  fixedClock,
} from './fixtures.js';

describe('claims/eligibility', () => {
  describe('isEligible (full)', () => {
    it('returns eligible for a fully valid submission', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(buildSubmission(), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, true);
      assert.deepEqual(res.reasons, []);
    });

    it('denies when policy missing', () => {
      const repo = makeRepository();
      const res = isEligible(buildSubmission({ policyId: 'pol_missing' }), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'policy_inactive');
      assert.ok(res.reasons.includes('policy_not_found'));
    });

    it('denies when policy is inactive', () => {
      const repo = makeRepository();
      buildPolicy(repo, { active: false });
      const res = isEligible(buildSubmission(), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'policy_inactive');
    });

    it('denies when waiting period has not elapsed', () => {
      const repo = makeRepository();
      buildPolicy(repo, {
        boundAt: FIXED_NOW - 1000,
        claimWaitingUntil: FIXED_NOW + DAY,
      });
      const res = isEligible(buildSubmission(), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'waiting_period');
    });

    it('denies when another active claim exists', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      repo.createClaim({
        id: 'clm_open',
        policyId: 'pol_fix1',
        policyholderWallet: '0xabc',
        claimType: 'damage',
        amountClaimedUsdc: 50,
        incidentDescription: '—',
        incidentDate: FIXED_NOW - DAY,
        evidence: [],
        policeReportRef: null,
        deviceFingerprintSubmitted: DEVICE_HASH,
        devicePubkeySubmitted: null,
        status: 'submitted',
        fraudFlags: [],
        submittedAt: FIXED_NOW,
        reviewByAt: FIXED_NOW + DAY,
        payoutByAt: FIXED_NOW + 3 * DAY,
      });
      const res = isEligible(buildSubmission(), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'duplicate_active_claim');
    });

    it('denies when amount exceeds cap', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(buildSubmission({ amountClaimedUsdc: 2000 }), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'amount_exceeds_cap');
    });

    it('denies when device fingerprint does not match bind-time', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(buildSubmission({ deviceFingerprint: 'fp_other' }), {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'fingerprint_mismatch');
    });

    it('denies when incident date is in the future', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(
        buildSubmission({ incidentDate: FIXED_NOW + 10 * DAY }),
        { repository: repo, clock: fixedClock() },
      );
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'impossible_incident_date');
    });

    it('denies when incident date is before policy.createdAt', () => {
      const repo = makeRepository();
      buildPolicy(repo, {
        createdAt: FIXED_NOW - 5 * DAY,
        boundAt: FIXED_NOW - 5 * DAY,
        claimWaitingUntil: FIXED_NOW - 4 * DAY,
      });
      const res = isEligible(
        buildSubmission({ incidentDate: FIXED_NOW - 30 * DAY }),
        { repository: repo, clock: fixedClock() },
      );
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'impossible_incident_date');
    });

    it('requires a police report for theft over $500', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(
        buildSubmission({
          claimType: 'theft',
          amountClaimedUsdc: 700,
          policeReportRef: null,
        }),
        { repository: repo, clock: fixedClock() },
      );
      assert.equal(res.eligible, false);
      assert.equal(res.denialReason, 'police_report_missing');
    });

    it('accepts theft claim over $500 when police report supplied', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligible(
        buildSubmission({
          claimType: 'theft',
          amountClaimedUsdc: 700,
          policeReportRef: 'CR/2026/9999',
        }),
        { repository: repo, clock: fixedClock() },
      );
      assert.equal(res.eligible, true);
    });

    it('accumulates multiple denial reasons', () => {
      const repo = makeRepository();
      buildPolicy(repo, { active: false });
      const res = isEligible(
        buildSubmission({
          amountClaimedUsdc: 9999,
          deviceFingerprint: 'fp_other',
          incidentDate: FIXED_NOW + DAY,
        }),
        { repository: repo, clock: fixedClock() },
      );
      assert.equal(res.eligible, false);
      assert.ok(res.reasons.length >= 3);
    });
  });

  describe('isEligibleSimple (UI pre-flight)', () => {
    it('returns eligible when policy active and amount <= cap', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligibleSimple('pol_fix1', 200, {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, true);
    });

    it('returns not-eligible when amount > cap', () => {
      const repo = makeRepository();
      buildPolicy(repo);
      const res = isEligibleSimple('pol_fix1', 9999, {
        repository: repo,
        clock: fixedClock(),
      });
      assert.equal(res.eligible, false);
      assert.ok(res.reasons.includes('amount_exceeds_cap'));
    });
  });
});
