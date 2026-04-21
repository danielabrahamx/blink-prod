/**
 * Replay engine.
 *
 * Given (policy_id, time_window, model_version), re-extracts features from
 * the stored envelope rows in the window, re-scores with the specified
 * model, and returns:
 *
 *   - `series`: one point per envelope with timestamp, replayed multiplier,
 *     originally-charged multiplier, and delta.
 *   - `total_delta_usdc`: the accrual delta projected into USDC units. The
 *     caller passes the per-second-per-multiplier-unit rate; the replay
 *     engine is policy-agnostic about pricing.
 *
 * Design doc Module 2 / Module 5 — "Replay button".
 */

import { extractFeatures } from "./feature-vector";
import { score, MODEL_VERSION as DEFAULT_MODEL_VERSION } from "./score";
import type { AuditRepo, AuditScoreRow } from "./audit";
import type { PolicyContext, ScoredMultiplier, SignalEnvelope } from "./types";

export interface EnvelopeRow {
  id: string;
  policy_id: string;
  envelope: SignalEnvelope;
  /** Wall-clock at which the envelope was received server-side. */
  received_at: string;
}

export interface EnvelopeRepo {
  listForPolicy(policy_id: string, from: string, to: string): Promise<EnvelopeRow[]>;
}

export interface ReplayContextProvider {
  /**
   * Return the policy context as-of `at`. For pilot this is the current
   * policy row; for long replay windows the caller can project the
   * home_wifi_set back to that date.
   */
  getContext(policy_id: string, at: string): Promise<PolicyContext>;
}

export interface ReplayPoint {
  /** Timestamp of the envelope (ISO). */
  ts: string;
  /** Multiplier produced by the replay run. */
  multiplier: number;
  /** Multiplier originally charged (from audit_score), 0 if no audit row. */
  charged_multiplier: number;
  /** `multiplier - charged_multiplier`. Positive ⇒ replay overcharges. */
  delta: number;
  /** Full scored record for admin inspector tooltips. */
  scored: ScoredMultiplier;
}

export interface ReplayResult {
  policy_id: string;
  from: string;
  to: string;
  model_version: string;
  series: ReplayPoint[];
  /** Sum of replay multipliers over the window. */
  accrued_replayed: number;
  /** Sum of originally-charged multipliers over the window. */
  accrued_original: number;
  /**
   * The monetary delta, in USDC. Derived from `sum(delta) * rate_per_unit *
   * seconds_represented`. When `rate_per_unit_usdc_per_sec` is omitted,
   * returns the raw `sum(delta)` as a unitless series count so admin
   * tooling can compute its own pricing.
   */
  total_delta_usdc: number;
}

export interface ReplayOptions {
  /**
   * USDC per multiplier-unit per envelope. Defaults to 1.0 so the result is
   * unitless until the caller supplies a price. For Blink MVP the unit rate
   * is the At-Desk / Away base rate × envelope cadence.
   */
  rate_per_unit_usdc?: number;
  /** Jurisdiction set threaded to the scorer. */
  within_jurisdiction?: ReadonlySet<string>;
}

function indexAudit(rows: AuditScoreRow[]): Map<string, AuditScoreRow> {
  const m = new Map<string, AuditScoreRow>();
  for (const r of rows) m.set(r.signal_envelope_id, r);
  return m;
}

export interface ReplayPolicyParams {
  policy_id: string;
  from: string;
  to: string;
  model_version?: string;
}

export interface ReplayDeps {
  envelopes: EnvelopeRepo;
  audit: AuditRepo;
  ctxProvider: ReplayContextProvider;
}

/**
 * Per-envelope replay across a time window. The signature intentionally
 * mirrors the handoff shape: `replayPolicy(db, policyId, timeWindow,
 * modelVersion)`. Here `db` is factored into `deps` so tests can inject the
 * in-memory repos without wrapping a pg pool.
 */
export async function replayPolicy(
  params: ReplayPolicyParams,
  deps: ReplayDeps,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const modelVersion = params.model_version ?? DEFAULT_MODEL_VERSION;

  const [envelopeRows, auditRows] = await Promise.all([
    deps.envelopes.listForPolicy(params.policy_id, params.from, params.to),
    deps.audit.listForPolicy(params.policy_id, params.from, params.to),
  ]);

  const auditByEnv = indexAudit(auditRows);

  const series: ReplayPoint[] = [];
  let accrued_replayed = 0;
  let accrued_original = 0;
  let deltaSum = 0;

  for (const env of envelopeRows) {
    const ctx = await deps.ctxProvider.getContext(env.policy_id, env.received_at);
    const features = extractFeatures(env.envelope, ctx, new Date(env.received_at));
    const scored = score(features, {
      model_version: modelVersion,
      ...(opts.within_jurisdiction !== undefined
        ? { within_jurisdiction: opts.within_jurisdiction }
        : {}),
    });

    const original = auditByEnv.get(env.id)?.multiplier ?? 0;
    const delta = scored.multiplier - original;

    accrued_replayed += scored.multiplier;
    accrued_original += original;
    deltaSum += delta;

    series.push({
      ts: env.received_at,
      multiplier: scored.multiplier,
      charged_multiplier: original,
      delta,
      scored,
    });
  }

  const rate = opts.rate_per_unit_usdc ?? 1.0;
  const total_delta_usdc = deltaSum * rate;

  return {
    policy_id: params.policy_id,
    from: params.from,
    to: params.to,
    model_version: modelVersion,
    series,
    accrued_replayed,
    accrued_original,
    total_delta_usdc,
  };
}
