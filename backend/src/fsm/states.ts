/**
 * Policy FSM states and events.
 *
 * Reconciles two sources:
 *   - Design doc Module 0.5 (states: draft, calibrating, active, paused_offline,
 *     paused_user, expiring, terminated, cancelled_by_user, claimed +
 *     `claim_waiting_period` flag).
 *   - Agent E handoff (expanded claim sub-states + cancelled_by_system).
 *
 * The handoff wins where the two diverge. See docs/DECISIONS.md 2026-04-21.
 *
 * `claim_waiting_period` remains an orthogonal FLAG on the policy row (per
 * the doc's "flag" annotation), not a first-class state.
 */

export const PolicyStates = {
  Draft: "draft",
  Calibrating: "calibrating",
  Active: "active",
  PausedOffline: "paused_offline",
  PausedUser: "paused_user",
  Expiring: "expiring",
  // Terminal — user-initiated.
  CancelledByUser: "cancelled_by_user",
  // Terminal — system-initiated (heartbeat loss, offline cap breach, expiry).
  CancelledBySystem: "cancelled_by_system",
  Terminated: "terminated",
  // Claim lifecycle.
  ClaimSubmitted: "claim_submitted",
  ClaimApproved: "claim_approved",
  ClaimDenied: "claim_denied",
} as const;

export type PolicyState = (typeof PolicyStates)[keyof typeof PolicyStates];

/**
 * Terminal states — no outbound transitions allowed except reporting /
 * refund settlement. ClaimDenied is terminal with respect to the claim
 * lifecycle but the underlying policy may continue (caller decides to
 * transition back to Active or to Terminated).
 */
export const TERMINAL_STATES: ReadonlySet<PolicyState> = new Set([
  PolicyStates.CancelledByUser,
  PolicyStates.CancelledBySystem,
  PolicyStates.Terminated,
]);

/**
 * Inputs the FSM consumes. Names from the handoff; legacy aliases kept for
 * migration (see transitions.ts for the mapping table).
 */
export const PolicyEvents = {
  // Onboarding + calibration
  Activate: "activate", // draft → calibrating
  CalibrationComplete: "calibration_complete", // calibrating → active

  // User-initiated
  UserPause: "user_pause", // active → paused_user
  UserResume: "user_resume", // paused_user → active
  UserCancel: "user_cancel", // any non-terminal → cancelled_by_user

  // Network / heartbeat
  OfflineDetected: "offline_detected", // active → paused_offline (guard: 4h silence)
  OnlineRestored: "online_restored", // paused_offline → active (auto)
  SystemCancel: "system_cancel", // paused_offline → cancelled_by_system (24h continuous)

  // Claims
  ClaimSubmit: "claim_submit", // active → claim_submitted
  ClaimApprove: "claim_approve", // claim_submitted → claim_approved (admin-only)
  ClaimDeny: "claim_deny", // claim_submitted → claim_denied
  PayoutComplete: "payout_complete", // claim_approved → terminated

  // Policy lifecycle
  PolicyExpiryWindowEntered: "policy_expiry_window_entered",
  Terminate: "terminate", // any → terminated (expiry, uninstall, payout)
} as const;

export type PolicyEvent = (typeof PolicyEvents)[keyof typeof PolicyEvents];
