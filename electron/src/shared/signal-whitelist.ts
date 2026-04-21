/**
 * Signal whitelist - single source of truth for the 7 signals Blink collects.
 *
 * This file is the canonical allow-list. The ingest API (Agent A) MUST reject
 * any envelope containing fields outside this set with HTTP 400. Duplicated
 * here and on the server so neither end trusts the other.
 *
 * Rev 7 (2026-04-21): motion_magnitude dropped. Accelerometer support on
 * laptops is under 25 percent and all cross-platform APIs are dead. See
 * design doc Module 1 for full rationale.
 */

export const SIGNAL_WHITELIST = [
  'wifi_trust',
  'charging_state',
  'lid_state',
  'app_category',
  'input_idle_flag',
  'ip_country',
  'battery_health_pct',
] as const;

export type SignalKey = (typeof SIGNAL_WHITELIST)[number];

/**
 * ip_country is resolved server-side from the POST source IP via MaxMind.
 * The client never sends it, but the server writes it into the persisted
 * envelope. Keep it in the whitelist so the enriched envelope round-trips.
 */
export const CLIENT_SIGNAL_KEYS: ReadonlyArray<SignalKey> = [
  'wifi_trust',
  'charging_state',
  'lid_state',
  'app_category',
  'input_idle_flag',
  'battery_health_pct',
];

/**
 * Envelope top-level fields. Anything outside these + `signals` gets rejected.
 */
export const ENVELOPE_TOP_LEVEL_KEYS = [
  'schema_version',
  'policy_id',
  'client_ts',
  'client_nonce',
  'trigger',
  'event_signal',
  'signals',
] as const;

export type EnvelopeTopLevelKey = (typeof ENVELOPE_TOP_LEVEL_KEYS)[number];

/**
 * Runtime validator - returns null on success, a human-readable reason on failure.
 * Called by envelope.ts before sign + enqueue, and by the ingest route on receive.
 */
export function validateEnvelopeShape(envelope: unknown): string | null {
  if (envelope === null || typeof envelope !== 'object') {
    return 'envelope must be an object';
  }
  const obj = envelope as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!(ENVELOPE_TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      return `unexpected top-level field: ${key}`;
    }
  }

  if (typeof obj.signals !== 'object' || obj.signals === null) {
    return 'envelope.signals must be an object';
  }
  const signals = obj.signals as Record<string, unknown>;
  for (const key of Object.keys(signals)) {
    if (!(SIGNAL_WHITELIST as readonly string[]).includes(key)) {
      return `unexpected signal: ${key}`;
    }
  }

  return null;
}
