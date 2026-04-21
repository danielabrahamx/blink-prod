/**
 * Shared guard predicates.
 *
 * These accept the whole policy record (not just a TransitionContext) so
 * callers that already loaded the row don't have to re-fetch. The table in
 * transitions.ts wraps these behind TransitionContext so the transition
 * layer stays schema-agnostic.
 */

import {
  CALIBRATION_MIN_ENVELOPES,
  CALIBRATION_MIN_HOURS,
  OFFLINE_DETECT_MINUTES,
  OFFLINE_SYSTEM_CANCEL_MINUTES,
} from "./transitions";

export interface PolicySnapshot {
  /** ISO timestamp the policy was created (draft → calibrating entry). */
  started_at: string;
  /** ISO timestamp of the last envelope received, or null if none. */
  last_envelope_at: string | null;
  /** Cumulative count of envelopes ingested since policy creation. */
  envelope_count: number;
  /**
   * ISO expiry of the x402 session authorization. null when no session is
   * active (draft, cancelled, terminated).
   */
  authorization_expires_at: string | null;
}

/**
 * Defensive semantics per predicate:
 *   - `hoursSinceStart`: missing/bad ISO → `-Infinity` (policy hasn't
 *     started, so time elapsed cannot satisfy a "≥N hours" eligibility
 *     check). Prevents accidental calibration completion on malformed rows.
 *   - `minutesSinceEnvelope`: missing/bad ISO → `+Infinity` (we've never
 *     heard from the agent, which is offline-by-default for threshold
 *     checks). Matches the intent of heartbeat-absence guards.
 */
function hoursSinceStart(iso: string | null, now: Date): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.NEGATIVE_INFINITY;
  return (now.getTime() - t) / (60 * 60 * 1000);
}

function minutesSinceEnvelope(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / (60 * 1000);
}

/**
 * Calibration is eligible to complete once BOTH:
 *   - at least CALIBRATION_MIN_HOURS have elapsed since started_at
 *   - at least CALIBRATION_MIN_ENVELOPES have been received
 */
export function calibrationEligible(
  policy: Pick<PolicySnapshot, "started_at" | "envelope_count">,
  now: Date = new Date(),
): boolean {
  const hours = hoursSinceStart(policy.started_at, now);
  return (
    hours >= CALIBRATION_MIN_HOURS &&
    policy.envelope_count >= CALIBRATION_MIN_ENVELOPES
  );
}

/**
 * True once the policy has been silent for the offline-detection threshold
 * (4h). Used to enter paused_offline.
 */
export function offlineThresholdReached(
  policy: Pick<PolicySnapshot, "last_envelope_at">,
  now: Date = new Date(),
): boolean {
  const mins = minutesSinceEnvelope(policy.last_envelope_at, now);
  return mins >= OFFLINE_DETECT_MINUTES;
}

/**
 * True once the policy has been silent for 24h continuous — the
 * system-cancel threshold.
 */
export function continuousOfflineForSystemCancel(
  policy: Pick<PolicySnapshot, "last_envelope_at">,
  now: Date = new Date(),
): boolean {
  const mins = minutesSinceEnvelope(policy.last_envelope_at, now);
  return mins >= OFFLINE_SYSTEM_CANCEL_MINUTES;
}

/**
 * Is the x402 session authorization still valid? Returns false when:
 *   - authorization_expires_at is null (no active session)
 *   - the expiry is in the past
 */
export function authorizationValid(
  policy: Pick<PolicySnapshot, "authorization_expires_at">,
  now: Date = new Date(),
): boolean {
  const expiry = policy.authorization_expires_at;
  if (!expiry) return false;
  const t = Date.parse(expiry);
  if (!Number.isFinite(t)) return false;
  return t > now.getTime();
}
