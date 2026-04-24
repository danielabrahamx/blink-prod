/**
 * Blink v2 rulebook — browser-only, simulation-backed demo.
 *
 * Two compounding rating factors:
 *   1. Location band (home/near/away) from haversine distance to the
 *      home spawn, with an override for international IP traffic.
 *   2. Charging state — on battery doubles the rate, plugged in leaves
 *      it at the band baseline. A device running on battery while out
 *      of the home base is the riskiest moment; the compound factor
 *      makes that visible in the ticker.
 *
 * This compounding is a deliberate deviation from the handoff's
 * "battery is display-only" rule — see docs/DEVIATIONS.md for the why.
 *
 * All settlement math stays integer micro-USDC (1 µ-USDC = 1e-6 USDC);
 * the battery factor is exactly 1 or 2, so every rate × factor is still
 * representable. GBP display is a convenience conversion, never
 * settled on.
 */

export const MICRO_USDC_PER_USDC = 1_000_000;

/** Per-band per-second rate in integer µ-USDC. */
export const BAND_RATE_MICRO_USDC_PER_SEC = {
  home: 3,
  near: 4,
  away: 6,
} as const;

/**
 * Distance thresholds for the location rater.
 *
 * Indoor browser geolocation typically drifts ±20-50 m even when the
 * user is sitting still, so a home radius tighter than that will
 * flicker the band every few seconds. 100 m keeps "at home" stable
 * across that jitter; 500 m still snaps to "away" once the user
 * actually leaves the block. Hysteresis bumped to 25 m so brief GPS
 * spikes don't push them outward mid-session.
 */
export const HOME_RADIUS_METERS = 100;
export const NEAR_RADIUS_METERS = 500;

/**
 * Hysteresis margin applied only when moving OUTWARD (home → near,
 * near → away). Returning to a tighter band happens at the nominal
 * boundary with no margin, so the user walks back to their desk and
 * sees `home` immediately.
 */
export const HYSTERESIS_METERS = 25;

/** Display-only GBP conversion factor. Never use for settlement. */
export const GBP_PER_USDC_DISPLAY_ONLY = 0.79;

/**
 * Battery factor. 2× when we have explicit evidence of on-battery
 * operation (Battery Status API says charging is false). Anything else
 * (pending, unsupported, plugged in) collapses to 1×, so users on
 * Firefox/Safari where the API is absent are never penalised.
 */
export const BATTERY_MULTIPLIER_UNPLUGGED = 2;

export type Band = keyof typeof BAND_RATE_MICRO_USDC_PER_SEC;

export interface ScoreInput {
  distanceMeters: number;
  ipCountry?: string;
  homeCountry?: string;
  charging?: boolean;
  prevBand?: Band;
}

export interface ScoreOutput {
  band: Band;
  /** Location-only multiplier (1.00 / 1.33 / 2.00). */
  locationMultiplier: number;
  /** Battery factor — 1.00 when plugged/unknown, 2.00 when on battery. */
  batteryMultiplier: number;
  /** Compound multiplier actually applied (locationMultiplier * batteryMultiplier). */
  multiplier: number;
  /** Integer micro-USDC per second including the battery factor. */
  microUsdcPerSec: number;
  reason: string;
}

export const LOCATION_MULTIPLIER_BY_BAND: Record<Band, number> = {
  home: 1.0,
  near:
    Math.round(
      (BAND_RATE_MICRO_USDC_PER_SEC.near / BAND_RATE_MICRO_USDC_PER_SEC.home) * 100,
    ) / 100,
  away:
    Math.round(
      (BAND_RATE_MICRO_USDC_PER_SEC.away / BAND_RATE_MICRO_USDC_PER_SEC.home) * 100,
    ) / 100,
};

/**
 * @deprecated Retained for backwards compatibility with call sites that
 * only need the location factor. New code should use scoreV2's
 * `locationMultiplier` / `multiplier` fields.
 */
export const MULTIPLIER_BY_BAND = LOCATION_MULTIPLIER_BY_BAND;

function bandFromDistance(distance: number, prev: Band | undefined): Band {
  // Asymmetric hysteresis: outward moves require crossing the boundary
  // by HYSTERESIS_METERS (suppresses flicker when standing at the
  // boundary), inward moves return at the nominal boundary (reactive
  // snap-back when the user returns to their desk).
  if (prev === 'home') {
    if (distance > NEAR_RADIUS_METERS + HYSTERESIS_METERS) return 'away';
    if (distance > HOME_RADIUS_METERS + HYSTERESIS_METERS) return 'near';
    return 'home';
  }
  if (prev === 'near') {
    if (distance <= HOME_RADIUS_METERS) return 'home';
    if (distance > NEAR_RADIUS_METERS + HYSTERESIS_METERS) return 'away';
    return 'near';
  }
  if (prev === 'away') {
    if (distance <= HOME_RADIUS_METERS) return 'home';
    if (distance <= NEAR_RADIUS_METERS) return 'near';
    return 'away';
  }
  if (distance <= HOME_RADIUS_METERS) return 'home';
  if (distance <= NEAR_RADIUS_METERS) return 'near';
  return 'away';
}

function describeDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

function batteryFactor(charging: boolean | undefined): number {
  return charging === false ? BATTERY_MULTIPLIER_UNPLUGGED : 1;
}

export function scoreV2(input: ScoreInput): ScoreOutput {
  const distance = Math.max(0, input.distanceMeters);
  const battery = batteryFactor(input.charging);

  const isInternational =
    !!input.ipCountry &&
    !!input.homeCountry &&
    input.ipCountry.toUpperCase() !== input.homeCountry.toUpperCase();

  const band: Band = isInternational
    ? 'away'
    : bandFromDistance(distance, input.prevBand);

  const locationMultiplier = LOCATION_MULTIPLIER_BY_BAND[band];
  const bandRate = BAND_RATE_MICRO_USDC_PER_SEC[band];
  const compound =
    Math.round(locationMultiplier * battery * 100) / 100;

  const parts: string[] = [];
  if (isInternational) {
    parts.push(
      `International traffic (${input.ipCountry!.toUpperCase()} ≠ ${input.homeCountry!.toUpperCase()})`,
    );
  } else {
    parts.push(`${describeDistance(distance)} from home`);
  }
  if (input.charging !== undefined) {
    parts.push(input.charging ? 'plugged in' : 'on battery');
  }

  return {
    band,
    locationMultiplier,
    batteryMultiplier: battery,
    multiplier: compound,
    microUsdcPerSec: bandRate * battery,
    reason: parts.join(' · '),
  };
}

export function microUsdcToUsdcDisplay(micro: number): string {
  return (micro / MICRO_USDC_PER_USDC).toFixed(6);
}

export function microUsdcToGbpDisplay(micro: number): string {
  const usdc = micro / MICRO_USDC_PER_USDC;
  return (usdc * GBP_PER_USDC_DISPLAY_ONLY).toFixed(6);
}
