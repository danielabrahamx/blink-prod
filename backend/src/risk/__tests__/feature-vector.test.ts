import { describe, it, expect } from "vitest";
import { extractFeatures, FEATURE_VERSION } from "../feature-vector";
import type { PolicyContext, SignalEnvelope } from "../types";

const BASE_TS = "2026-04-21T12:00:00.000Z";

function envelope(overrides: Partial<SignalEnvelope["signals"]> = {}, top: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    schema_version: "1.0",
    policy_id: "pol_fv",
    client_ts: BASE_TS,
    client_nonce: "nonce-1",
    trigger: "scheduled",
    event_signal: null,
    ip_country: "US",
    signals: {
      wifi_trust: "home",
      charging_state: "ac",
      lid_state: "open",
      app_category: "productivity",
      input_idle_flag: false,
      battery_health_pct: 95,
      ...overrides,
    },
    ...top,
  };
}

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    policy_id: "pol_fv",
    home_wifi_set: new Set(["hashA", "hashB"]),
    home_country: "US",
    started_at: "2026-04-19T12:00:00.000Z", // 48h before BASE_TS
    calibration_done: true,
    state: "active",
    prior_multiplier: null,
    ...overrides,
  };
}

describe("extractFeatures — pass-through signals", () => {
  it("maps charging_state=ac → charging", () => {
    const fv = extractFeatures(envelope({ charging_state: "ac" }), ctx(), new Date(BASE_TS));
    expect(fv.charging_state).toBe("charging");
  });
  it("maps charging_state=battery → battery", () => {
    const fv = extractFeatures(envelope({ charging_state: "battery" }), ctx(), new Date(BASE_TS));
    expect(fv.charging_state).toBe("battery");
  });
  it("preserves lid_state open / closed", () => {
    const open = extractFeatures(envelope({ lid_state: "open" }), ctx(), new Date(BASE_TS));
    const closed = extractFeatures(envelope({ lid_state: "closed" }), ctx(), new Date(BASE_TS));
    expect(open.lid_state).toBe("open");
    expect(closed.lid_state).toBe("closed");
  });
  it("preserves input_idle_flag boolean", () => {
    expect(
      extractFeatures(envelope({ input_idle_flag: true }), ctx(), new Date(BASE_TS))
        .input_idle_flag,
    ).toBe(true);
    expect(
      extractFeatures(envelope({ input_idle_flag: false }), ctx(), new Date(BASE_TS))
        .input_idle_flag,
    ).toBe(false);
  });
  it("preserves battery_health_pct", () => {
    expect(
      extractFeatures(envelope({ battery_health_pct: 67 }), ctx(), new Date(BASE_TS))
        .battery_health_pct,
    ).toBe(67);
    expect(
      extractFeatures(envelope({ battery_health_pct: null }), ctx(), new Date(BASE_TS))
        .battery_health_pct,
    ).toBe(null);
  });
});

describe("extractFeatures — wifi_trust resolution", () => {
  it("hash match against home_wifi_set → home", () => {
    const env = envelope({}, {});
    env.signals.wifi_trust_hash = "hashA";
    const fv = extractFeatures(env, ctx(), new Date(BASE_TS));
    expect(fv.wifi_trust).toBe("home");
  });
  it("hash miss with non-empty home set → untrusted", () => {
    const env = envelope({ wifi_trust: "home" }, {});
    env.signals.wifi_trust_hash = "hashZ"; // not in home set
    const fv = extractFeatures(env, ctx(), new Date(BASE_TS));
    expect(fv.wifi_trust).toBe("untrusted");
  });
  it("no hash + category=home → home (pre-calibration trust)", () => {
    const fv = extractFeatures(
      envelope({ wifi_trust: "home" }),
      ctx({ home_wifi_set: new Set() }),
      new Date(BASE_TS),
    );
    expect(fv.wifi_trust).toBe("home");
  });
  it("no hash + category=known → unknown", () => {
    const fv = extractFeatures(
      envelope({ wifi_trust: "known" }),
      ctx({ home_wifi_set: new Set() }),
      new Date(BASE_TS),
    );
    expect(fv.wifi_trust).toBe("unknown");
  });
  it("no hash + category=public → untrusted", () => {
    const fv = extractFeatures(
      envelope({ wifi_trust: "public" }),
      ctx({ home_wifi_set: new Set() }),
      new Date(BASE_TS),
    );
    expect(fv.wifi_trust).toBe("untrusted");
  });
  it("no hash + category=unknown → untrusted", () => {
    const fv = extractFeatures(
      envelope({ wifi_trust: "unknown" }),
      ctx({ home_wifi_set: new Set() }),
      new Date(BASE_TS),
    );
    expect(fv.wifi_trust).toBe("untrusted");
  });
  it("no hash + category=offline → untrusted", () => {
    const fv = extractFeatures(
      envelope({ wifi_trust: "offline" }),
      ctx({ home_wifi_set: new Set() }),
      new Date(BASE_TS),
    );
    expect(fv.wifi_trust).toBe("untrusted");
  });
});

describe("extractFeatures — app_category fallbacks", () => {
  it("null category + idle flag → idle", () => {
    const fv = extractFeatures(
      envelope({ app_category: null, input_idle_flag: true }),
      ctx(),
      new Date(BASE_TS),
    );
    expect(fv.app_category).toBe("idle");
  });
  it("null category + active → unknown", () => {
    const fv = extractFeatures(
      envelope({ app_category: null, input_idle_flag: false }),
      ctx(),
      new Date(BASE_TS),
    );
    expect(fv.app_category).toBe("unknown");
  });
  it("passes known categories through", () => {
    for (const cat of ["productivity", "browser", "media", "idle", "unknown"] as const) {
      const fv = extractFeatures(envelope({ app_category: cat }), ctx(), new Date(BASE_TS));
      expect(fv.app_category).toBe(cat);
    }
  });
});

describe("extractFeatures — home_country_match", () => {
  it("US/US → true", () => {
    const fv = extractFeatures(envelope({}, { ip_country: "US" }), ctx({ home_country: "US" }), new Date(BASE_TS));
    expect(fv.home_country_match).toBe(true);
  });
  it("case-insensitive us/US → true", () => {
    const fv = extractFeatures(envelope({}, { ip_country: "us" }), ctx({ home_country: "US" }), new Date(BASE_TS));
    expect(fv.home_country_match).toBe(true);
  });
  it("US/FR → false", () => {
    const fv = extractFeatures(envelope({}, { ip_country: "FR" }), ctx({ home_country: "US" }), new Date(BASE_TS));
    expect(fv.home_country_match).toBe(false);
  });
  it("ip_country=null → false", () => {
    const fv = extractFeatures(envelope({}, { ip_country: null }), ctx({ home_country: "US" }), new Date(BASE_TS));
    expect(fv.home_country_match).toBe(false);
  });
});

describe("extractFeatures — policy_age_hours", () => {
  it("48h apart → 48 hours", () => {
    const fv = extractFeatures(
      envelope(),
      ctx({ started_at: "2026-04-19T12:00:00.000Z" }),
      new Date(BASE_TS),
    );
    expect(fv.policy_age_hours).toBeCloseTo(48, 5);
  });
  it("1.5h apart → 1.5 hours (fractional)", () => {
    const fv = extractFeatures(
      envelope(),
      ctx({ started_at: "2026-04-21T10:30:00.000Z" }),
      new Date(BASE_TS),
    );
    expect(fv.policy_age_hours).toBeCloseTo(1.5, 5);
  });
  it("started_at in future → 0 (never negative)", () => {
    const fv = extractFeatures(
      envelope(),
      ctx({ started_at: "2026-05-01T00:00:00.000Z" }),
      new Date(BASE_TS),
    );
    expect(fv.policy_age_hours).toBe(0);
  });
  it("bad started_at → 0", () => {
    const fv = extractFeatures(
      envelope(),
      ctx({ started_at: "not-a-date" }),
      new Date(BASE_TS),
    );
    expect(fv.policy_age_hours).toBe(0);
  });
});

describe("extractFeatures — calibration_done + prior_multiplier threading", () => {
  it("passes calibration_done through", () => {
    expect(
      extractFeatures(envelope(), ctx({ calibration_done: true }), new Date(BASE_TS))
        .calibration_done,
    ).toBe(true);
    expect(
      extractFeatures(envelope(), ctx({ calibration_done: false }), new Date(BASE_TS))
        .calibration_done,
    ).toBe(false);
  });
  it("passes prior_multiplier through", () => {
    expect(
      extractFeatures(envelope(), ctx({ prior_multiplier: 1.2 }), new Date(BASE_TS))
        .prior_multiplier,
    ).toBe(1.2);
    expect(
      extractFeatures(envelope(), ctx({ prior_multiplier: null }), new Date(BASE_TS))
        .prior_multiplier,
    ).toBe(null);
  });
});

describe("extractFeatures — ip_country normalisation", () => {
  it("trims + uppercases", () => {
    const fv = extractFeatures(envelope({}, { ip_country: " us " }), ctx(), new Date(BASE_TS));
    expect(fv.ip_country).toBe("US");
  });
});

describe("FEATURE_VERSION", () => {
  it("exports a stable version string", () => {
    expect(FEATURE_VERSION).toBe("feat_v1.0.0");
  });
});
