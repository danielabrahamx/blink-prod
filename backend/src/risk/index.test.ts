import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FeatureVector, ScoredMultiplier } from '../types/index.js';
import {
  score,
  setRiskEngine,
  getRiskEngine,
  resetRiskEngine,
} from './index.js';
import { NotImplementedError } from '../lib/errors.js';

const features: FeatureVector = {
  wifi_trust_score: 1,
  at_desk_confidence: 1,
  jurisdiction_match: true,
  device_age_risk: 0,
  time_of_day: 12,
  activity_signal: 'active',
  policy_age_days: 10,
};

describe('risk engine', () => {
  beforeEach(() => {
    // Module-level state is shared across test files; reset before each
    // assertion so a neighbour test's setRiskEngine call cannot leak in.
    resetRiskEngine();
  });
  afterEach(() => {
    resetRiskEngine();
  });

  it('throws NotImplementedError by default', () => {
    expect(() => score(features)).toThrow(NotImplementedError);
  });

  it('allows Agent E to inject an engine', () => {
    const fake: ScoredMultiplier = {
      multiplier: 1.5,
      model_version: 'fake_v1',
      features,
      explanation: { factors: [], base_multiplier: 1, final_multiplier: 1.5 },
      computed_at: '2026-04-21T13:30:00Z',
    };
    setRiskEngine({ version: 'fake_v1', score: () => fake });
    expect(getRiskEngine().version).toBe('fake_v1');
    expect(score(features).multiplier).toBe(1.5);
  });
});
