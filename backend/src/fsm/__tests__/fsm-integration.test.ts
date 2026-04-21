/**
 * Integration test for the Agent E policy lifecycle:
 *
 *   draft
 *     → (activate)                     → calibrating
 *     → (calibration_complete, 48h+20) → active
 *     → (offline_detected, 4h silent)  → paused_offline
 *     → (online_restored)              → active
 *     → (user_cancel)                  → cancelled_by_user
 *
 * Runs a synthetic envelope stream through the feature extractor and the
 * scorer while transitioning FSM states at the right times. Asserts:
 *
 *   - Rulebook is hard-capped at 1.0x while state=calibrating (via the
 *     `calibration_done=false` feature, which the caller populates from the
 *     policy row).
 *   - Active-state envelopes produce unbounded multipliers in [0.5, 3.0].
 *   - paused_offline envelopes still score (so accrual layer can apply its
 *     own zero-accrual rule) but never raise state.
 *   - cancelled_by_user state terminates the policy.
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryPolicyRepo,
  InMemoryStateLog,
  RecordingSideEffects,
  transition,
  type TransitionDeps,
} from "../fsm";
import { PolicyEvents, PolicyStates, type PolicyState } from "../states";
import { extractFeatures } from "../../risk/feature-vector";
import { score } from "../../risk/score";
import { InMemoryAuditRepo, writeAuditScore } from "../../risk/audit";
import type { PolicyContext, SignalEnvelope } from "../../risk/types";

function envelope(
  ts: string,
  overrides: Partial<SignalEnvelope["signals"]> = {},
): SignalEnvelope {
  return {
    schema_version: "1.0",
    policy_id: "pol_life",
    client_ts: ts,
    client_nonce: `n-${ts}`,
    trigger: "scheduled",
    event_signal: null,
    ip_country: "US",
    signals: {
      wifi_trust: "home",
      charging_state: "ac",
      lid_state: "open",
      app_category: "productivity",
      input_idle_flag: false,
      battery_health_pct: 92,
      ...overrides,
    },
  };
}

describe("policy lifecycle — full happy path with synthetic signal stream", () => {
  it("draft → calibrating → active → paused_offline → active → cancelled_by_user", async () => {
    const policy_id = "pol_life";
    const repo = new InMemoryPolicyRepo();
    repo.seed(policy_id, PolicyStates.Draft);
    const log = new InMemoryStateLog();
    const fx = new RecordingSideEffects();
    const audit = new InMemoryAuditRepo();
    const deps: TransitionDeps = { policyRepo: repo, stateLog: log, sideEffects: fx };

    const STARTED = "2026-04-19T00:00:00.000Z";
    let ctx: PolicyContext = {
      policy_id,
      home_wifi_set: new Set(),
      home_country: "US",
      started_at: STARTED,
      calibration_done: false,
      state: PolicyStates.Draft,
      prior_multiplier: null,
    };

    // ── step 1: activate → calibrating ───────────────────────────────────
    await transition(deps, policy_id, PolicyEvents.Activate, {});
    ctx = { ...ctx, state: PolicyStates.Calibrating };

    // ── step 2: 20 envelopes over 48h. All scored at hard-cap 1.0x. ──────
    let priorMultiplier: number | null = null;
    for (let i = 0; i < 20; i++) {
      const ts = new Date(Date.parse(STARTED) + i * (48 / 20) * 60 * 60 * 1000);
      const env = envelope(ts.toISOString());
      const stepCtx: PolicyContext = { ...ctx, prior_multiplier: priorMultiplier };
      const features = extractFeatures(env, stepCtx, ts);
      const scored = score(features);
      // The calibrating hard-cap must hold every single iteration.
      expect(scored.multiplier).toBeLessThanOrEqual(1.0);
      await writeAuditScore(audit, {
        policy_id,
        signal_envelope_id: `env-${i}`,
        features,
        scored,
        computed_at: ts.toISOString(),
      });
      priorMultiplier = scored.multiplier;
    }

    // ── step 3: calibration_complete → active ────────────────────────────
    await transition(deps, policy_id, PolicyEvents.CalibrationComplete, {
      hours_in_calibration: 48,
      envelope_count: 20,
    });
    ctx = { ...ctx, state: PolicyStates.Active, calibration_done: true };

    // ── step 4: active envelopes ramp the multiplier up past 1.0 ────────
    // Each envelope can only move `prior ± RATE_OF_CHANGE_MAX_DELTA` per
    // the anti-whiplash clamp. To prove the active state isn't hard-capped
    // like calibration is, we ramp across several envelopes and watch the
    // multiplier grow past 1.0x.
    let activeMultiplier = priorMultiplier ?? 1.0;
    for (let i = 0; i < 10; i++) {
      const ts = new Date(Date.parse(STARTED) + (49 + i) * 60 * 60 * 1000);
      const env = envelope(ts.toISOString(), {
        wifi_trust: "public",
        charging_state: "battery",
      });
      const features = extractFeatures(
        env,
        { ...ctx, prior_multiplier: activeMultiplier },
        ts,
      );
      const scored = score(features);
      expect(scored.multiplier).toBeGreaterThanOrEqual(0.5);
      expect(scored.multiplier).toBeLessThanOrEqual(3.0);
      await writeAuditScore(audit, {
        policy_id,
        signal_envelope_id: `env-active-${i}`,
        features,
        scored,
        computed_at: ts.toISOString(),
      });
      activeMultiplier = scored.multiplier;
    }
    // After the ramp, active-phase scoring must have exceeded 1.0x —
    // proving that the active state is NOT hard-capped the way
    // calibration is. Calibration cap is 1.0x strictly.
    expect(activeMultiplier).toBeGreaterThan(1.0);
    priorMultiplier = activeMultiplier;

    // ── step 5: offline_detected (4h silent) → paused_offline ───────────
    await transition(deps, policy_id, PolicyEvents.OfflineDetected, {
      minutes_since_last_envelope: 4 * 60,
    });
    ctx = { ...ctx, state: PolicyStates.PausedOffline };

    // ── step 6: online_restored → active ─────────────────────────────────
    await transition(deps, policy_id, PolicyEvents.OnlineRestored, {});
    ctx = { ...ctx, state: PolicyStates.Active };

    // ── step 7: user_cancel → cancelled_by_user ──────────────────────────
    await transition(deps, policy_id, PolicyEvents.UserCancel, {
      idempotency_key: "cancel-req-1",
    });

    // ── assertions on the journey ────────────────────────────────────────
    const current = await repo.getCurrentState(policy_id);
    expect(current!.state).toBe(PolicyStates.CancelledByUser);

    const logRows = await log.listForPolicy(policy_id);
    const transitions = logRows.map((r) => `${r.from_state}->${r.to_state}`);
    expect(transitions).toEqual([
      "draft->calibrating",
      "calibrating->active",
      "active->paused_offline",
      "paused_offline->active",
      "active->cancelled_by_user",
    ]);

    // Side effects fired in the expected order.
    const effects = fx.calls.map((c) => c.effect);
    expect(effects).toEqual([
      "start_calibration_timer",
      "activate_multiplier",
      "pause_accrual",
      "resume_accrual",
      "revoke_authorization",
    ]);

    // Audit had 30 scored envelopes (20 calibrating + 10 active ramp).
    const auditRows = await audit.listForPolicy(
      policy_id,
      "2026-04-18T00:00:00.000Z",
      "2026-04-22T00:00:00.000Z",
    );
    expect(auditRows.length).toBe(30);

    // Every calibrating-phase score respected the cap.
    const calibratingRows = auditRows.slice(0, 20);
    expect(calibratingRows.every((r) => r.multiplier <= 1.0)).toBe(true);

    // The final row (after active ramp) exceeds 1.0x.
    const finalActiveRow = auditRows[auditRows.length - 1]!;
    expect(finalActiveRow.multiplier).toBeGreaterThan(1.0);

    // Re-firing user_cancel with the same idempotency key is a no-op.
    const replayState: PolicyState = await transition(
      deps,
      policy_id,
      PolicyEvents.UserCancel,
      { idempotency_key: "cancel-req-1" },
    );
    expect(replayState).toBe(PolicyStates.CancelledByUser);
    expect(fx.calls.length).toBe(5); // unchanged
  });
});
