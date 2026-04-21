/**
 * Table-driven FSM transitions.
 *
 * Every row encodes:
 *   from       — required starting state
 *   event      — the event name
 *   to         — resulting state
 *   guard?     — predicate (TransitionContext → boolean) that must pass
 *   sideEffect — named effect the caller applies (settlement, notifications,
 *                accrual pause/resume, revoke authorization, etc). Named, not
 *                bound, so tests can stub cleanly.
 *
 * Source of truth:
 *   - Design doc Module 0.5 (offline cap 4h/24h, calibration 48h, uninstall
 *     72h → terminated).
 *   - Agent E handoff transition table (activate, calibration_complete,
 *     offline_detected, online_restored, user_cancel/system_cancel, claim
 *     lifecycle).
 */

import {
  PolicyEvent,
  PolicyEvents,
  PolicyState,
  PolicyStates,
  TERMINAL_STATES,
} from "./states";

export type SideEffect =
  | "none"
  | "start_calibration_timer"
  | "activate_multiplier"
  | "pause_accrual"
  | "resume_accrual"
  | "force_multiplier_1x"
  | "revoke_authorization"
  | "settle_and_revoke_session"
  | "settle_residual_refund"
  | "enqueue_claim_review"
  | "issue_claim_payout"
  | "deny_claim"
  | "expire_policy";

export interface TransitionContext {
  /** Envelopes received since policy creation (guard for calibration_complete). */
  envelope_count: number;
  /** Hours elapsed in calibrating state (guard for calibration_complete). */
  hours_in_calibration: number;
  /** Continuous minutes without an envelope (guards offline / system cancel). */
  minutes_since_last_envelope: number;
  /** Milliseconds in paused_offline within the rolling 24h window. */
  offline_ms_last_24h: number;
  /** Has the claim cleared its waiting period? Guards claim_approve → terminated payout. */
  claim_waiting_cleared?: boolean;
  /** Optional injectable wall clock. */
  now?: () => Date;
}

export interface TransitionRow {
  from: PolicyState;
  event: PolicyEvent;
  to: PolicyState;
  /** If guard returns false, transition is rejected (event ignored). */
  guard?: (ctx: TransitionContext) => boolean;
  sideEffect: SideEffect;
  description: string;
}

// Design-doc guards. Thresholds match Module 0.5 + Module 1.
const CALIBRATION_MIN_HOURS = 48;
const CALIBRATION_MIN_ENVELOPES = 20;
const OFFLINE_DETECT_MINUTES = 4 * 60; // 4h silence → paused_offline
const OFFLINE_SYSTEM_CANCEL_MINUTES = 24 * 60; // 24h continuous → cancelled_by_system

const calibrationEligible = (ctx: TransitionContext): boolean =>
  ctx.hours_in_calibration >= CALIBRATION_MIN_HOURS &&
  ctx.envelope_count >= CALIBRATION_MIN_ENVELOPES;

const offlineDetected = (ctx: TransitionContext): boolean =>
  ctx.minutes_since_last_envelope >= OFFLINE_DETECT_MINUTES;

const continuousOfflineTwentyFourHours = (ctx: TransitionContext): boolean =>
  ctx.minutes_since_last_envelope >= OFFLINE_SYSTEM_CANCEL_MINUTES;

/**
 * The transition table. Grouped by source-state for readability.
 *
 * Note: some transitions are legal from multiple states (user_cancel fires
 * from every non-terminal state). We enumerate each row explicitly rather
 * than using a wildcard because the side-effect can differ per source state
 * (draft cancel has no settlement; active cancel revokes the x402 session).
 */
export const TRANSITIONS: ReadonlyArray<TransitionRow> = Object.freeze([
  // ── draft ────────────────────────────────────────────────────────────────
  {
    from: PolicyStates.Draft,
    event: PolicyEvents.Activate,
    to: PolicyStates.Calibrating,
    sideEffect: "start_calibration_timer",
    description:
      "Onboarding finishes with wallet funded + ToS accepted → enter 48h calibration",
  },
  {
    from: PolicyStates.Draft,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "none",
    description: "User abandons draft before funding — no on-chain state to settle",
  },

  // ── calibrating ──────────────────────────────────────────────────────────
  {
    from: PolicyStates.Calibrating,
    event: PolicyEvents.CalibrationComplete,
    to: PolicyStates.Active,
    guard: calibrationEligible,
    sideEffect: "activate_multiplier",
    description:
      "48h window elapsed AND >=20 envelopes received → rulebook multipliers apply",
  },
  {
    from: PolicyStates.Calibrating,
    event: PolicyEvents.UserPause,
    to: PolicyStates.PausedUser,
    sideEffect: "pause_accrual",
    description: "User pauses telemetry during calibration",
  },
  {
    from: PolicyStates.Calibrating,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "settle_and_revoke_session",
    description: "User cancels mid-calibration; final settlement at 1.0x cap",
  },
  {
    from: PolicyStates.Calibrating,
    event: PolicyEvents.OfflineDetected,
    to: PolicyStates.PausedOffline,
    guard: offlineDetected,
    sideEffect: "pause_accrual",
    description: "Envelope stream silent for 4h while calibrating",
  },
  {
    from: PolicyStates.Calibrating,
    event: PolicyEvents.Terminate,
    to: PolicyStates.Terminated,
    sideEffect: "settle_residual_refund",
    description: "Uninstall / 72h heartbeat gap during calibration → terminated + refund",
  },

  // ── active ───────────────────────────────────────────────────────────────
  {
    from: PolicyStates.Active,
    event: PolicyEvents.OfflineDetected,
    to: PolicyStates.PausedOffline,
    guard: offlineDetected,
    sideEffect: "pause_accrual",
    description: "4h silence detected → paused_offline (accrual immediately halts)",
  },
  {
    from: PolicyStates.Active,
    event: PolicyEvents.UserPause,
    to: PolicyStates.PausedUser,
    sideEffect: "pause_accrual",
    description: "User hits Pause telemetry in Settings (coverage + accrual suspended)",
  },
  {
    from: PolicyStates.Active,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "revoke_authorization",
    description: "User cancels; revoke x402 session authorization + final settlement",
  },
  {
    from: PolicyStates.Active,
    event: PolicyEvents.PolicyExpiryWindowEntered,
    to: PolicyStates.Expiring,
    sideEffect: "none",
    description: "Policy nearing scheduled end; surface renewal prompt",
  },
  {
    from: PolicyStates.Active,
    event: PolicyEvents.ClaimSubmit,
    to: PolicyStates.ClaimSubmitted,
    sideEffect: "enqueue_claim_review",
    description: "User files a claim — enters admin review queue",
  },
  {
    from: PolicyStates.Active,
    event: PolicyEvents.Terminate,
    to: PolicyStates.Terminated,
    sideEffect: "settle_residual_refund",
    description: "System terminate (uninstall 72h, expiry) → terminated + refund",
  },

  // ── paused_offline ───────────────────────────────────────────────────────
  {
    from: PolicyStates.PausedOffline,
    event: PolicyEvents.OnlineRestored,
    to: PolicyStates.Active,
    sideEffect: "resume_accrual",
    description: "Envelope arrives → accrual resumes",
  },
  {
    from: PolicyStates.PausedOffline,
    event: PolicyEvents.SystemCancel,
    to: PolicyStates.CancelledBySystem,
    guard: continuousOfflineTwentyFourHours,
    sideEffect: "revoke_authorization",
    description:
      "24h continuous offline → cancelled_by_system + refund remaining authorization",
  },
  {
    from: PolicyStates.PausedOffline,
    event: PolicyEvents.UserPause,
    to: PolicyStates.PausedUser,
    sideEffect: "pause_accrual",
    description: "User explicitly pauses while offline",
  },
  {
    from: PolicyStates.PausedOffline,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "revoke_authorization",
    description: "User cancels while offline — revoke authorization",
  },
  {
    from: PolicyStates.PausedOffline,
    event: PolicyEvents.Terminate,
    to: PolicyStates.Terminated,
    sideEffect: "settle_residual_refund",
    description: "Offline + additional terminal trigger (expiry) → terminated",
  },

  // ── paused_user ──────────────────────────────────────────────────────────
  {
    from: PolicyStates.PausedUser,
    event: PolicyEvents.UserResume,
    to: PolicyStates.Active,
    sideEffect: "resume_accrual",
    description: "User resumes telemetry",
  },
  {
    from: PolicyStates.PausedUser,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "revoke_authorization",
    description: "User cancels while paused",
  },
  {
    from: PolicyStates.PausedUser,
    event: PolicyEvents.Terminate,
    to: PolicyStates.Terminated,
    sideEffect: "settle_residual_refund",
    description: "User paused + uninstall 72h → terminated",
  },

  // ── expiring ─────────────────────────────────────────────────────────────
  {
    from: PolicyStates.Expiring,
    event: PolicyEvents.Terminate,
    to: PolicyStates.Terminated,
    sideEffect: "expire_policy",
    description: "Grace ended → terminate",
  },
  {
    from: PolicyStates.Expiring,
    event: PolicyEvents.UserCancel,
    to: PolicyStates.CancelledByUser,
    sideEffect: "revoke_authorization",
    description: "User cancels inside expiry grace window",
  },
  {
    from: PolicyStates.Expiring,
    event: PolicyEvents.OfflineDetected,
    to: PolicyStates.PausedOffline,
    guard: offlineDetected,
    sideEffect: "pause_accrual",
    description: "Offline during expiry grace window",
  },
  {
    from: PolicyStates.Expiring,
    event: PolicyEvents.ClaimSubmit,
    to: PolicyStates.ClaimSubmitted,
    sideEffect: "enqueue_claim_review",
    description: "Claim filed during expiry grace",
  },

  // ── claim lifecycle ──────────────────────────────────────────────────────
  {
    from: PolicyStates.ClaimSubmitted,
    event: PolicyEvents.ClaimApprove,
    to: PolicyStates.ClaimApproved,
    sideEffect: "none",
    description: "Admin approves claim. Payout pending.",
  },
  {
    from: PolicyStates.ClaimSubmitted,
    event: PolicyEvents.ClaimDeny,
    to: PolicyStates.ClaimDenied,
    sideEffect: "deny_claim",
    description: "Admin denies claim",
  },
  {
    from: PolicyStates.ClaimApproved,
    event: PolicyEvents.PayoutComplete,
    to: PolicyStates.Terminated,
    guard: (ctx) => ctx.claim_waiting_cleared === true,
    sideEffect: "issue_claim_payout",
    description: "Payout finalised on-chain → policy terminates",
  },
  // ClaimDenied is NOT terminal: underlying policy can continue via a resume
  // event (caller drives back to Active by firing OnlineRestored or
  // UserResume depending on prior state). No direct transitions away from
  // here to avoid re-opening dispute through the FSM.
]);

/** Index by (from, event) for O(1) lookup. */
const INDEX: Map<string, TransitionRow> = new Map();
for (const row of TRANSITIONS) {
  const key = `${row.from}::${row.event}`;
  if (INDEX.has(key)) {
    throw new Error(`fsm: duplicate transition row for ${key}`);
  }
  INDEX.set(key, row);
}

export function isTerminal(state: PolicyState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Look up the transition row that would fire for (state, event). Returns
 * null if no row matches. Callers should treat null as "illegal transition"
 * and raise (fsm.ts throws on illegal).
 */
export function findTransition(
  state: PolicyState,
  event: PolicyEvent,
): TransitionRow | null {
  return INDEX.get(`${state}::${event}`) ?? null;
}

export {
  CALIBRATION_MIN_HOURS,
  CALIBRATION_MIN_ENVELOPES,
  OFFLINE_DETECT_MINUTES,
  OFFLINE_SYSTEM_CANCEL_MINUTES,
};
