import { describe, it, expect, vi } from "vitest";
import {
  InMemoryAuditRepo,
  writeAudit,
  writeAuditScore,
  type PgLikeClient,
} from "../audit";
import { FEATURE_VERSION } from "../feature-vector";
import { rulebookV1 } from "../rulebook-v1";
import type { FeatureVector } from "../types";

const FV: FeatureVector = {
  wifi_trust: "home",
  charging_state: "charging",
  lid_state: "open",
  app_category: "productivity",
  input_idle_flag: false,
  ip_country: "US",
  battery_health_pct: 90,
  policy_age_hours: 72,
  home_country_match: true,
  calibration_done: true,
  prior_multiplier: null,
};

describe("writeAudit — pg-backed", () => {
  it("inserts a row with the expected 9 bindings and persists row fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const db: PgLikeClient = { query };

    const scored = rulebookV1(FV);
    const fixedNow = new Date("2026-04-21T12:00:00.000Z");

    const row = await writeAudit(
      db,
      "pol_42",
      "env_99",
      FEATURE_VERSION,
      FV,
      scored,
      { now: () => fixedNow },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO audit_score/i);
    expect(Array.isArray(values)).toBe(true);
    expect((values as readonly unknown[]).length).toBe(9);

    // Positional bindings
    const [id, policyId, envId, featVer, featuresJson, modelVer, mult, explJson, computedAt] =
      values as readonly [string, string, string, string, string, string, number, string, string];
    expect(id).toBe(row.id);
    expect(policyId).toBe("pol_42");
    expect(envId).toBe("env_99");
    expect(featVer).toBe(FEATURE_VERSION);
    expect(JSON.parse(featuresJson)).toEqual(FV);
    expect(modelVer).toBe(scored.model_version);
    expect(mult).toBe(scored.multiplier);
    expect(JSON.parse(explJson)).toEqual(scored.explanation);
    expect(computedAt).toBe(fixedNow.toISOString());

    expect(row.policy_id).toBe("pol_42");
    expect(row.signal_envelope_id).toBe("env_99");
    expect(row.feature_version).toBe(FEATURE_VERSION);
  });

  it("falls back to FEATURE_VERSION if featureId is empty", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const db: PgLikeClient = { query };
    const scored = rulebookV1(FV);
    const row = await writeAudit(db, "pol_empty", "env_1", "", FV, scored);
    expect(row.feature_version).toBe(FEATURE_VERSION);
  });
});

describe("writeAuditScore + InMemoryAuditRepo", () => {
  it("persists the full row and lists within a half-open window", async () => {
    const repo = new InMemoryAuditRepo();
    const scored = rulebookV1(FV);

    for (const ts of [
      "2026-04-20T23:59:59.000Z",
      "2026-04-21T00:00:00.000Z",
      "2026-04-21T12:00:00.000Z",
      "2026-04-22T00:00:00.000Z", // exclusive upper bound → excluded
    ]) {
      await writeAuditScore(repo, {
        policy_id: "pol_w",
        signal_envelope_id: `env-${ts}`,
        features: FV,
        scored,
        computed_at: ts,
      });
    }

    const slice = await repo.listForPolicy(
      "pol_w",
      "2026-04-21T00:00:00.000Z",
      "2026-04-22T00:00:00.000Z",
    );
    expect(slice.length).toBe(2);
    expect(slice[0]!.computed_at).toBe("2026-04-21T00:00:00.000Z");
    expect(slice[1]!.computed_at).toBe("2026-04-21T12:00:00.000Z");
  });

  it("defaults feature_version to FEATURE_VERSION and stamps computed_at", async () => {
    const repo = new InMemoryAuditRepo();
    const scored = rulebookV1(FV);
    const row = await writeAuditScore(repo, {
      policy_id: "pol_d",
      signal_envelope_id: "env_d",
      features: FV,
      scored,
    });
    expect(row.feature_version).toBe(FEATURE_VERSION);
    expect(typeof row.computed_at).toBe("string");
    expect(() => new Date(row.computed_at).toISOString()).not.toThrow();
  });

  it("filters by policy_id", async () => {
    const repo = new InMemoryAuditRepo();
    const scored = rulebookV1(FV);
    await writeAuditScore(repo, {
      policy_id: "pol_a",
      signal_envelope_id: "e1",
      features: FV,
      scored,
      computed_at: "2026-04-21T12:00:00.000Z",
    });
    await writeAuditScore(repo, {
      policy_id: "pol_b",
      signal_envelope_id: "e2",
      features: FV,
      scored,
      computed_at: "2026-04-21T12:00:00.000Z",
    });
    const aRows = await repo.listForPolicy(
      "pol_a",
      "2026-04-20T00:00:00.000Z",
      "2026-04-22T00:00:00.000Z",
    );
    expect(aRows.length).toBe(1);
    expect(aRows[0]!.policy_id).toBe("pol_a");
  });
});
