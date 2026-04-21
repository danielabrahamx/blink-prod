/**
 * Feature extractor.
 *
 * Pure function of (SignalEnvelope, PolicyContext) → FeatureVector.
 *
 * The extractor is versioned (FEATURE_VERSION). Re-scoring historical data
 * requires re-extracting because extractor logic will evolve; the audit log
 * persists the materialised FeatureVector so consumers can see what the
 * model actually ingested at scoring time.
 */

import type {
  AppCategory,
  ChargingState,
  FeatureVector,
  LidState,
  PolicyContext,
  SignalEnvelope,
  WifiTrust,
} from "./types";

export const FEATURE_VERSION = "feat_v1.0.0";

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Derive wifi_trust categorical.
 *
 * Priority order:
 *  1. If the envelope carries `wifi_trust_hash` and it matches home_wifi_set → home.
 *  2. If the envelope carries `wifi_trust_hash` but it does NOT match and the
 *     home set is non-empty → untrusted (we know this is not a home SSID).
 *  3. Fallback to the categorical label from the envelope:
 *       home      → home
 *       known     → unknown (acquaintance network, treat as neutral)
 *       public    → untrusted
 *       unknown   → untrusted
 *       offline   → untrusted (defensive — likely roaming on mobile hotspot)
 *  4. No label and no hash → unknown.
 */
function deriveWifiTrust(env: SignalEnvelope, ctx: PolicyContext): WifiTrust {
  const { wifi_trust_hash, wifi_trust } = env.signals;

  if (wifi_trust_hash && ctx.home_wifi_set.has(wifi_trust_hash)) {
    return "home";
  }
  if (wifi_trust_hash && ctx.home_wifi_set.size > 0) {
    return "untrusted";
  }

  switch (wifi_trust) {
    case "home":
      // Agent self-labelled but we have no hash to verify. Before calibration
      // this is the only signal we have, so trust it.
      return "home";
    case "known":
      return "unknown";
    case "public":
    case "unknown":
    case "offline":
      return "untrusted";
    default:
      return "unknown";
  }
}

/** Map raw signal charging_state ("ac" | "battery") to the feature enum. */
function deriveChargingState(env: SignalEnvelope): ChargingState {
  return env.signals.charging_state === "ac" ? "charging" : "battery";
}

function deriveLidState(env: SignalEnvelope): LidState {
  return env.signals.lid_state === "closed" ? "closed" : "open";
}

/**
 * Map app_category. Nulls fall back to "idle" when input_idle_flag is true
 * (suspend/sleep transitions emit null) and to "unknown" otherwise.
 */
function deriveAppCategory(env: SignalEnvelope): AppCategory {
  const raw = env.signals.app_category;
  if (raw === "productivity" || raw === "browser" || raw === "media" || raw === "idle") {
    return raw;
  }
  if (raw === "unknown") {
    return "unknown";
  }
  // raw === null: agent couldn't classify. Use input_idle_flag to disambiguate.
  return env.signals.input_idle_flag ? "idle" : "unknown";
}

function iso2(code: string | null | undefined): string | null {
  if (!code) return null;
  return code.trim().toUpperCase();
}

/** Case-insensitive ISO-3166 alpha-2 equality against the policy's home country. */
function deriveHomeCountryMatch(env: SignalEnvelope, ctx: PolicyContext): boolean {
  const ip = iso2(env.ip_country);
  const home = iso2(ctx.home_country);
  return ip !== null && home !== null && ip === home;
}

/**
 * Derive hours since policy.started_at, clamped to >=0. Fractional hours
 * preserved so the rulebook can apply honeymoon logic at sub-day resolution.
 */
function derivePolicyAgeHours(ctx: PolicyContext, asOf: Date): number {
  const started = Date.parse(ctx.started_at);
  if (!Number.isFinite(started)) return 0;
  const ms = asOf.getTime() - started;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / MS_PER_HOUR;
}

/**
 * Top-level extractor. Pure; any non-determinism (wall clock) is threaded
 * through `asOf` so tests are deterministic.
 */
export function extractFeatures(
  envelope: SignalEnvelope,
  ctx: PolicyContext,
  asOf: Date = new Date(),
): FeatureVector {
  return {
    wifi_trust: deriveWifiTrust(envelope, ctx),
    charging_state: deriveChargingState(envelope),
    lid_state: deriveLidState(envelope),
    app_category: deriveAppCategory(envelope),
    input_idle_flag: envelope.signals.input_idle_flag === true,
    ip_country: iso2(envelope.ip_country),
    battery_health_pct: envelope.signals.battery_health_pct ?? null,
    policy_age_hours: derivePolicyAgeHours(ctx, asOf),
    home_country_match: deriveHomeCountryMatch(envelope, ctx),
    calibration_done: ctx.calibration_done === true,
    prior_multiplier: ctx.prior_multiplier ?? null,
  };
}
