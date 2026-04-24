import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBattery } from '../battery';

type BatteryManagerLike = EventTarget & { charging: boolean; level: number };

function createBattery(initial: { charging: boolean; level: number }): BatteryManagerLike {
  const target = new EventTarget() as BatteryManagerLike;
  target.charging = initial.charging;
  target.level = initial.level;
  return target;
}

describe('useBattery', () => {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryManagerLike>;
  };
  const original = nav.getBattery;

  afterEach(() => {
    if (original) {
      nav.getBattery = original;
    } else {
      delete nav.getBattery;
    }
    vi.restoreAllMocks();
  });

  it('returns unsupported when navigator.getBattery is missing', async () => {
    delete nav.getBattery;
    const { result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.supported).toBe(false));
    expect(result.current.charging).toBeNull();
    expect(result.current.level).toBeNull();
  });

  it('returns charging + level once getBattery resolves', async () => {
    const battery = createBattery({ charging: true, level: 0.8 });
    nav.getBattery = vi.fn().mockResolvedValue(battery);

    const { result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.charging).toBe(true));
    expect(result.current.level).toBeCloseTo(0.8);
    expect(result.current.supported).toBe(true);
  });

  it('updates state when a chargingchange event fires', async () => {
    const battery = createBattery({ charging: true, level: 0.9 });
    nav.getBattery = vi.fn().mockResolvedValue(battery);

    const { result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.charging).toBe(true));

    act(() => {
      battery.charging = false;
      battery.dispatchEvent(new Event('chargingchange'));
    });

    await waitFor(() => expect(result.current.charging).toBe(false));
  });

  it('updates state when a levelchange event fires', async () => {
    const battery = createBattery({ charging: false, level: 0.75 });
    nav.getBattery = vi.fn().mockResolvedValue(battery);

    const { result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.level).toBeCloseTo(0.75));

    act(() => {
      battery.level = 0.5;
      battery.dispatchEvent(new Event('levelchange'));
    });

    await waitFor(() => expect(result.current.level).toBeCloseTo(0.5));
  });

  it('falls back to unsupported when getBattery rejects', async () => {
    nav.getBattery = vi.fn().mockRejectedValue(new Error('blocked by permissions policy'));

    const { result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it('cleans up listeners on unmount', async () => {
    const battery = createBattery({ charging: true, level: 1 });
    const removeSpy = vi.spyOn(battery, 'removeEventListener');
    nav.getBattery = vi.fn().mockResolvedValue(battery);

    const { unmount, result } = renderHook(() => useBattery());
    await waitFor(() => expect(result.current.charging).toBe(true));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('chargingchange', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('levelchange', expect.any(Function));
  });
});

describe('useBattery - unmount before resolve', () => {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryManagerLike>;
  };
  const original = nav.getBattery;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (original) {
      nav.getBattery = original;
    } else {
      delete nav.getBattery;
    }
  });

  it('does not throw when the promise resolves after unmount', async () => {
    let resolveBattery: (b: BatteryManagerLike) => void = () => undefined;
    const pending = new Promise<BatteryManagerLike>(resolve => {
      resolveBattery = resolve;
    });
    nav.getBattery = vi.fn().mockReturnValue(pending);

    const { unmount } = renderHook(() => useBattery());
    unmount();
    resolveBattery(createBattery({ charging: true, level: 1 }));
    await expect(pending).resolves.toBeDefined();
  });
});
