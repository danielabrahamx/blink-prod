import { describe, it, expect, afterEach } from 'vitest';
import {
  getAccrualEngine,
  getAccrualLedger,
  setAccrualEngine,
  setAccrualLedger,
  computeAccruedUsdc,
} from './index.js';
import { NotImplementedError } from '../lib/errors.js';
import type { AccrualEntry } from '../types/index.js';

const scored = {
  multiplier: 2,
  model_version: 'rulebook_v1.0.0',
  features: {
    wifi_trust_score: 1,
    at_desk_confidence: 1,
    jurisdiction_match: true,
    device_age_risk: 0,
    time_of_day: 12,
    activity_signal: 'active' as const,
    policy_age_days: 1,
  },
  explanation: { factors: [], base_multiplier: 1, final_multiplier: 2 },
  computed_at: '2026-04-21T00:00:00Z',
};

describe('accrual scaffolding', () => {
  afterEach(() => {
    setAccrualEngine({
      tick: async () => {
        throw new NotImplementedError('accrual engine not implemented (Agent F)');
      },
      finalize: async () => {
        throw new NotImplementedError('accrual engine not implemented (Agent F)');
      },
    });
    setAccrualLedger({
      record: async () => {
        throw new NotImplementedError('accrual ledger not implemented (Agent F)');
      },
      totalForPolicy: async () => {
        throw new NotImplementedError('accrual ledger not implemented (Agent F)');
      },
      sincePolicyCreate: async () => {
        throw new NotImplementedError('accrual ledger not implemented (Agent F)');
      },
    });
  });

  it('default engine throws NotImplemented on tick', async () => {
    await expect(
      getAccrualEngine().tick({
        policy_id: 'p',
        base_rate_usdc: 0.000005,
        duration_seconds: 1,
        scored,
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('default ledger throws NotImplemented on totalForPolicy', async () => {
    await expect(getAccrualLedger().totalForPolicy('p')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(
      getAccrualLedger().record({} as unknown as AccrualEntry),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(
      getAccrualLedger().sincePolicyCreate('p'),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('default engine throws NotImplemented on finalize', async () => {
    await expect(getAccrualEngine().finalize('p')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it('computeAccruedUsdc multiplies rate * duration * multiplier', () => {
    expect(
      computeAccruedUsdc({
        policy_id: 'p',
        base_rate_usdc: 0.000005,
        duration_seconds: 60,
        scored,
      }),
    ).toBeCloseTo(0.0006, 8);
  });
});
