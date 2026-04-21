import { describe, it, expect, beforeEach } from "vitest";
import {
  FsmTransitionError,
  InMemoryPolicyRepo,
  InMemoryStateLog,
  RecordingSideEffects,
  transition,
  type TransitionDeps,
} from "../fsm";
import { PolicyEvents, PolicyStates } from "../states";

function mkDeps(seedState: string, policy_id = "pol_1"): {
  deps: TransitionDeps;
  repo: InMemoryPolicyRepo;
  log: InMemoryStateLog;
  fx: RecordingSideEffects;
} {
  const repo = new InMemoryPolicyRepo();
  repo.seed(policy_id, seedState as never);
  const log = new InMemoryStateLog();
  const fx = new RecordingSideEffects();
  return {
    deps: { policyRepo: repo, stateLog: log, sideEffects: fx },
    repo,
    log,
    fx,
  };
}

describe("fsm.transition — legal transitions (table-driven)", () => {
  const cases: Array<{
    label: string;
    from: string;
    event: string;
    to: string;
    meta?: Record<string, unknown>;
    side_effect: string;
  }> = [
    {
      label: "draft -> calibrating (activate)",
      from: PolicyStates.Draft,
      event: PolicyEvents.Activate,
      to: PolicyStates.Calibrating,
      side_effect: "start_calibration_timer",
    },
    {
      label: "calibrating -> active (calibration_complete)",
      from: PolicyStates.Calibrating,
      event: PolicyEvents.CalibrationComplete,
      to: PolicyStates.Active,
      meta: { hours_in_calibration: 48, envelope_count: 20 },
      side_effect: "activate_multiplier",
    },
    {
      label: "active -> paused_offline (offline_detected 4h)",
      from: PolicyStates.Active,
      event: PolicyEvents.OfflineDetected,
      to: PolicyStates.PausedOffline,
      meta: { minutes_since_last_envelope: 4 * 60 },
      side_effect: "pause_accrual",
    },
    {
      label: "paused_offline -> active (online_restored)",
      from: PolicyStates.PausedOffline,
      event: PolicyEvents.OnlineRestored,
      to: PolicyStates.Active,
      side_effect: "resume_accrual",
    },
    {
      label: "paused_offline -> cancelled_by_system (system_cancel 24h)",
      from: PolicyStates.PausedOffline,
      event: PolicyEvents.SystemCancel,
      to: PolicyStates.CancelledBySystem,
      meta: { minutes_since_last_envelope: 24 * 60 },
      side_effect: "revoke_authorization",
    },
    {
      label: "active -> cancelled_by_user (user_cancel)",
      from: PolicyStates.Active,
      event: PolicyEvents.UserCancel,
      to: PolicyStates.CancelledByUser,
      side_effect: "revoke_authorization",
    },
    {
      label: "paused_user -> active (user_resume)",
      from: PolicyStates.PausedUser,
      event: PolicyEvents.UserResume,
      to: PolicyStates.Active,
      side_effect: "resume_accrual",
    },
    {
      label: "active -> claim_submitted (claim_submit)",
      from: PolicyStates.Active,
      event: PolicyEvents.ClaimSubmit,
      to: PolicyStates.ClaimSubmitted,
      side_effect: "enqueue_claim_review",
    },
    {
      label: "claim_submitted -> claim_approved (claim_approve)",
      from: PolicyStates.ClaimSubmitted,
      event: PolicyEvents.ClaimApprove,
      to: PolicyStates.ClaimApproved,
      side_effect: "none",
    },
    {
      label: "claim_submitted -> claim_denied (claim_deny)",
      from: PolicyStates.ClaimSubmitted,
      event: PolicyEvents.ClaimDeny,
      to: PolicyStates.ClaimDenied,
      side_effect: "deny_claim",
    },
    {
      label: "claim_approved -> terminated (payout_complete)",
      from: PolicyStates.ClaimApproved,
      event: PolicyEvents.PayoutComplete,
      to: PolicyStates.Terminated,
      meta: { claim_waiting_cleared: true },
      side_effect: "issue_claim_payout",
    },
  ];

  it.each(cases)(
    "$label",
    async ({ from, event, to, meta, side_effect }) => {
      const { deps, repo, log, fx } = mkDeps(from);
      const next = await transition(deps, "pol_1", event as never, meta ?? {});
      expect(next).toBe(to);
      expect((await repo.getCurrentState("pol_1"))!.state).toBe(to);
      const rows = await log.listForPolicy("pol_1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.side_effect).toBe(side_effect);
      expect(fx.calls).toHaveLength(1);
      expect(fx.calls[0]!.effect).toBe(side_effect);
    },
  );
});

describe("fsm.transition — illegal transitions throw", () => {
  const bad: Array<{ from: string; event: string; reason: string }> = [
    { from: PolicyStates.Draft, event: PolicyEvents.CalibrationComplete, reason: "no_matching_transition" },
    { from: PolicyStates.Active, event: PolicyEvents.Activate, reason: "no_matching_transition" },
    { from: PolicyStates.ClaimApproved, event: PolicyEvents.UserCancel, reason: "no_matching_transition" },
  ];
  it.each(bad)("$from --$event--> throws $reason", async ({ from, event, reason }) => {
    const { deps } = mkDeps(from);
    await expect(transition(deps, "pol_1", event as never, {})).rejects.toMatchObject({
      name: "FsmTransitionError",
      reason,
    });
  });

  it("missing policy throws policy_not_found", async () => {
    const { deps } = mkDeps(PolicyStates.Active, "pol_1");
    await expect(
      transition(deps, "pol_does_not_exist", PolicyEvents.UserPause, {}),
    ).rejects.toBeInstanceOf(FsmTransitionError);
  });

  it("terminal state throws already_terminal", async () => {
    const { deps } = mkDeps(PolicyStates.Terminated);
    await expect(
      transition(deps, "pol_1", PolicyEvents.UserPause, {}),
    ).rejects.toMatchObject({ reason: "already_terminal" });
  });

  it("failed guard throws guard_rejected", async () => {
    const { deps } = mkDeps(PolicyStates.Calibrating);
    await expect(
      transition(deps, "pol_1", PolicyEvents.CalibrationComplete, {
        hours_in_calibration: 10,
        envelope_count: 20,
      }),
    ).rejects.toMatchObject({ reason: "guard_rejected" });
  });
});

describe("fsm.transition — idempotency", () => {
  let fixture: ReturnType<typeof mkDeps>;
  beforeEach(() => {
    fixture = mkDeps(PolicyStates.Active);
  });

  it("re-run with the same idempotency_key does not duplicate log or side effects", async () => {
    const key = "idem-key-42";
    const first = await transition(fixture.deps, "pol_1", PolicyEvents.UserPause, {
      idempotency_key: key,
    });
    const second = await transition(fixture.deps, "pol_1", PolicyEvents.UserPause, {
      idempotency_key: key,
    });

    expect(first).toBe(PolicyStates.PausedUser);
    expect(second).toBe(PolicyStates.PausedUser);
    expect(fixture.log.snapshot()).toHaveLength(1);
    expect(fixture.fx.calls).toHaveLength(1);
  });

  it("different idempotency_keys are not deduped", async () => {
    await transition(fixture.deps, "pol_1", PolicyEvents.UserPause, {
      idempotency_key: "k1",
    });
    // Now in paused_user. Resume with a new key.
    const next = await transition(fixture.deps, "pol_1", PolicyEvents.UserResume, {
      idempotency_key: "k2",
    });
    expect(next).toBe(PolicyStates.Active);
    expect(fixture.log.snapshot()).toHaveLength(2);
  });

  it("no idempotency_key → no dedup check", async () => {
    await transition(fixture.deps, "pol_1", PolicyEvents.UserPause, {});
    // Replaying user_pause on paused_user is illegal → throws.
    await expect(
      transition(fixture.deps, "pol_1", PolicyEvents.UserPause, {}),
    ).rejects.toBeInstanceOf(FsmTransitionError);
  });
});

describe("fsm.transition — side effect metadata", () => {
  it("metadata is sanitised before persist (no functions leak)", async () => {
    const { deps, log } = mkDeps(PolicyStates.Active);
    await transition(deps, "pol_1", PolicyEvents.UserPause, {
      minutes_since_last_envelope: 10,
      now: () => new Date("2026-04-21T12:00:00Z"),
      note: "user clicked pause",
    } as never);
    const rows = log.snapshot();
    expect(rows[0]!.metadata_json).toMatchObject({
      minutes_since_last_envelope: 10,
      note: "user clicked pause",
    });
    expect("now" in rows[0]!.metadata_json).toBe(false);
  });

  it("injectable now() clock is used for occurred_at", async () => {
    const fixed = new Date("2026-04-21T00:00:00.000Z");
    const { deps, log } = mkDeps(PolicyStates.Active);
    deps.now = () => fixed;
    await transition(deps, "pol_1", PolicyEvents.UserPause, {});
    expect(log.snapshot()[0]!.occurred_at).toBe(fixed.toISOString());
  });
});
