import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haversineMeters, useGeolocation } from '../geolocation';

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    const a = { lat: 51.5074, lng: -0.1278 };
    expect(haversineMeters(a, a)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 51.5074, lng: -0.1278 };
    const b = { lat: 48.8566, lng: 2.3522 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 1);
  });

  it('measures London↔Paris at roughly 344 km', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const km = haversineMeters(london, paris) / 1_000;
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(348);
  });

  it('gives ≈ 111 km for 1° of latitude at the equator', () => {
    const km = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) / 1_000;
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it('handles antipodes without floating-point asin blow-up', () => {
    const m = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(m)).toBe(true);
    expect(m / 1_000).toBeGreaterThan(20_000);
    expect(m / 1_000).toBeLessThan(20_100);
  });

  it('returns metres for sub-kilometre spans', () => {
    const a = { lat: 51.5074, lng: -0.1278 };
    const b = { lat: 51.5074, lng: -0.1268 };
    expect(haversineMeters(a, b)).toBeGreaterThan(50);
    expect(haversineMeters(a, b)).toBeLessThan(100);
  });
});

type WatchCallbacks = {
  success: PositionCallback;
  error: PositionErrorCallback;
};

function stubGeolocation(): {
  callbacks: WatchCallbacks | null;
  watchSpy: ReturnType<typeof vi.fn>;
  clearSpy: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const state: { callbacks: WatchCallbacks | null } = { callbacks: null };
  const watchSpy = vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
    state.callbacks = { success, error };
    return 42;
  });
  const clearSpy = vi.fn();
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: watchSpy, clearWatch: clearSpy },
  });
  return {
    get callbacks() {
      return state.callbacks;
    },
    watchSpy,
    clearSpy,
    restore: () => {
      if (original) {
        Object.defineProperty(navigator, 'geolocation', original);
        return;
      }
      // jsdom has no native geolocation. RTL's global afterEach-cleanup
      // unmounts components after this hook runs, so leave a no-op
      // clearWatch in place instead of deleting the property outright.
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: () => 0, clearWatch: () => undefined },
      });
    },
  };
}

describe('useGeolocation', () => {
  let stub: ReturnType<typeof stubGeolocation>;

  beforeEach(() => {
    stub = stubGeolocation();
  });

  afterEach(() => {
    stub.restore();
  });

  it('reports unsupported when navigator.geolocation is absent', () => {
    const saved = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    // @ts-expect-error jsdom cleanup
    delete navigator.geolocation;
    const { unmount, result } = renderHook(() => useGeolocation());
    expect(result.current.status).toBe('unsupported');
    unmount();
    if (saved) Object.defineProperty(navigator, 'geolocation', saved);
  });

  it('transitions from pending to granted on a successful fix', async () => {
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.status).toBe('pending');

    act(() => {
      stub.callbacks?.success({
        coords: {
          latitude: 51.5074,
          longitude: -0.1278,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });

    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(result.current.position?.coords.latitude).toBe(51.5074);
  });

  it('flips to denied when the error code is PERMISSION_DENIED', async () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      stub.callbacks?.error({
        code: 1,
        message: 'denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    });
    await waitFor(() => expect(result.current.status).toBe('denied'));
  });

  it('reports error (not denied) on non-permission failures', async () => {
    const { result } = renderHook(() => useGeolocation());
    act(() => {
      stub.callbacks?.error({
        code: 2,
        message: 'unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('clears the watch on unmount', () => {
    const { unmount } = renderHook(() => useGeolocation());
    unmount();
    expect(stub.clearSpy).toHaveBeenCalledWith(42);
  });
});
