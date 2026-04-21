import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import {
  computeFraudFlags,
  isAgeVsAmountFlag,
  isConstantMaxMultiplierFlag,
  isDeviceMismatchFlag,
  isImpossibleIncidentDateFlag,
  isRapidAmountEscalationFlag,
} from '../fraud-flags.js';
import { makeRepository } from '../repository.js';
import {
  buildAuditRows,
  buildClaim,
  buildPolicy,
  buildTopUps,
  DAY,
  DEVICE_PUBKEY,
  FIXED_NOW,
  fixedClock,
} from './fixtures.js';

describe('claims/fraud-flags', () => {
  describe('age_vs_amount', () => {
    it('flags when policy age < 7d AND amount > 50% cap', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo, { boundAt: FIXED_NOW - 3 * DAY });
      const claim = buildClaim({ amountClaimedUsdc: 900 });
      assert.equal(isAgeVsAmountFlag(policy, claim, fixedClock()), true);
    });
    it('does not flag when policy is older than 7d', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo, { boundAt: FIXED_NOW - 14 * DAY });
      const claim = buildClaim({ amountClaimedUsdc: 1499 });
      assert.equal(isAgeVsAmountFlag(policy, claim, fixedClock()), false);
    });
    it('does not flag when amount < 50% cap', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo, { boundAt: FIXED_NOW - 3 * DAY });
      const claim = buildClaim({ amountClaimedUsdc: 100 });
      assert.equal(isAgeVsAmountFlag(policy, claim, fixedClock()), false);
    });
  });

  describe('constant_max_multiplier', () => {
    it('flags when >80% of audit rows are at max', () => {
      const rows = buildAuditRows(20, 0.9);
      assert.equal(isConstantMaxMultiplierFlag(rows), true);
    });
    it('does not flag when exactly 80%', () => {
      const rows = buildAuditRows(20, 0.8);
      assert.equal(isConstantMaxMultiplierFlag(rows), false);
    });
    it('does not flag with empty history', () => {
      assert.equal(isConstantMaxMultiplierFlag([]), false);
    });
  });

  describe('device_mismatch', () => {
    it('flags when claim devicePubkey differs from registered', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo);
      const claim = buildClaim({ devicePubkeySubmitted: 'edpk_rotated' });
      assert.equal(isDeviceMismatchFlag(policy, claim), true);
    });
    it('does not flag when pubkeys match', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo);
      const claim = buildClaim({ devicePubkeySubmitted: DEVICE_PUBKEY });
      assert.equal(isDeviceMismatchFlag(policy, claim), false);
    });
  });

  describe('impossible_incident_date', () => {
    it('flags incidentDate in the future', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo);
      const claim = buildClaim({ incidentDate: FIXED_NOW + 10 * DAY });
      assert.equal(isImpossibleIncidentDateFlag(policy, claim, fixedClock()), true);
    });
    it('flags incidentDate before policy.createdAt', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo, {
        createdAt: FIXED_NOW - 3 * DAY,
      });
      const claim = buildClaim({ incidentDate: FIXED_NOW - 30 * DAY });
      assert.equal(isImpossibleIncidentDateFlag(policy, claim, fixedClock()), true);
    });
    it('does not flag a valid incidentDate', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo);
      const claim = buildClaim({ incidentDate: FIXED_NOW - DAY });
      assert.equal(isImpossibleIncidentDateFlag(policy, claim, fixedClock()), false);
    });
  });

  describe('rapid_amount_escalation', () => {
    it('flags when >3 top-ups occurred in the 48h before the claim', () => {
      const repo = makeRepository();
      const topUps = buildTopUps(5, 4 * 60 * 60 * 1000, FIXED_NOW - 40 * 60 * 60 * 1000);
      const policy = buildPolicy(repo, { topUps });
      const claim = buildClaim({ submittedAt: FIXED_NOW });
      assert.equal(isRapidAmountEscalationFlag(policy, claim, fixedClock()), true);
    });
    it('does not flag when only 2 top-ups in window', () => {
      const repo = makeRepository();
      const topUps = buildTopUps(2, 4 * 60 * 60 * 1000, FIXED_NOW - 40 * 60 * 60 * 1000);
      const policy = buildPolicy(repo, { topUps });
      const claim = buildClaim({ submittedAt: FIXED_NOW });
      assert.equal(isRapidAmountEscalationFlag(policy, claim, fixedClock()), false);
    });
  });

  describe('computeFraudFlags (combined)', () => {
    it('returns empty array when no rules trigger', () => {
      const repo = makeRepository();
      const policy = buildPolicy(repo);
      const claim = buildClaim();
      const flags = computeFraudFlags(claim, policy, [], fixedClock());
      assert.deepEqual(flags, []);
    });
    it('collects every triggered flag', () => {
      const repo = makeRepository();
      const topUps = buildTopUps(5, 4 * 60 * 60 * 1000, FIXED_NOW - 40 * 60 * 60 * 1000);
      const policy = buildPolicy(repo, {
        boundAt: FIXED_NOW - 2 * DAY,
        createdAt: FIXED_NOW - 2 * DAY,
        devicePubkey: 'edpk_original',
        topUps,
      });
      const claim = buildClaim({
        amountClaimedUsdc: 1000,
        devicePubkeySubmitted: 'edpk_rotated',
        incidentDate: FIXED_NOW + DAY,
        submittedAt: FIXED_NOW,
      });
      const rows = buildAuditRows(20, 0.95);
      const flags = computeFraudFlags(claim, policy, rows, fixedClock());
      assert.ok(flags.includes('age_vs_amount'));
      assert.ok(flags.includes('constant_max_multiplier'));
      assert.ok(flags.includes('device_mismatch'));
      assert.ok(flags.includes('impossible_incident_date'));
      assert.ok(flags.includes('rapid_amount_escalation'));
    });
  });
});
