/**
 * Risk engine shared types.
 *
 * FeatureVector is the stable contract between the feature extractor and the
 * scoring model. Fields are intentionally categorical (not derived scalars):
 * the actuarial team wants to see raw signals in the audit log so they can
 * re-derive features under new extractors. Scalar derivations belong inside
 * the model, not the feature contract.
 *
 * Schema MUST not change without bumping feature_version.
 *
 * See docs/DECISIONS.md entry 2026-04-21 for the reconciliation with the
 * design doc's original scalar schema.
 */

/**
 * Wifi trust level, as resolved by the extractor against the policy's
 * home_wifi_set (set of hashed SSIDs captured during calibration).
 *
 *  - `home`      current SSID hash matches an entry in home_wifi_set
 *  - `unknown`   policy has no calibrated home set yet, or agent did not
 *                report a hash; treated as neutral (not home, not hostile)
 *  - `untrusted` SSID is outside the home set AND the envelope declared a
 *                non-home category (public / unknown / offline)
 */
export type WifiTrust = "home" | "unknown" | "untrusted";

export type ChargingState = "charging" | "battery";
export type LidState = "open" | "closed";
export type AppCategory = "productivity" | "browser" | "media" | "idle" | "unknown";

/**
 * Jurisdiction classification relative to the policy's home country.
 * Tiered factor: home match is neutral, within-jurisdiction is a small
 * surcharge, international is a larger surcharge.
 */
export type JurisdictionBucket = "home_match" | "within_jurisdiction" | "international";

/**
 * The stable contract. Every field is either a discrete enum value or a
 * bounded number.
 */
export interface FeatureVector {
  wifi_trust: WifiTrust;
  charging_state: ChargingState;
  lid_state: LidState;
  app_category: AppCategory;
  /** True iff the OS reported no keyboard/mouse input in the sampling window. */
  input_idle_flag: boolean;
  /** ISO-3166-1 alpha-2, server-derived from source IP (MaxMind). */
  ip_country: string | null;
  /** Battery health percent; null when the OS driver can't report it. */
  battery_health_pct: number | null;
  /** Hours since policy.started_at. Non-negative, real-valued. */
  policy_age_hours: number;
  /** True iff ip_country === policy.home_country (case-insensitive ISO match). */
  home_country_match: boolean;
  /** True once the 48h calibration window has completed and the home_wifi_set is frozen. */
  calibration_done: boolean;
  /**
   * The most recent multiplier emitted for this policy, used by the
   * rate-of-change clamp. Null on first envelope of the policy.
   */
  prior_multiplier: number | null;
}

/**
 * Per-factor contribution to the final multiplier. Every factor the model
 * evaluated MUST be listed here (even with value = 1.0) so audit consumers
 * can see the full decomposition.
 */
export interface ExplanationFactor {
  /** Machine-readable factor name, e.g. "wifi_trust". */
  name: string;
  /** The multiplicative contribution, e.g. 0.85 or 1.25. */
  value: number;
  /** Human-readable sentence fragment for UI + CSV export. */
  reason: string;
}

export interface Explanation {
  factors: ExplanationFactor[];
  /** Product of factors, BEFORE the [0.5, 3.0] clamp and any hard-cap gate. */
  total_before_clamp: number;
  /** Final multiplier AFTER clamp + rate-of-change + calibrating hard-cap. */
  total_after_clamp: number;
  /** Populated when a hard gate overrode the raw factor product. */
  gate_reason?: string;
}

/**
 * Model identifier. Major bumps signal contract changes; the extractor's
 * feature_version is tracked separately in the audit log.
 */
export type ModelVersion = string;

export interface ScoredMultiplier {
  /** Final, already clamped + gated. Always in [0, 3.0]. */
  multiplier: number;
  model_version: ModelVersion;
  explanation: Explanation;
}

/**
 * Raw signal envelope fields the extractor consumes. Mirrors Module 1
 * schema. `ip_country` is attached server-side from the request source IP.
 */
export interface SignalEnvelope {
  schema_version: string;
  policy_id: string;
  client_ts: string;
  client_nonce: string;
  trigger: "scheduled" | "event" | "resume-from-offline";
  event_signal: string | null;
  signals: {
    /** Hashed SSID; extractor compares against home_wifi_set. */
    wifi_trust_hash?: string;
    /** Raw agent-reported categorical. Kept for legacy / fallback. */
    wifi_trust: "home" | "known" | "public" | "unknown" | "offline";
    charging_state: "ac" | "battery";
    lid_state: "open" | "closed";
    app_category: "productivity" | "browser" | "media" | "unknown" | "idle" | null;
    input_idle_flag: boolean;
    battery_health_pct: number | null;
  };
  /** Added server-side from request IP. */
  ip_country: string | null;
}

/**
 * Policy context required to derive features from a signal envelope.
 * Populated by the caller from the policies row.
 */
export interface PolicyContext {
  policy_id: string;
  /** Hashed SSIDs captured during calibration. */
  home_wifi_set: ReadonlySet<string>;
  /** ISO-3166-1 alpha-2 country code the user declared at onboarding. */
  home_country: string;
  /**
   * Optional list of neighbouring / treaty countries treated as
   * "within_jurisdiction". Defaults per-policy from onboarding.
   */
  within_jurisdiction?: ReadonlySet<string>;
  /** ISO timestamp the policy was first funded + activated. */
  started_at: string;
  /** True once the 48h calibration window has completed. */
  calibration_done: boolean;
  /** FSM state at time of scoring. Used by score() for hard-cap gates. */
  state: string;
  /** Most recent multiplier emitted for this policy. Null on first envelope. */
  prior_multiplier: number | null;
}
