import { describe, it, expect } from "vitest";
import {
  authorizationValid,
  calibrationEligible,
  continuousOfflineForSystemCancel,
  offlineThresholdReached,
  type PolicySnapshot,
} from "../guards";

const NOW = new Date("2026-04-21T12:00:00.000Z");

function snapshot(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    started_at: "2026-04-19T12:00:00.000Z", // 48h before NOW
    last_envelope_at: "2026-04-21T11:59:00.000Z",
    envelope_count: 20,
    authorization_expires_at: "2026-05-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("calibrationEligible", () => {
  it("48h + 20 envelopes → true", () => {
    expect(calibrationEligible(snapshot(), NOW)).toBe(true);
  });
  it("47h + 20 envelopes → false", () => {
    expect(
      calibrationEligible(
        snapshot({ started_at: "2026-04-19T13:01:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });
  it("48h + 19 envelopes → false", () => {
    expect(calibrationEligible(snapshot({ envelope_count: 19 }), NOW)).toBe(false);
  });
  it("missing started_at → false", () => {
    expect(
      calibrationEligible(snapshot({ started_at: "" }), NOW),
    ).toBe(false);
  });
  it("bad started_at → false", () => {
    expect(
      calibrationEligible(snapshot({ started_at: "not-a-date" }), NOW),
    ).toBe(false);
  });
});

describe("offlineThresholdReached", () => {
  it("3h59m since last envelope → false", () => {
    expect(
      offlineThresholdReached(
        snapshot({ last_envelope_at: "2026-04-21T08:01:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });
  it("4h since last envelope → true", () => {
    expect(
      offlineThresholdReached(
        snapshot({ last_envelope_at: "2026-04-21T08:00:00.000Z" }),
        NOW,
      ),
    ).toBe(true);
  });
  it("null last_envelope_at → true (never seen)", () => {
    expect(
      offlineThresholdReached(snapshot({ last_envelope_at: null }), NOW),
    ).toBe(true);
  });
});

describe("continuousOfflineForSystemCancel", () => {
  it("23h since last envelope → false", () => {
    expect(
      continuousOfflineForSystemCancel(
        snapshot({ last_envelope_at: "2026-04-20T13:00:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });
  it("24h since last envelope → true", () => {
    expect(
      continuousOfflineForSystemCancel(
        snapshot({ last_envelope_at: "2026-04-20T12:00:00.000Z" }),
        NOW,
      ),
    ).toBe(true);
  });
  it("bad last_envelope_at → true (defensive)", () => {
    expect(
      continuousOfflineForSystemCancel(
        snapshot({ last_envelope_at: "not-iso" }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("authorizationValid", () => {
  it("expiry in the future → true", () => {
    expect(authorizationValid(snapshot(), NOW)).toBe(true);
  });
  it("expiry in the past → false", () => {
    expect(
      authorizationValid(
        snapshot({ authorization_expires_at: "2026-04-20T12:00:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });
  it("null expiry → false", () => {
    expect(
      authorizationValid(snapshot({ authorization_expires_at: null }), NOW),
    ).toBe(false);
  });
  it("bad expiry string → false", () => {
    expect(
      authorizationValid(
        snapshot({ authorization_expires_at: "tomorrow" }),
        NOW,
      ),
    ).toBe(false);
  });
  it("defaults to new Date() when now omitted", () => {
    // Expiry far in the future relative to real now.
    expect(
      authorizationValid(
        snapshot({ authorization_expires_at: "2099-01-01T00:00:00.000Z" }),
      ),
    ).toBe(true);
  });
});
