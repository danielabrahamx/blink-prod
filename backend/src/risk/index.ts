import type { FeatureVector, ScoredMultiplier } from '../types/index.js';
import { NotImplementedError } from '../lib/errors.js';

/**
 * Risk engine interface. Agent E (feat/risk-engine) fills this in with
 * `rulebook_v1.0.0`. This module only defines the contract so the rest of
 * the backend (ingest, accrual, admin replay) can depend on it today.
 */

export interface RiskEngine {
  version: string;
  score(features: FeatureVector): ScoredMultiplier;
}

class NotImplementedRiskEngine implements RiskEngine {
  readonly version = 'not_implemented';
  score(_features: FeatureVector): ScoredMultiplier {
    throw new NotImplementedError('risk engine not implemented (Agent E)');
  }
}

let installed: RiskEngine = new NotImplementedRiskEngine();

export function setRiskEngine(engine: RiskEngine): void {
  installed = engine;
}

export function getRiskEngine(): RiskEngine {
  return installed;
}

export function resetRiskEngine(): void {
  installed = new NotImplementedRiskEngine();
}

/**
 * Public entry point. Re-exported by admin/replay and the /signals route.
 */
export function score(features: FeatureVector): ScoredMultiplier {
  return getRiskEngine().score(features);
}
