/**
 * Rulebook v1.0.0
 *
 * Factor-product scorer per design doc Module 2 and Agent E handoff.
 *
 * Each factor is a table-driven lookup over a categorical feature (or a
 * bucketed numeric feature). The product of all factor values is the raw
 * multiplier, which is then:
 *
 *   1. Clamped to [0.5, 3.0]                          (hard bounds).
 *   2. Hard-capped at 1.0 while calibration_done=false (honeymoon).
 *   3. Rate-of-change clamped relative to prior_multiplier (anti-whiplash).
 *
 * The actuarial team will replace factor bodies later. The public signature
 * (FeatureVector → ScoredMultiplier) must remain stable.
 *
 * See docs/DECISIONS.md 2026-04-21 for factor-table provenance.
 */

import type {
  AppCategory,
  ChargingState,
  Explanation,
  ExplanationFactor,
  FeatureVector,
  JurisdictionBucket,
  LidState,
  ScoredMultiplier,
  WifiTrust,
} from "./types";

export const MODEL_VERSION = "rulebook_v1.0.0";
export const MULTIPLIER_MIN = 0.5;
export const MULTIPLIER_MAX = 3.0;
export const CALIBRATING_CAP = 1.0;

/**
 * Rate-of-change cap: the multiplier may change by at most this fraction of
 * the prior value between consecutive envelopes. Prevents user-visible
 * whiplash when a single signal (e.g. lid close) flips. Design-doc intent;
 * the actuary will tune later.
 */
export const RATE_OF_CHANGE_MAX_DELTA = 0.4;

// ── Factor tables ────────────────────────────────────────────────────────────
// Tables are exported so the admin portal can render the same copy the UI
// sees, and so tests can assert against the source of truth.

export const WIFI_TRUST_FACTOR: Readonly<Record<WifiTrust, number>> = Object.freeze({
  home: 0.8,
  unknown: 1.0,
  untrusted: 1.8,
});

export const CHARGING_STATE_FACTOR: Readonly<Record<ChargingState, number>> = Object.freeze({
  charging: 0.85,
  battery: 1.0,
});

export const LID_STATE_FACTOR: Readonly<Record<LidState, number>> = Object.freeze({
  open: 1.0,
  closed: 0.7,
});

export const APP_CATEGORY_FACTOR: Readonly<Record<AppCategory, number>> = Object.freeze({
  productivity: 0.9,
  browser: 1.0,
  media: 1.1,
  idle: 0.7,
  unknown: 1.0,
});

export const INPUT_IDLE_FACTOR: Readonly<Record<"true" | "false", number>> = Object.freeze({
  true: 0.7,
  false: 1.0,
});

export const JURISDICTION_FACTOR: Readonly<Record<JurisdictionBucket, number>> = Object.freeze({
  home_match: 1.0,
  within_jurisdiction: 1.15,
  international: 1.5,
});

/**
 * Battery health buckets (inclusive-lower, exclusive-upper except the top
 * bucket which is inclusive-upper at 100). Null maps to 1.0 per handoff.
 */
export function batteryHealthFactor(pct: number | null): {
  value: number;
  reason: string;
} {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { value: 1.0, reason: "battery_health unknown → neutral" };
  }
  if (pct >= 80) {
    return { value: 1.0, reason: `battery_health ${pct}% (healthy) → neutral` };
  }
  if (pct >= 60) {
    return { value: 1.1, reason: `battery_health ${pct}% (60-79) → +10%` };
  }
  if (pct >= 40) {
    return { value: 1.25, reason: `battery_health ${pct}% (40-59) → +25%` };
  }
  return { value: 1.5, reason: `battery_health ${pct}% (<40) → +50%` };
}

/**
 * Translate (ip_country, home_country_match, within_jurisdiction) into one of
 * the three buckets. The `within_jurisdiction` set (optional) comes from the
 * policy context; absent set means no middle tier so the factor is either
 * home_match or international.
 */
export function classifyJurisdiction(
  ipCountry: string | null,
  homeMatch: boolean,
  within?: ReadonlySet<string>,
): JurisdictionBucket {
  if (homeMatch) return "home_match";
  if (ipCountry === null) return "international"; // no IP ⇒ worst case
  if (within && within.has(ipCountry)) return "within_jurisdiction";
  return "international";
}

function pushFactor(
  out: ExplanationFactor[],
  name: string,
  value: number,
  reason: string,
): number {
  out.push({ name, value, reason });
  return value;
}

function pctSign(x: number): string {
  const pct = Math.round((x - 1) * 100);
  if (pct === 0) return "neutral";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Apply the rate-of-change clamp. Returns the final multiplier and, if
 * clamped, the reason string for the explanation.
 */
function applyRateOfChangeClamp(
  raw: number,
  prior: number | null,
): { value: number; reason: string | null } {
  if (prior === null || !Number.isFinite(prior) || prior <= 0) {
    return { value: raw, reason: null };
  }
  const maxDelta = prior * RATE_OF_CHANGE_MAX_DELTA;
  const floor = Math.max(MULTIPLIER_MIN, prior - maxDelta);
  const ceil = Math.min(MULTIPLIER_MAX, prior + maxDelta);
  if (raw < floor) {
    return { value: floor, reason: `rate-of-change clamped up from ${raw.toFixed(3)}x` };
  }
  if (raw > ceil) {
    return { value: ceil, reason: `rate-of-change clamped down from ${raw.toFixed(3)}x` };
  }
  return { value: raw, reason: null };
}

export interface RulebookOptions {
  /**
   * Optional jurisdiction set for the "within_jurisdiction" tier. The
   * extractor has no way to know this per-policy on its own (it only knows
   * the home country), so callers thread it through here. Absent ⇒ no
   * middle tier (home_match / international only).
   */
  within_jurisdiction?: ReadonlySet<string>;
}

/**
 * Score a FeatureVector with rulebook_v1.0.0.
 */
export function rulebookV1(f: FeatureVector, opts: RulebookOptions = {}): ScoredMultiplier {
  const factors: ExplanationFactor[] = [];

  const wifi = pushFactor(
    factors,
    "wifi_trust",
    WIFI_TRUST_FACTOR[f.wifi_trust],
    `wifi_trust=${f.wifi_trust} → ${pctSign(WIFI_TRUST_FACTOR[f.wifi_trust])}`,
  );

  const charging = pushFactor(
    factors,
    "charging_state",
    CHARGING_STATE_FACTOR[f.charging_state],
    `charging_state=${f.charging_state} → ${pctSign(CHARGING_STATE_FACTOR[f.charging_state])}`,
  );

  const lid = pushFactor(
    factors,
    "lid_state",
    LID_STATE_FACTOR[f.lid_state],
    `lid_state=${f.lid_state} → ${pctSign(LID_STATE_FACTOR[f.lid_state])}`,
  );

  const app = pushFactor(
    factors,
    "app_category",
    APP_CATEGORY_FACTOR[f.app_category],
    `app_category=${f.app_category} → ${pctSign(APP_CATEGORY_FACTOR[f.app_category])}`,
  );

  const idleKey: "true" | "false" = f.input_idle_flag ? "true" : "false";
  const idle = pushFactor(
    factors,
    "input_idle_flag",
    INPUT_IDLE_FACTOR[idleKey],
    `input_idle_flag=${f.input_idle_flag} → ${pctSign(INPUT_IDLE_FACTOR[idleKey])}`,
  );

  const jurBucket = classifyJurisdiction(f.ip_country, f.home_country_match, opts.within_jurisdiction);
  const jurisdictionValue = JURISDICTION_FACTOR[jurBucket];
  const jurisdiction = pushFactor(
    factors,
    "ip_country",
    jurisdictionValue,
    `ip_country=${f.ip_country ?? "unknown"} (${jurBucket}) → ${pctSign(jurisdictionValue)}`,
  );

  const battery = batteryHealthFactor(f.battery_health_pct);
  pushFactor(factors, "battery_health_pct", battery.value, battery.reason);

  const totalBeforeClamp = wifi * charging * lid * app * idle * jurisdiction * battery.value;

  // ── Hard gates in priority order ─────────────────────────────────────────
  let total = totalBeforeClamp;
  let gateReason: string | undefined;

  // 1. Hard bounds clamp first (actuarial cap).
  if (total < MULTIPLIER_MIN) {
    total = MULTIPLIER_MIN;
    gateReason = `clamped up to floor ${MULTIPLIER_MIN}x`;
  } else if (total > MULTIPLIER_MAX) {
    total = MULTIPLIER_MAX;
    gateReason = `clamped down to ceiling ${MULTIPLIER_MAX}x`;
  }

  // 2. Rate-of-change vs prior multiplier (anti-whiplash).
  const roc = applyRateOfChangeClamp(total, f.prior_multiplier);
  if (roc.reason !== null) {
    gateReason = roc.reason;
  }
  total = roc.value;

  // 3. Calibrating hard-cap. Highest priority → overrides prior gates.
  if (!f.calibration_done && total > CALIBRATING_CAP) {
    total = CALIBRATING_CAP;
    gateReason = `calibration incomplete → capped at ${CALIBRATING_CAP}x`;
  }

  const explanation: Explanation = {
    factors,
    total_before_clamp: totalBeforeClamp,
    total_after_clamp: total,
    ...(gateReason !== undefined ? { gate_reason: gateReason } : {}),
  };

  return {
    multiplier: total,
    model_version: MODEL_VERSION,
    explanation,
  };
}
