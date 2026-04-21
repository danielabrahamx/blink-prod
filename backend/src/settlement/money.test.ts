import { describe, expect, it } from 'vitest';
import { computeAccrualUnits, fromUnits, toUnits, clampSub, ZERO } from './money';

describe('money', () => {
  it('round-trips decimal strings exactly', () => {
    expect(fromUnits(toUnits('0.000001'))).toBe('0.000001');
    expect(fromUnits(toUnits('1.234567'))).toBe('1.234567');
    expect(fromUnits(toUnits('1'))).toBe('1.000000');
    expect(fromUnits(toUnits('0'))).toBe(ZERO);
  });

  it('rejects invalid decimals', () => {
    expect(() => toUnits('abc')).toThrow();
    expect(() => toUnits('1.234567.8')).toThrow();
  });

  it('converts numbers by rounding to nearest base unit', () => {
    expect(toUnits(0.0000005)).toBe(1n); // 0.0000005 USDC rounds up to 1 unit
    expect(toUnits(0.0000004)).toBe(0n);
  });

  it('computes accrual without drift on sub-cent deltas', () => {
    // base rate 0.000005 * multiplier 1.0 * 60s = 0.0003 USDC = 300 units
    expect(computeAccrualUnits(0.000005, 1.0, 60)).toBe(300n);
    expect(fromUnits(computeAccrualUnits(0.000005, 1.0, 60))).toBe('0.000300');
  });

  it('weights by multiplier', () => {
    // base rate 0.00001 * multiplier 2 * 30s = 0.0006 USDC = 600 units
    expect(computeAccrualUnits(0.00001, 2, 30)).toBe(600n);
  });

  it('returns zero for paused / negative inputs', () => {
    expect(computeAccrualUnits(0, 1, 60)).toBe(0n);
    expect(computeAccrualUnits(0.00001, 0, 60)).toBe(0n);
    expect(computeAccrualUnits(0.00001, 1, 0)).toBe(0n);
    expect(computeAccrualUnits(0.00001, -1, 60)).toBe(0n);
  });

  it('clamps absurd inputs', () => {
    // multiplier clamped to 10
    expect(computeAccrualUnits(0.00001, 999, 60)).toBe(computeAccrualUnits(0.00001, 10, 60));
    // elapsed clamped to 86_400
    expect(computeAccrualUnits(0.00001, 1, 999_999)).toBe(computeAccrualUnits(0.00001, 1, 86_400));
  });

  it('clampSub floors at zero', () => {
    expect(clampSub(5n, 3n)).toBe(2n);
    expect(clampSub(3n, 5n)).toBe(0n);
  });
});
