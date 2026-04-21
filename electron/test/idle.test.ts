import { describe, it, expect, vi } from 'vitest';
import { sampleIdle, IdleWatcher, DEFAULT_IDLE_THRESHOLD_SECONDS } from '../src/signal-collector/idle';

describe('idle', () => {
  it('default threshold is 120s', () => {
    expect(DEFAULT_IDLE_THRESHOLD_SECONDS).toBe(120);
  });

  it('returns false below threshold', () => {
    expect(sampleIdle({ getSystemIdleTime: () => 5 })).toBe(false);
  });

  it('returns true at threshold', () => {
    expect(sampleIdle({ getSystemIdleTime: () => 120 })).toBe(true);
  });

  it('returns true above threshold', () => {
    expect(sampleIdle({ getSystemIdleTime: () => 3600 })).toBe(true);
  });

  it('respects explicit threshold override', () => {
    expect(sampleIdle({ getSystemIdleTime: () => 30 }, 20)).toBe(true);
  });

  it('IdleWatcher emits on transition only', () => {
    vi.useFakeTimers();
    let idleValue = 0;
    const pm = { getSystemIdleTime: () => idleValue };
    const events: boolean[] = [];
    const w = new IdleWatcher(pm, (v) => events.push(v), 60);
    w.start(10);
    expect(events).toEqual([]); // initial false == lastIdle default
    idleValue = 120;
    vi.advanceTimersByTime(15);
    expect(events).toEqual([true]);
    idleValue = 130;
    vi.advanceTimersByTime(15);
    expect(events).toEqual([true]); // no duplicate
    idleValue = 1;
    vi.advanceTimersByTime(15);
    expect(events).toEqual([true, false]);
    w.stop();
    vi.useRealTimers();
  });
});
