import type {
  AccrualEntry,
  FeatureVector,
  Policy,
  ScoredMultiplier,
  SignalEnvelope,
} from '../types/index.js';
import { extractFeatures } from '../features/index.js';
import { getRiskEngine } from '../risk/index.js';
import { computeAccruedUsdc } from '../accrual/index.js';

/**
 * Replay:
 *   (policy_id, time_window, model_version) ->
 *     re-extract features from stored envelopes ->
 *     re-score with the currently-installed (or specified) engine ->
 *     return per-envelope series + delta vs. the historical charge.
 */

export interface ReplayInput {
  policy: Policy;
  envelopes: Array<{
    envelope: SignalEnvelope;
    ip_country: string | null;
    received_at: string;
  }>;
  originalAccrual: AccrualEntry[];
  baseRateUsdc: number;
  secondsPerEnvelope: number;
}

export interface ReplayPoint {
  ts: string;
  features: FeatureVector;
  scored: ScoredMultiplier;
  hypothetical_usdc: number;
}

export interface ReplayResult {
  model_version: string;
  points: ReplayPoint[];
  hypothetical_total_usdc: number;
  original_total_usdc: number;
  delta_usdc: number;
}

export function replay(input: ReplayInput): ReplayResult {
  const engine = getRiskEngine();
  const points: ReplayPoint[] = input.envelopes.map((row) => {
    const features = extractFeatures({
      envelope: row.envelope,
      ip_country: row.ip_country,
      policy: input.policy,
    });
    const scored = engine.score(features);
    const hypothetical_usdc = computeAccruedUsdc({
      policy_id: input.policy.policy_id,
      base_rate_usdc: input.baseRateUsdc,
      duration_seconds: input.secondsPerEnvelope,
      scored,
    });
    return {
      ts: row.received_at,
      features,
      scored,
      hypothetical_usdc,
    };
  });
  const hypothetical_total_usdc = points.reduce(
    (s, p) => s + p.hypothetical_usdc,
    0,
  );
  const original_total_usdc = input.originalAccrual.reduce(
    (s, a) => s + a.charged_usdc,
    0,
  );
  return {
    model_version: engine.version,
    points,
    hypothetical_total_usdc,
    original_total_usdc,
    delta_usdc: hypothetical_total_usdc - original_total_usdc,
  };
}
