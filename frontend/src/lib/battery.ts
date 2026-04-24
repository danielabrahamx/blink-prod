import { useEffect, useState } from 'react';

/**
 * Battery Status API lives on Chromium (Chrome, Edge). Firefox and Safari
 * have dropped or never implemented it; the hook returns
 * `{ supported: false }` there so the UI can render a neutral pill instead
 * of claiming the laptop is always plugged in.
 *
 * Battery state drives display in v2, never the premium multiplier — see
 * rulebookV2.ts and BUILD-PLAN-V2-HANDOFF.md for the rationale.
 */
interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  readonly level: number;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
};

export interface BatteryState {
  supported: boolean;
  charging: boolean | null;
  /** Fraction in the range 0-1, or null while pending or unsupported. */
  level: number | null;
}

const UNSUPPORTED: BatteryState = {
  supported: false,
  charging: null,
  level: null,
};

const PENDING: BatteryState = {
  supported: true,
  charging: null,
  level: null,
};

export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>(PENDING);

  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      setState(UNSUPPORTED);
      return;
    }

    let battery: BatteryManager | null = null;
    let handler: (() => void) | null = null;
    let cancelled = false;

    nav
      .getBattery()
      .then(b => {
        if (cancelled) return;
        battery = b;
        handler = () =>
          setState({ supported: true, charging: b.charging, level: b.level });
        handler();
        b.addEventListener('chargingchange', handler);
        b.addEventListener('levelchange', handler);
      })
      .catch(() => {
        if (!cancelled) setState(UNSUPPORTED);
      });

    return () => {
      cancelled = true;
      if (battery && handler) {
        battery.removeEventListener('chargingchange', handler);
        battery.removeEventListener('levelchange', handler);
      }
    };
  }, []);

  return state;
}
