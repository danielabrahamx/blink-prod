import { describe, it, expect, vi } from 'vitest';
import { ChargingWatcher, type PowerMonitorLike } from '../src/signal-collector/charging';

function makeFakePowerMonitor(): PowerMonitorLike & {
  fire: (event: 'on-ac' | 'on-battery') => void;
  setIsOnBattery: (v: boolean) => void;
} {
  const listeners = new Map<string, Array<() => void>>();
  let onBattery = false;
  return {
    on(event, listener) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
    },
    removeAllListeners(event) {
      listeners.delete(event);
    },
    isOnBatteryPower: () => onBattery,
    fire(event) {
      (listeners.get(event) ?? []).forEach((fn) => fn());
    },
    setIsOnBattery(v) {
      onBattery = v;
    },
  };
}

describe('ChargingWatcher', () => {
  it('seeds with the current powerMonitor state', () => {
    const pm = makeFakePowerMonitor();
    pm.setIsOnBattery(true);
    const changes: string[] = [];
    const w = new ChargingWatcher({
      powerMonitor: pm,
      onChange: (s) => changes.push(s),
      pollIntervalMs: 100000,
    });
    w.start();
    expect(changes).toEqual(['battery']);
    w.stop();
  });

  it('emits on on-ac event', () => {
    const pm = makeFakePowerMonitor();
    pm.setIsOnBattery(true);
    const changes: string[] = [];
    const w = new ChargingWatcher({
      powerMonitor: pm,
      onChange: (s) => changes.push(s),
      pollIntervalMs: 100000,
    });
    w.start();
    pm.setIsOnBattery(false);
    pm.fire('on-ac');
    expect(changes).toEqual(['battery', 'ac']);
    w.stop();
  });

  it('dedupes repeated states', () => {
    const pm = makeFakePowerMonitor();
    pm.setIsOnBattery(false);
    const changes: string[] = [];
    const w = new ChargingWatcher({
      powerMonitor: pm,
      onChange: (s) => changes.push(s),
      pollIntervalMs: 100000,
    });
    w.start();
    pm.fire('on-ac');
    pm.fire('on-ac');
    expect(changes).toEqual(['ac']);
    w.stop();
  });

  it('polls as a belt-and-braces safety net', () => {
    vi.useFakeTimers();
    const pm = makeFakePowerMonitor();
    pm.setIsOnBattery(false);
    const changes: string[] = [];
    const w = new ChargingWatcher({
      powerMonitor: pm,
      onChange: (s) => changes.push(s),
      pollIntervalMs: 50,
    });
    w.start();
    // Now simulate a missed event: plug is pulled but on-battery never fires.
    pm.setIsOnBattery(true);
    vi.advanceTimersByTime(60);
    expect(changes).toEqual(['ac', 'battery']);
    w.stop();
    vi.useRealTimers();
  });
});
