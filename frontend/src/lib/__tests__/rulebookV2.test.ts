import { describe, it, expect } from 'vitest';
import {
  scoreV2,
  microUsdcToUsdcDisplay,
  microUsdcToGbpDisplay,
  MICRO_USDC_PER_USDC,
  BASE_RATE_MICRO_USDC_PER_SEC,
  BATTERY_MULTIPLIER_UNPLUGGED,
  GBP_PER_USDC_DISPLAY_ONLY,
} from '../rulebookV2';

describe('rulebookV2 constants', () => {
  it('base rate is an integer µ-USDC/sec', () => {
    expect(BASE_RATE_MICRO_USDC_PER_SEC).toBe(3);
  });

  it('unplugged multiplier is 2×', () => {
    expect(BATTERY_MULTIPLIER_UNPLUGGED).toBe(2);
  });
});

describe('scoreV2 - charging states', () => {
  it('plugged in → 1× multiplier, base rate', () => {
    const r = scoreV2({ charging: true });
    expect(r.multiplier).toBe(1);
    expect(r.microUsdcPerSec).toBe(BASE_RATE_MICRO_USDC_PER_SEC);
    expect(r.charging).toBe(true);
    expect(r.reason).toBe('At Desk');
  });

  it('on battery → 2× multiplier, doubled rate', () => {
    const r = scoreV2({ charging: false });
    expect(r.multiplier).toBe(BATTERY_MULTIPLIER_UNPLUGGED);
    expect(r.microUsdcPerSec).toBe(
      BASE_RATE_MICRO_USDC_PER_SEC * BATTERY_MULTIPLIER_UNPLUGGED,
    );
    expect(r.charging).toBe(false);
    expect(r.reason).toBe('On The Move');
  });

  it('unknown charging state collapses to 1× (no Firefox/Safari penalty)', () => {
    const r = scoreV2({});
    expect(r.multiplier).toBe(1);
    expect(r.microUsdcPerSec).toBe(BASE_RATE_MICRO_USDC_PER_SEC);
    expect(r.charging).toBeUndefined();
    expect(r.reason).toBe('At Desk');
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
