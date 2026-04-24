import { describe, it, expect } from 'vitest';
import {
  scoreV2,
  microUsdcToUsdcDisplay,
  microUsdcToGbpDisplay,
  MICRO_USDC_PER_USDC,
  BAND_RATE_MICRO_USDC_PER_SEC,
  BATTERY_MULTIPLIER_UNPLUGGED,
  HOME_RADIUS_METERS,
  NEAR_RADIUS_METERS,
  HYSTERESIS_METERS,
  GBP_PER_USDC_DISPLAY_ONLY,
  type Band,
} from '../rulebookV2';

describe('rulebookV2 constants', () => {
  it('uses integer µ-USDC/sec rates per band', () => {
    expect(BAND_RATE_MICRO_USDC_PER_SEC.home).toBe(3);
    expect(BAND_RATE_MICRO_USDC_PER_SEC.near).toBe(4);
    expect(BAND_RATE_MICRO_USDC_PER_SEC.away).toBe(6);
  });

  it('exposes finite, sane distance thresholds', () => {
    expect(HOME_RADIUS_METERS).toBeGreaterThan(0);
    expect(NEAR_RADIUS_METERS).toBeGreaterThanOrEqual(HOME_RADIUS_METERS);
    expect(HYSTERESIS_METERS).toBeGreaterThan(0);
  });
});

describe('scoreV2 - fresh session band boundaries', () => {
  const cases: Array<{ distance: number; band: Band }> = [
    { distance: 0, band: 'home' },
    { distance: HOME_RADIUS_METERS - 0.1, band: 'home' },
    { distance: HOME_RADIUS_METERS, band: 'home' },
    { distance: HOME_RADIUS_METERS + 0.1, band: 'near' },
    { distance: NEAR_RADIUS_METERS, band: 'near' },
    { distance: NEAR_RADIUS_METERS + 0.1, band: 'away' },
    { distance: NEAR_RADIUS_METERS * 1_000, band: 'away' },
  ];
  cases.forEach(({ distance, band }) => {
    it(`@ ${distance}m (no prevBand) → ${band}`, () => {
      const r = scoreV2({ distanceMeters: distance });
      expect(r.band).toBe(band);
      expect(r.microUsdcPerSec).toBe(BAND_RATE_MICRO_USDC_PER_SEC[band]);
    });
  });
});

describe('scoreV2 - hysteresis', () => {
  it('stays home at the hysteresis edge when prev=home', () => {
    expect(
      scoreV2({ distanceMeters: HOME_RADIUS_METERS + HYSTERESIS_METERS, prevBand: 'home' }).band,
    ).toBe('home');
  });

  it('moves home→near only once past HOME_RADIUS + HYSTERESIS', () => {
    expect(
      scoreV2({ distanceMeters: HOME_RADIUS_METERS + HYSTERESIS_METERS + 1, prevBand: 'home' })
        .band,
    ).toBe('near');
  });

  it('supports home→away jump in one tick if distance explodes', () => {
    expect(scoreV2({ distanceMeters: 1_000_000, prevBand: 'home' }).band).toBe('away');
  });

  it('snaps back to home at the nominal boundary when prev=near (no inward hysteresis)', () => {
    expect(
      scoreV2({ distanceMeters: HOME_RADIUS_METERS, prevBand: 'near' }).band,
    ).toBe('home');
  });

  it('stays near while distance sits just outside home', () => {
    expect(
      scoreV2({
        distanceMeters: HOME_RADIUS_METERS + HYSTERESIS_METERS,
        prevBand: 'near',
      }).band,
    ).toBe('near');
  });

  it('stays near at the outer hysteresis edge when prev=near', () => {
    expect(
      scoreV2({ distanceMeters: NEAR_RADIUS_METERS + HYSTERESIS_METERS, prevBand: 'near' }).band,
    ).toBe('near');
  });

  it('moves near→away only once past NEAR_RADIUS + HYSTERESIS', () => {
    expect(
      scoreV2({ distanceMeters: NEAR_RADIUS_METERS + HYSTERESIS_METERS + 1, prevBand: 'near' })
        .band,
    ).toBe('away');
  });

  it('snaps back to near at the nominal boundary when prev=away', () => {
    expect(
      scoreV2({ distanceMeters: NEAR_RADIUS_METERS, prevBand: 'away' }).band,
    ).toBe('near');
  });

  it('stays away while distance sits just outside near', () => {
    expect(
      scoreV2({
        distanceMeters: NEAR_RADIUS_METERS + HYSTERESIS_METERS,
        prevBand: 'away',
      }).band,
    ).toBe('away');
  });

  it('supports away→home jump in one tick if distance collapses', () => {
    expect(scoreV2({ distanceMeters: 0, prevBand: 'away' }).band).toBe('home');
  });
});

describe('scoreV2 - international-IP override', () => {
  it('forces away at distance 0 when IP country differs', () => {
    const r = scoreV2({ distanceMeters: 0, homeCountry: 'GB', ipCountry: 'FR' });
    expect(r.band).toBe('away');
    expect(r.locationMultiplier).toBe(2);
    expect(r.microUsdcPerSec).toBe(BAND_RATE_MICRO_USDC_PER_SEC.away);
    expect(r.reason).toMatch(/International/i);
  });

  it('matches are case-insensitive', () => {
    const r = scoreV2({ distanceMeters: 0, homeCountry: 'gb', ipCountry: 'GB' });
    expect(r.band).toBe('home');
  });

  it('override beats hysteresis', () => {
    const r = scoreV2({
      distanceMeters: 0,
      homeCountry: 'GB',
      ipCountry: 'ES',
      prevBand: 'home',
    });
    expect(r.band).toBe('away');
  });

  it('no override when either country is missing', () => {
    expect(scoreV2({ distanceMeters: 0, ipCountry: 'FR' }).band).toBe('home');
    expect(scoreV2({ distanceMeters: 0, homeCountry: 'GB' }).band).toBe('home');
  });
});

describe('scoreV2 - battery compounds onto location', () => {
  const nearMid = (HOME_RADIUS_METERS + NEAR_RADIUS_METERS) / 2;
  const bands: Array<{ distance: number; band: Band; locationMultiplier: number }> = [
    { distance: 0, band: 'home', locationMultiplier: 1 },
    { distance: nearMid, band: 'near', locationMultiplier: 1.33 },
    { distance: NEAR_RADIUS_METERS * 100, band: 'away', locationMultiplier: 2 },
  ];

  bands.forEach(({ distance, band, locationMultiplier }) => {
    it(`@ ${band}: on battery doubles the rate from ${BAND_RATE_MICRO_USDC_PER_SEC[band]} µUSDC/sec`, () => {
      const plugged = scoreV2({ distanceMeters: distance, charging: true });
      const unplugged = scoreV2({ distanceMeters: distance, charging: false });
      expect(plugged.band).toBe(band);
      expect(unplugged.band).toBe(band);
      expect(plugged.locationMultiplier).toBe(locationMultiplier);
      expect(unplugged.locationMultiplier).toBe(locationMultiplier);
      expect(plugged.batteryMultiplier).toBe(1);
      expect(unplugged.batteryMultiplier).toBe(BATTERY_MULTIPLIER_UNPLUGGED);
      expect(unplugged.microUsdcPerSec).toBe(plugged.microUsdcPerSec * 2);
      expect(unplugged.multiplier).toBeCloseTo(plugged.multiplier * 2, 2);
    });
  });

  it('home on battery = 2.00× compound (same as away plugged in)', () => {
    const homeUnplugged = scoreV2({ distanceMeters: 0, charging: false });
    const awayPlugged = scoreV2({
      distanceMeters: NEAR_RADIUS_METERS * 100,
      charging: true,
    });
    expect(homeUnplugged.multiplier).toBe(2);
    expect(awayPlugged.multiplier).toBe(2);
    expect(homeUnplugged.microUsdcPerSec).toBe(awayPlugged.microUsdcPerSec);
  });

  it('away on battery stacks to 4.00× compound', () => {
    const r = scoreV2({
      distanceMeters: NEAR_RADIUS_METERS * 100,
      charging: false,
    });
    expect(r.multiplier).toBe(4);
    expect(r.microUsdcPerSec).toBe(BAND_RATE_MICRO_USDC_PER_SEC.away * 2);
  });

  it('unknown/pending charging collapses to factor 1 (no penalty on Firefox/Safari)', () => {
    const unknown = scoreV2({ distanceMeters: 0 });
    expect(unknown.batteryMultiplier).toBe(1);
    expect(unknown.microUsdcPerSec).toBe(BAND_RATE_MICRO_USDC_PER_SEC.home);
  });

  it('surfaces charging state in the reason string when provided', () => {
    expect(scoreV2({ distanceMeters: 0, charging: false }).reason).toMatch(/on battery/);
    expect(scoreV2({ distanceMeters: 0, charging: true }).reason).toMatch(/plugged in/);
  });

  it('omits charging from the reason when undefined', () => {
    expect(scoreV2({ distanceMeters: 0 }).reason).not.toMatch(/battery|plugged/);
  });
});

describe('scoreV2 - multiplier values (location-only, plugged or unknown)', () => {
  const nearMid = (HOME_RADIUS_METERS + NEAR_RADIUS_METERS) / 2;
  it('home=1.00, near≈1.33, away=2.00', () => {
    expect(scoreV2({ distanceMeters: 0 }).locationMultiplier).toBe(1);
    expect(scoreV2({ distanceMeters: nearMid }).locationMultiplier).toBeCloseTo(1.33, 2);
    expect(
      scoreV2({ distanceMeters: NEAR_RADIUS_METERS * 100 }).locationMultiplier,
    ).toBe(2);
  });
});

describe('scoreV2 - defensive input handling', () => {
  it('clamps negative distance to 0', () => {
    expect(scoreV2({ distanceMeters: -500 }).band).toBe('home');
  });

  it('describes short distances in metres, longer in km', () => {
    expect(scoreV2({ distanceMeters: 42 }).reason).toMatch(/42 m/);
    expect(scoreV2({ distanceMeters: 2_500 }).reason).toMatch(/2\.5 km/);
    expect(scoreV2({ distanceMeters: 3 }).reason).toMatch(/3 m/);
  });
});

describe('microUsdc display helpers', () => {
  it('renders µ-USDC as a six-decimal USDC string', () => {
    expect(microUsdcToUsdcDisplay(0)).toBe('0.000000');
    expect(microUsdcToUsdcDisplay(3)).toBe('0.000003');
    expect(microUsdcToUsdcDisplay(MICRO_USDC_PER_USDC)).toBe('1.000000');
    expect(microUsdcToUsdcDisplay(7_776_000)).toBe('7.776000');
  });

  it('renders µ-USDC as a GBP display string via the fixed conversion', () => {
    expect(microUsdcToGbpDisplay(0)).toBe('0.000000');
    expect(microUsdcToGbpDisplay(MICRO_USDC_PER_USDC)).toBe(
      GBP_PER_USDC_DISPLAY_ONLY.toFixed(6),
    );
  });
});
