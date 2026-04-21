import type { FeatureVector, SignalEnvelope, Policy } from '../types/index.js';

/**
 * Feature extractor (version "extractor_v1.0.0").
 *
 * Turns the raw SignalEnvelope + server-side ip_country + policy record
 * into a stable FeatureVector. The schema is fixed; the body can evolve.
 *
 * Design doc Module 2: the FeatureVector shape is the contract; downstream
 * model versions bind to it.
 */

export const EXTRACTOR_VERSION = 'extractor_v1.0.0';

export interface ExtractorInput {
  envelope: SignalEnvelope;
  ip_country: string | null;
  policy: Pick<Policy, 'policy_id' | 'home_country' | 'created_at'>;
}

export function wifiTrustScore(trust: SignalEnvelope['signals']['wifi_trust']): number {
  switch (trust) {
    case 'home':
      return 1.0;
    case 'known':
      return 0.8;
    case 'public':
      return 0.2;
    case 'unknown':
      return 0.1;
    case 'offline':
      return 0.0;
  }
}

export function atDeskConfidence(env: SignalEnvelope): number {
  const { charging_state, lid_state, input_idle_flag } = env.signals;
  let c = 0;
  if (lid_state === 'open') c += 0.5;
  if (charging_state === 'ac') c += 0.3;
  if (!input_idle_flag) c += 0.2;
  return Math.min(1, Math.max(0, c));
}

export function deviceAgeRisk(
  batteryHealthPct: number | null,
): number {
  if (batteryHealthPct === null) return 0.3;
  // Higher health -> lower risk. 100% health => 0.0, 50% => 0.5, 0% => 1.0
  const clamped = Math.min(100, Math.max(0, batteryHealthPct));
  return (100 - clamped) / 100;
}

export function activitySignal(
  env: SignalEnvelope,
): FeatureVector['activity_signal'] {
  const { input_idle_flag, lid_state } = env.signals;
  if (lid_state === 'closed') return 'sleep';
  if (input_idle_flag) return 'idle';
  return 'active';
}

export function timeOfDayFromCountry(
  nowUtc: Date,
  ipCountry: string | null,
): number {
  // We use UTC hour as the canonical value and let the risk engine
  // interpret jurisdiction-specific nightness. A full TZ-by-country table
  // is out of scope for v1; UTC is deterministic and auditable.
  // ipCountry is intentionally unused in v1 — retained for future
  // per-country timezone offsets. Touching it here silences "no-unused"
  // lints in environments that enable them.
  void ipCountry;
  return nowUtc.getUTCHours();
}

export function policyAgeDays(policyCreatedAt: string, now: Date): number {
  const created = Date.parse(policyCreatedAt);
  if (Number.isNaN(created)) return 0;
  const diffMs = now.getTime() - created;
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

export function extractFeatures(input: ExtractorInput): FeatureVector {
  const now = new Date();
  return {
    wifi_trust_score: wifiTrustScore(input.envelope.signals.wifi_trust),
    at_desk_confidence: atDeskConfidence(input.envelope),
    jurisdiction_match:
      input.ip_country !== null &&
      input.ip_country.toUpperCase() === input.policy.home_country.toUpperCase(),
    device_age_risk: deviceAgeRisk(input.envelope.signals.battery_health_pct),
    time_of_day: timeOfDayFromCountry(now, input.ip_country),
    activity_signal: activitySignal(input.envelope),
    policy_age_days: policyAgeDays(input.policy.created_at, now),
  };
}
