import { describe, it, expect } from 'vitest';
import {
  fmtUsdc,
  fmtMultiplier,
  fmtPct,
  fmtMs,
  fmtTs,
  shortHash,
} from '../formatters';

describe('formatters', () => {
  describe('fmtUsdc', () => {
    it('formats finite numbers to default 6dp', () => {
      expect(fmtUsdc(1.234567)).toBe('1.234567');
    });
    it('respects dp override', () => {
      expect(fmtUsdc(1.2345, 2)).toBe('1.23');
    });
    it('returns -- for non-finite', () => {
      expect(fmtUsdc(Number.NaN)).toBe('--');
      expect(fmtUsdc(Number.POSITIVE_INFINITY)).toBe('--');
    });
  });

  describe('fmtMultiplier', () => {
    it('formats with x suffix', () => {
      expect(fmtMultiplier(1.2)).toBe('1.200x');
    });
    it('returns -- for non-finite', () => {
      expect(fmtMultiplier(Number.NaN)).toBe('--');
    });
  });

  describe('fmtPct', () => {
    it('renders percent with % suffix and default 1dp', () => {
      expect(fmtPct(25.5)).toBe('25.5%');
    });
    it('honours custom dp', () => {
      expect(fmtPct(25.49, 0)).toBe('25%');
    });
    it('returns -- for non-finite', () => {
      expect(fmtPct(Number.NaN)).toBe('--');
    });
  });

  describe('fmtMs', () => {
    it('rounds to whole ms', () => {
      expect(fmtMs(42.7)).toBe('43ms');
    });
    it('returns -- for non-finite', () => {
      expect(fmtMs(Number.NaN)).toBe('--');
    });
  });

  describe('fmtTs', () => {
    it('renders a space-separated UTC timestamp', () => {
      expect(fmtTs('2026-04-21T09:00:00.000Z')).toBe('2026-04-21 09:00:00');
    });
    it('returns the input when unparseable', () => {
      expect(fmtTs('not-a-date')).toBe('not-a-date');
    });
  });

  describe('shortHash', () => {
    it('ellipsises long strings', () => {
      expect(shortHash('0x1234567890abcdef', 4, 4)).toBe('0x12...cdef');
    });
    it('returns the input when it is already short', () => {
      expect(shortHash('0x1234')).toBe('0x1234');
    });
    it('returns empty string for empty input', () => {
      expect(shortHash('')).toBe('');
    });
  });
});
