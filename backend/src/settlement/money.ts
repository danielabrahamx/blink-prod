/**
 * Money helpers. USDC has 6 decimals and we track premiums at sub-cent levels,
 * so we cannot do `amount * rate * seconds` with JS floats without drift.
 *
 * Internal representation: bigint base units (1 USDC = 1_000_000n).
 * External representation: decimal string with exactly 6 fractional digits.
 *
 * This module is deliberately tiny; reach for a BigNumber library only when
 * arithmetic complexity demands it (it does not yet).
 */

const SCALE = 1_000_000n;

function assertFinite(n: number, label: string): void {
  if (!Number.isFinite(n)) throw new Error(`${label} is not finite: ${n}`);
}

/** Parse a 6-dp decimal string or number into base units. Rejects NaN/negatives. */
export function toUnits(value: string | number): bigint {
  if (typeof value === 'number') {
    assertFinite(value, 'value');
    if (value < 0) throw new Error(`value must be >= 0: ${value}`);
    // Round to nearest integer base unit.
    return BigInt(Math.round(value * 1_000_000));
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid USDC decimal string: ${value}`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole ?? '0') * SCALE + BigInt(fracPadded);
}

/** Format base units as a 6-dp decimal string ("0.000000"). */
export function fromUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(6, '0');
  return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * delta = base_rate_usdc_per_sec * multiplier * elapsed_seconds
 *
 * Computed in base units. Multiplier is clamped to [0, 10] — a guardrail
 * against rulebook bugs or a malicious signal feed. Elapsed is clamped to
 * [0, 86_400] so a clock skew never produces a month of accrual in one tick.
 */
export function computeAccrualUnits(
  baseRateUsdcPerSec: number,
  multiplier: number,
  elapsedSeconds: number,
): bigint {
  assertFinite(baseRateUsdcPerSec, 'baseRateUsdcPerSec');
  assertFinite(multiplier, 'multiplier');
  assertFinite(elapsedSeconds, 'elapsedSeconds');
  if (baseRateUsdcPerSec <= 0) return 0n;
  if (multiplier < 0) return 0n;
  const mult = Math.min(10, multiplier);
  const elapsed = Math.max(0, Math.min(86_400, Math.floor(elapsedSeconds)));
  const accrualFloat = baseRateUsdcPerSec * mult * elapsed;
  return toUnits(accrualFloat);
}

/** Subtract without underflow below zero. */
export function clampSub(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

export const ZERO = '0.000000';
