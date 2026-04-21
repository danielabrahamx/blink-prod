import { describe, it, expect } from "vitest";
import { PolicyEvents, PolicyStates, TERMINAL_STATES } from "../states";
import {
  TRANSITIONS,
  findTransition,
  isTerminal,
  type TransitionContext,
} from "../transitions";

function emptyCtx(partial: Partial<TransitionContext> = {}): TransitionContext {
  return {
    envelope_count: 0,
    hours_in_calibration: 0,
    minutes_since_last_envelope: 0,
    offline_ms_last_24h: 0,
    ...partial,
  };
}

describe("transition table integrity", () => {
  it("has no duplicate (from, event) keys", () => {
    const keys = new Set<string>();
    for (const row of TRANSITIONS) {
      const k = `${row.from}::${row.event}`;
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
  });

  it("every row resolves via findTransition", () => {
    for (const row of TRANSITIONS) {
      const found = findTransition(row.from, row.event);
      expect(found).toBe(row);
    }
  });

  it("isTerminal flags only terminal states", () => {
    expect(isTerminal(PolicyStates.Terminated)).toBe(true);
    expect(isTerminal(PolicyStates.CancelledByUser)).toBe(true);
    expect(isTerminal(PolicyStates.CancelledBySystem)).toBe(true);
    expect(isTerminal(PolicyStates.Active)).toBe(false);
    expect(isTerminal(PolicyStates.ClaimSubmitted)).toBe(false);
  });
});

describe("every legal transition is represented (handoff contract)", () => {
  // Each row asserts: from, event, to (and guard context when applicable).
  const spec: Array<{
    label: string;
    from: string;
    event: string;
    to: string;
    ctx?: Partial<TransitionContext>;
  }> = [
    {
      label: "draft --activate--> calibrating",
      from: PolicyStates.Draft,
      event: PolicyEvents.Activate,
      to: PolicyStates.Calibrating,
    },
    {
      label: "draft --user_cancel--> cancelled_by_user",
      from: PolicyStates.Draft,
      event: PolicyEvents.UserCancel,
      to: PolicyStates.CancelledByUser,
    },
    {
      label: "calibrating --calibration_complete--> active (48h + 20 envelopes)",
      from: PolicyStates.Calibrating,
      event: PolicyEvents.CalibrationComplete,
      to: PolicyStates.Active,
      ctx: { hours_in_calibration: 48, envelope_count: 20 },
    },
    {
      label: "calibrating --user_pause--> paused_user",
      from: PolicyStates.Calibrating,
      event: PolicyEvents.UserPause,
      to: PolicyStates.PausedUser,
    },
    {
      label: "calibrating --user_cancel--> cancelled_by_user",
      from: PolicyStates.Calibrating,
      event: PolicyEvents.UserCancel,
      to: PolicyStates.CancelledByUser,
    },
    {
      label: "active --offline_detected--> paused_offline",
      from: PolicyStates.Active,
      event: PolicyEvents.OfflineDetected,
      to: PolicyStates.PausedOffline,
      ctx: { minutes_since_last_envelope: 4 * 60 },
    },
    {
      label: "active --user_pause--> paused_user",
      from: PolicyStates.Active,
      event: PolicyEvents.UserPause,
      to: PolicyStates.PausedUser,
    },
    {
      label: "active --user_cancel--> cancelled_by_user",
      from: PolicyStates.Active,
      event: PolicyEvents.UserCancel,
      to: PolicyStates.CancelledByUser,
    },
    {
      label: "active --claim_submit--> claim_submitted",
      from: PolicyStates.Active,
      event: PolicyEvents.ClaimSubmit,
      to: PolicyStates.ClaimSubmitted,
    },
    {
      label: "paused_offline --online_restored--> active",
      from: PolicyStates.PausedOffline,
      event: PolicyEvents.OnlineRestored,
      to: PolicyStates.Active,
    },
    {
      label: "paused_offline --system_cancel (24h silent)--> cancelled_by_system",
      from: PolicyStates.PausedOffline,
      event: PolicyEvents.SystemCancel,
      to: PolicyStates.CancelledBySystem,
      ctx: { minutes_since_last_envelope: 24 * 60 },
    },
    {
      label: "paused_user --user_resume--> active",
      from: PolicyStates.PausedUser,
      event: PolicyEvents.UserResume,
      to: PolicyStates.Active,
    },
    {
      label: "paused_user --user_cancel--> cancelled_by_user",
      from: PolicyStates.PausedUser,
      event: PolicyEvents.UserCancel,
      to: PolicyStates.CancelledByUser,
    },
    {
      label: "claim_submitted --claim_approve--> claim_approved",
      from: PolicyStates.ClaimSubmitted,
      event: PolicyEvents.ClaimApprove,
      to: PolicyStates.ClaimApproved,
    },
    {
      label: "claim_submitted --claim_deny--> claim_denied",
      from: PolicyStates.ClaimSubmitted,
      event: PolicyEvents.ClaimDeny,
      to: PolicyStates.ClaimDenied,
    },
    {
      label: "claim_approved --payout_complete--> terminated (waiting cleared)",
      from: PolicyStates.ClaimApproved,
      event: PolicyEvents.PayoutComplete,
      to: PolicyStates.Terminated,
      ctx: { claim_waiting_cleared: true },
    },
  ];

  it.each(spec)("$label", ({ from, event, to, ctx }) => {
    const row = findTransition(from as never, event as never);
    expect(row, `missing transition ${from} -- ${event} --> ${to}`).not.toBeNull();
    expect(row!.to).toBe(to);
    if (row!.guard) {
      const pass = row!.guard(emptyCtx(ctx));
      expect(pass).toBe(true);
    }
  });
});

describe("guard rejections", () => {
  it("calibration_complete rejects when hours < 48", () => {
    const row = findTransition(PolicyStates.Calibrating, PolicyEvents.CalibrationComplete);
    expect(row).not.toBeNull();
    expect(row!.guard!(emptyCtx({ hours_in_calibration: 47, envelope_count: 20 }))).toBe(false);
  });
  it("calibration_complete rejects when envelope_count < 20", () => {
    const row = findTransition(PolicyStates.Calibrating, PolicyEvents.CalibrationComplete);
    expect(row!.guard!(emptyCtx({ hours_in_calibration: 48, envelope_count: 19 }))).toBe(false);
  });
  it("offline_detected rejects when minutes < 240", () => {
    const row = findTransition(PolicyStates.Active, PolicyEvents.OfflineDetected);
    expect(row!.guard!(emptyCtx({ minutes_since_last_envelope: 239 }))).toBe(false);
  });
  it("system_cancel rejects when minutes < 24*60", () => {
    const row = findTransition(PolicyStates.PausedOffline, PolicyEvents.SystemCancel);
    expect(row!.guard!(emptyCtx({ minutes_since_last_envelope: 24 * 60 - 1 }))).toBe(false);
  });
  it("payout_complete rejects when waiting not cleared", () => {
    const row = findTransition(PolicyStates.ClaimApproved, PolicyEvents.PayoutComplete);
    expect(row!.guard!(emptyCtx({ claim_waiting_cleared: false }))).toBe(false);
  });
});

describe("illegal transitions (handoff: every illegal transition throws at runtime)", () => {
  const illegal: Array<[string, string]> = [
    // draft
    [PolicyStates.Draft, PolicyEvents.UserPause],
    [PolicyStates.Draft, PolicyEvents.CalibrationComplete],
    [PolicyStates.Draft, PolicyEvents.OnlineRestored],
    // active
    [PolicyStates.Active, PolicyEvents.Activate],
    [PolicyStates.Active, PolicyEvents.CalibrationComplete],
    [PolicyStates.Active, PolicyEvents.UserResume],
    [PolicyStates.Active, PolicyEvents.OnlineRestored],
    [PolicyStates.Active, PolicyEvents.PayoutComplete],
    // claim flow
    [PolicyStates.ClaimSubmitted, PolicyEvents.UserPause],
    [PolicyStates.ClaimApproved, PolicyEvents.UserCancel],
    [PolicyStates.ClaimDenied, PolicyEvents.PayoutComplete],
    // paused
    [PolicyStates.PausedUser, PolicyEvents.OnlineRestored],
    [PolicyStates.PausedOffline, PolicyEvents.UserResume],
  ];
  it.each(illegal)("findTransition returns null for %s --%s-->", (from, event) => {
    expect(findTransition(from as never, event as never)).toBeNull();
  });
});

describe("TERMINAL_STATES", () => {
  it("contains exactly the handoff terminal states", () => {
    expect(TERMINAL_STATES.size).toBe(3);
    expect(TERMINAL_STATES.has(PolicyStates.Terminated)).toBe(true);
    expect(TERMINAL_STATES.has(PolicyStates.CancelledByUser)).toBe(true);
    expect(TERMINAL_STATES.has(PolicyStates.CancelledBySystem)).toBe(true);
  });
});
