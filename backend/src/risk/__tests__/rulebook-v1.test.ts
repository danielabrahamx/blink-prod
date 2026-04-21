import { describe, it, expect } from "vitest";
import {
  APP_CATEGORY_FACTOR,
  CALIBRATING_CAP,
  CHARGING_STATE_FACTOR,
  INPUT_IDLE_FACTOR,
  JURISDICTION_FACTOR,
  LID_STATE_FACTOR,
  MODEL_VERSION,
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  RATE_OF_CHANGE_MAX_DELTA,
  WIFI_TRUST_FACTOR,
  batteryHealthFactor,
  classifyJurisdiction,
  rulebookV1,
} from "../rulebook-v1";
import type {
  AppCategory,
  FeatureVector,
  LidState,
  WifiTrust,
} from "../types";

/** Baseline FV: every factor at the neutral-ish value so the product is 1.0. */
function baseFv(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    wifi_trust: "unknown",
    charging_state: "battery",
    lid_state: "open",
    app_category: "browser",
    input_idle_flag: false,
    ip_country: "US",
    battery_health_pct: 95,
    policy_age_hours: 48,
    home_country_match: true,
    calibration_done: true,
    prior_multiplier: null,
    ...overrides,
  };
}

describe("rulebookV1 factor tables", () => {
  describe("wifi_trust", () => {
    const cases: Array<[WifiTrust, number]> = [
      ["home", 0.8],
      ["unknown", 1.0],
      ["untrusted", 1.8],
    ];
    it.each(cases)("wifi_trust=%s yields factor %s", (trust, expected) => {
      expect(WIFI_TRUST_FACTOR[trust]).toBe(expected);
      const scored = rulebookV1(baseFv({ wifi_trust: trust }));
      const f = scored.explanation.factors.find((x) => x.name === "wifi_trust");
      expect(f?.value).toBe(expected);
    });
  });

  describe("charging_state", () => {
    it("charging → 0.85", () => {
      expect(CHARGING_STATE_FACTOR.charging).toBe(0.85);
      const s = rulebookV1(baseFv({ charging_state: "charging" }));
      expect(
        s.explanation.factors.find((x) => x.name === "charging_state")?.value,
      ).toBe(0.85);
    });
    it("battery → 1.0", () => {
      expect(CHARGING_STATE_FACTOR.battery).toBe(1.0);
      const s = rulebookV1(baseFv({ charging_state: "battery" }));
      expect(
        s.explanation.factors.find((x) => x.name === "charging_state")?.value,
      ).toBe(1.0);
    });
  });

  describe("lid_state", () => {
    const cases: Array<[LidState, number]> = [
      ["open", 1.0],
      ["closed", 0.7],
    ];
    it.each(cases)("lid=%s → %s", (lid, expected) => {
      expect(LID_STATE_FACTOR[lid]).toBe(expected);
      const s = rulebookV1(baseFv({ lid_state: lid }));
      expect(s.explanation.factors.find((x) => x.name === "lid_state")?.value).toBe(
        expected,
      );
    });
  });

  describe("app_category", () => {
    const cases: Array<[AppCategory, number]> = [
      ["productivity", 0.9],
      ["browser", 1.0],
      ["media", 1.1],
      ["idle", 0.7],
      ["unknown", 1.0],
    ];
    it.each(cases)("app=%s → %s", (cat, expected) => {
      expect(APP_CATEGORY_FACTOR[cat]).toBe(expected);
      const s = rulebookV1(baseFv({ app_category: cat }));
      expect(
        s.explanation.factors.find((x) => x.name === "app_category")?.value,
      ).toBe(expected);
    });
  });

  describe("input_idle_flag", () => {
    it("true → 0.7", () => {
      expect(INPUT_IDLE_FACTOR.true).toBe(0.7);
      const s = rulebookV1(baseFv({ input_idle_flag: true }));
      expect(
        s.explanation.factors.find((x) => x.name === "input_idle_flag")?.value,
      ).toBe(0.7);
    });
    it("false → 1.0", () => {
      expect(INPUT_IDLE_FACTOR.false).toBe(1.0);
      const s = rulebookV1(baseFv({ input_idle_flag: false }));
      expect(
        s.explanation.factors.find((x) => x.name === "input_idle_flag")?.value,
      ).toBe(1.0);
    });
  });

  describe("ip_country / jurisdiction", () => {
    it("home_match bucket → 1.0", () => {
      const s = rulebookV1(
        baseFv({ ip_country: "US", home_country_match: true }),
      );
      expect(s.explanation.factors.find((x) => x.name === "ip_country")?.value).toBe(
        1.0,
      );
    });
    it("within_jurisdiction bucket → 1.15", () => {
      expect(JURISDICTION_FACTOR.within_jurisdiction).toBe(1.15);
      const s = rulebookV1(
        baseFv({ ip_country: "CA", home_country_match: false }),
        { within_jurisdiction: new Set(["CA", "MX"]) },
      );
      expect(s.explanation.factors.find((x) => x.name === "ip_country")?.value).toBe(
        1.15,
      );
    });
    it("international bucket → 1.5", () => {
      expect(JURISDICTION_FACTOR.international).toBe(1.5);
      const s = rulebookV1(
        baseFv({ ip_country: "FR", home_country_match: false }),
      );
      expect(s.explanation.factors.find((x) => x.name === "ip_country")?.value).toBe(
        1.5,
      );
    });
    it("ip_country null with no match → international bucket", () => {
      expect(classifyJurisdiction(null, false)).toBe("international");
    });
    it("ip_country null but home_match → home_match (trust the flag)", () => {
      expect(classifyJurisdiction(null, true)).toBe("home_match");
    });
  });

  describe("battery_health_pct buckets", () => {
    const cases: Array<[number | null, number]> = [
      [100, 1.0],
      [80, 1.0],
      [79, 1.1],
      [60, 1.1],
      [59, 1.25],
      [40, 1.25],
      [39, 1.5],
      [0, 1.5],
      [null, 1.0],
    ];
    it.each(cases)("battery=%s → %s", (pct, expected) => {
      const { value } = batteryHealthFactor(pct);
      expect(value).toBe(expected);
    });
    it("NaN battery → neutral 1.0", () => {
      expect(batteryHealthFactor(Number.NaN).value).toBe(1.0);
    });
  });
});

describe("rulebookV1 factor-product composition", () => {
  it("all-neutral FV produces multiplier 1.0", () => {
    const s = rulebookV1(baseFv());
    expect(s.multiplier).toBe(1.0);
    expect(s.explanation.total_before_clamp).toBe(1.0);
    expect(s.explanation.factors).toHaveLength(7);
  });

  it("all-best-case FV hits the MULTIPLIER_MIN floor", () => {
    const fv = baseFv({
      wifi_trust: "home",
      charging_state: "charging",
      lid_state: "closed",
      app_category: "idle",
      input_idle_flag: true,
      battery_health_pct: 100,
    });
    const s = rulebookV1(fv);
    // 0.8*0.85*0.7*0.7*0.7*1.0*1.0 = 0.23324
    expect(s.explanation.total_before_clamp).toBeCloseTo(0.23324, 4);
    expect(s.multiplier).toBe(MULTIPLIER_MIN);
    expect(s.explanation.gate_reason).toContain("floor");
  });

  it("all-worst-case FV hits the MULTIPLIER_MAX ceiling", () => {
    const fv = baseFv({
      wifi_trust: "untrusted",
      app_category: "media",
      ip_country: "FR",
      home_country_match: false,
      battery_health_pct: 20,
    });
    const s = rulebookV1(fv);
    // 1.8*1.0*1.0*1.1*1.0*1.5*1.5 = 4.455
    expect(s.explanation.total_before_clamp).toBeCloseTo(4.455, 3);
    expect(s.multiplier).toBe(MULTIPLIER_MAX);
    expect(s.explanation.gate_reason).toContain("ceiling");
  });

  it("model_version is rulebook_v1.0.0", () => {
    const s = rulebookV1(baseFv());
    expect(s.model_version).toBe(MODEL_VERSION);
    expect(s.model_version).toBe("rulebook_v1.0.0");
  });

  it("every factor is listed in the explanation", () => {
    const s = rulebookV1(baseFv());
    const names = s.explanation.factors.map((f) => f.name).sort();
    expect(names).toEqual(
      [
        "app_category",
        "battery_health_pct",
        "charging_state",
        "input_idle_flag",
        "ip_country",
        "lid_state",
        "wifi_trust",
      ],
    );
  });
});

describe("rulebookV1 clamp boundaries", () => {
  it("below-floor raw product is clamped to MULTIPLIER_MIN", () => {
    const fv = baseFv({
      wifi_trust: "home",
      charging_state: "charging",
      lid_state: "closed",
    });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBe(MULTIPLIER_MIN);
  });
  it("above-ceiling raw product is clamped to MULTIPLIER_MAX", () => {
    const fv = baseFv({
      wifi_trust: "untrusted",
      battery_health_pct: 30,
      ip_country: "FR",
      home_country_match: false,
    });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBe(MULTIPLIER_MAX);
    expect(s.explanation.gate_reason).toMatch(/ceiling/);
  });
});

describe("rulebookV1 calibrating hard-cap", () => {
  it("calibration_done=false caps at 1.0x even if raw > 1.0", () => {
    const fv = baseFv({ wifi_trust: "untrusted", calibration_done: false });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBe(CALIBRATING_CAP);
    expect(s.explanation.gate_reason).toMatch(/calibration incomplete/);
  });
  it("calibration_done=false does NOT raise multipliers below 1.0", () => {
    const fv = baseFv({
      wifi_trust: "home",
      charging_state: "charging",
      lid_state: "closed",
      calibration_done: false,
    });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBeLessThanOrEqual(CALIBRATING_CAP);
  });
  it("calibration_done=true allows multipliers > 1.0x", () => {
    const fv = baseFv({ wifi_trust: "untrusted", calibration_done: true });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBeGreaterThan(1.0);
  });
});

describe("rulebookV1 rate-of-change clamp", () => {
  it("no prior_multiplier → no clamp", () => {
    const fv = baseFv({ wifi_trust: "untrusted", prior_multiplier: null });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBeCloseTo(1.8, 5);
  });
  it("prior=1.0, raw=1.8 → clamped to prior*(1+delta)", () => {
    const fv = baseFv({ wifi_trust: "untrusted", prior_multiplier: 1.0 });
    const s = rulebookV1(fv);
    const expected = 1.0 * (1 + RATE_OF_CHANGE_MAX_DELTA);
    expect(s.multiplier).toBeCloseTo(expected, 5);
    expect(s.explanation.gate_reason).toMatch(/rate-of-change/);
  });
  it("prior=2.0, raw=1.0 → clamped to prior*(1-delta)", () => {
    const fv = baseFv({ prior_multiplier: 2.0 });
    const s = rulebookV1(fv);
    const expected = 2.0 * (1 - RATE_OF_CHANGE_MAX_DELTA);
    expect(s.multiplier).toBeCloseTo(expected, 5);
    expect(s.explanation.gate_reason).toMatch(/rate-of-change/);
  });
  it("raw within prior ± delta → no clamp", () => {
    const fv = baseFv({ prior_multiplier: 1.0 });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBe(1.0);
    expect(s.explanation.gate_reason).toBeUndefined();
  });
  it("prior <= 0 is ignored (no clamp)", () => {
    const fv = baseFv({ wifi_trust: "untrusted", prior_multiplier: 0 });
    const s = rulebookV1(fv);
    expect(s.multiplier).toBeCloseTo(1.8, 5);
  });
});

describe("rulebookV1 explanation detail", () => {
  it("factor reasons include percentage sign", () => {
    const s = rulebookV1(baseFv({ wifi_trust: "home" }));
    const f = s.explanation.factors.find((x) => x.name === "wifi_trust");
    expect(f?.reason).toContain("-20%");
  });
  it("factor with +increase renders with + prefix", () => {
    const s = rulebookV1(baseFv({ battery_health_pct: 35 }));
    const f = s.explanation.factors.find((x) => x.name === "battery_health_pct");
    expect(f?.reason).toContain("+50%");
  });
  it("neutral factor renders as 'neutral'", () => {
    const s = rulebookV1(baseFv({ wifi_trust: "unknown" }));
    const f = s.explanation.factors.find((x) => x.name === "wifi_trust");
    expect(f?.reason).toContain("neutral");
  });
});
