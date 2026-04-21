import { describe, it, expect } from "vitest";
import { InMemoryAuditRepo, writeAuditScore } from "../audit";
import { extractFeatures } from "../feature-vector";
import { score, MODEL_VERSION } from "../score";
import { replayPolicy, type EnvelopeRepo, type EnvelopeRow, type ReplayContextProvider } from "../replay";
import type { PolicyContext, SignalEnvelope } from "../types";

function makeEnvelope(ts: string, overrides: Partial<SignalEnvelope["signals"]> = {}): SignalEnvelope {
  return {
    schema_version: "1.0",
    policy_id: "pol_r",
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
      battery_health_pct: 90,
      ...overrides,
    },
  };
}

class FakeEnvelopeRepo implements EnvelopeRepo {
  constructor(private readonly rows: EnvelopeRow[]) {}
  async listForPolicy(policy_id: string, from: string, to: string): Promise<EnvelopeRow[]> {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    return this.rows
      .filter((r) => r.policy_id === policy_id)
      .filter((r) => {
        const ts = Date.parse(r.received_at);
        return ts >= fromMs && ts < toMs;
      })
      .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  }
}

class FixedContextProvider implements ReplayContextProvider {
  constructor(private readonly ctx: PolicyContext) {}
  async getContext(): Promise<PolicyContext> {
    return this.ctx;
  }
}

const ctx: PolicyContext = {
  policy_id: "pol_r",
  home_wifi_set: new Set(),
  home_country: "US",
  started_at: "2026-04-19T12:00:00.000Z",
  calibration_done: true,
  state: "active",
  prior_multiplier: null,
};

describe("replayPolicy", () => {
  it("replays each envelope through the scorer and computes the series", async () => {
    const envelopes: EnvelopeRow[] = [
      {
        id: "env1",
        policy_id: "pol_r",
        envelope: makeEnvelope("2026-04-21T12:00:00.000Z"),
        received_at: "2026-04-21T12:00:00.000Z",
      },
      {
        id: "env2",
        policy_id: "pol_r",
        envelope: makeEnvelope("2026-04-21T12:01:00.000Z", { wifi_trust: "public" }),
        received_at: "2026-04-21T12:01:00.000Z",
      },
    ];

    const audit = new InMemoryAuditRepo();

    // Persist "original" audit rows with deliberately stale multipliers so
    // the delta is non-zero.
    for (const env of envelopes) {
      const features = extractFeatures(env.envelope, ctx, new Date(env.received_at));
      const scored = score(features);
      await writeAuditScore(audit, {
        policy_id: env.policy_id,
        signal_envelope_id: env.id,
        features,
        scored: { ...scored, multiplier: 0.9 }, // pretend we charged 0.9x historically
        computed_at: env.received_at,
      });
    }

    const result = await replayPolicy(
      {
        policy_id: "pol_r",
        from: "2026-04-21T11:00:00.000Z",
        to: "2026-04-21T13:00:00.000Z",
        model_version: MODEL_VERSION,
      },
      {
        envelopes: new FakeEnvelopeRepo(envelopes),
        audit,
        ctxProvider: new FixedContextProvider(ctx),
      },
    );

    expect(result.series).toHaveLength(2);
    expect(result.series[0]!.charged_multiplier).toBe(0.9);
    expect(result.series[0]!.multiplier).toBeGreaterThan(0); // rulebook replayed
    expect(result.series[0]!.delta).toBe(
      result.series[0]!.multiplier - 0.9,
    );
    expect(result.accrued_original).toBeCloseTo(1.8, 5); // 0.9 + 0.9

    // Replay with a known rate per unit → USDC delta is sum(delta) * rate.
    const resultPriced = await replayPolicy(
      {
        policy_id: "pol_r",
        from: "2026-04-21T11:00:00.000Z",
        to: "2026-04-21T13:00:00.000Z",
      },
      {
        envelopes: new FakeEnvelopeRepo(envelopes),
        audit,
        ctxProvider: new FixedContextProvider(ctx),
      },
      { rate_per_unit_usdc: 2.0 },
    );

    const rawDeltaSum = resultPriced.series.reduce((acc, p) => acc + p.delta, 0);
    expect(resultPriced.total_delta_usdc).toBeCloseTo(rawDeltaSum * 2.0, 6);
  });

  it("returns zero original if no audit row exists for the envelope", async () => {
    const envelopes: EnvelopeRow[] = [
      {
        id: "env_orphan",
        policy_id: "pol_r",
        envelope: makeEnvelope("2026-04-21T12:00:00.000Z"),
        received_at: "2026-04-21T12:00:00.000Z",
      },
    ];
    const audit = new InMemoryAuditRepo();
    const result = await replayPolicy(
      {
        policy_id: "pol_r",
        from: "2026-04-21T11:00:00.000Z",
        to: "2026-04-21T13:00:00.000Z",
      },
      {
        envelopes: new FakeEnvelopeRepo(envelopes),
        audit,
        ctxProvider: new FixedContextProvider(ctx),
      },
    );
    expect(result.series[0]!.charged_multiplier).toBe(0);
    expect(result.series[0]!.delta).toBe(result.series[0]!.multiplier);
  });

  it("propagates model_version into the result", async () => {
    const envelopes: EnvelopeRow[] = [
      {
        id: "e1",
        policy_id: "pol_r",
        envelope: makeEnvelope("2026-04-21T12:00:00.000Z"),
        received_at: "2026-04-21T12:00:00.000Z",
      },
    ];
    const audit = new InMemoryAuditRepo();
    const result = await replayPolicy(
      {
        policy_id: "pol_r",
        from: "2026-04-21T11:00:00.000Z",
        to: "2026-04-21T13:00:00.000Z",
      },
      {
        envelopes: new FakeEnvelopeRepo(envelopes),
        audit,
        ctxProvider: new FixedContextProvider(ctx),
      },
    );
    expect(result.model_version).toBe(MODEL_VERSION);
  });

  it("empty envelope set → empty series and zero deltas", async () => {
    const audit = new InMemoryAuditRepo();
    const result = await replayPolicy(
      {
        policy_id: "pol_r",
        from: "2026-04-21T11:00:00.000Z",
        to: "2026-04-21T13:00:00.000Z",
      },
      {
        envelopes: new FakeEnvelopeRepo([]),
        audit,
        ctxProvider: new FixedContextProvider(ctx),
      },
    );
    expect(result.series).toEqual([]);
    expect(result.accrued_original).toBe(0);
    expect(result.accrued_replayed).toBe(0);
    expect(result.total_delta_usdc).toBe(0);
  });
});
