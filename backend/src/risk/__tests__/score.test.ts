import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL_VERSION, score } from "../score";
import type { FeatureVector } from "../types";

const FV: FeatureVector = {
  wifi_trust: "unknown",
  charging_state: "battery",
  lid_state: "open",
  app_category: "browser",
  input_idle_flag: false,
  ip_country: "US",
  battery_health_pct: 90,
  policy_age_hours: 24,
  home_country_match: true,
  calibration_done: true,
  prior_multiplier: null,
};

describe("score — dispatch", () => {
  it("defaults to rulebook_v1.0.0 when no model_version given", () => {
    const s = score(FV);
    expect(s.model_version).toBe(DEFAULT_MODEL_VERSION);
    expect(s.model_version).toBe("rulebook_v1.0.0");
  });

  it("explicit rulebook_v1.0.0 dispatches", () => {
    const s = score(FV, { model_version: "rulebook_v1.0.0" });
    expect(s.model_version).toBe("rulebook_v1.0.0");
    expect(s.multiplier).toBeGreaterThanOrEqual(0.5);
    expect(s.multiplier).toBeLessThanOrEqual(3.0);
  });

  it("throws on unknown model_version", () => {
    expect(() => score(FV, { model_version: "glm_v9.99.0" })).toThrow(
      /unknown model_version/,
    );
  });

  it("forwards within_jurisdiction to the scorer", () => {
    const fv: FeatureVector = { ...FV, ip_country: "CA", home_country_match: false };
    const withinSet = score(fv, { within_jurisdiction: new Set(["CA"]) });
    const international = score(fv);
    expect(withinSet.multiplier).toBeLessThan(international.multiplier);
  });

  it("produces a full explanation", () => {
    const s = score(FV);
    expect(s.explanation.factors.length).toBeGreaterThan(0);
    expect(typeof s.explanation.total_before_clamp).toBe("number");
    expect(typeof s.explanation.total_after_clamp).toBe("number");
  });
});
