/**
 * Persists the user's home spawn (lat/lng + ISO country) to localStorage.
 * The /live session reads this on mount and compares against the live
 * geolocation via haversineMeters to decide the current band.
 *
 * We tolerate (but never repair) corrupted storage: if anything looks off
 * we return null so the UI can re-prompt the user through /set-home. This
 * is the same pattern as emailGate — fail soft, force a re-prompt.
 */

export interface HomeSpawn {
  lat: number;
  lng: number;
  /** ISO-3166 alpha-2 country code, if we could infer it at set time. */
  country?: string;
  /** Epoch millis when the spawn was saved. */
  setAt: number;
}

export const HOME_SPAWN_STORAGE_KEY = 'blink_home_spawn_v2';

function isValidLatLng(v: unknown): v is { lat: number; lng: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { lat: unknown }).lat === 'number' &&
    typeof (v as { lng: unknown }).lng === 'number' &&
    Number.isFinite((v as { lat: number }).lat) &&
    Number.isFinite((v as { lng: number }).lng) &&
    Math.abs((v as { lat: number }).lat) <= 90 &&
    Math.abs((v as { lng: number }).lng) <= 180
  );
}

export function readHomeSpawn(): HomeSpawn | null {
  try {
    const raw = localStorage.getItem(HOME_SPAWN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidLatLng(parsed)) return null;
    const record = parsed as {
      lat: number;
      lng: number;
      country?: unknown;
      setAt?: unknown;
    };
    return {
      lat: record.lat,
      lng: record.lng,
      country: typeof record.country === 'string' ? record.country : undefined,
      setAt: typeof record.setAt === 'number' ? record.setAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeHomeSpawn(
  spawn: Omit<HomeSpawn, 'setAt'> & { setAt?: number },
): HomeSpawn {
  const record: HomeSpawn = {
    lat: spawn.lat,
    lng: spawn.lng,
    country: spawn.country,
    setAt: spawn.setAt ?? Date.now(),
  };
  localStorage.setItem(HOME_SPAWN_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function clearHomeSpawn(): void {
  localStorage.removeItem(HOME_SPAWN_STORAGE_KEY);
}
