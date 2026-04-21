/**
 * MaxMind GeoLite2-Country lookup. Lazy-loads the mmdb bundled with the
 * server and resolves an IP to an ISO country code. For local dev without a
 * database, falls back to an injected resolver (see {@link setGeoResolver}).
 */

let customResolver: GeoResolver | null = null;
let cachedReader: unknown | null = null;
let loadAttempted = false;

export type GeoResolver = (ip: string) => string | null;

export function setGeoResolver(fn: GeoResolver | null): void {
  customResolver = fn;
}

async function getMaxmindReader(): Promise<unknown | null> {
  if (cachedReader || loadAttempted) return cachedReader;
  loadAttempted = true;
  const dbPath = process.env.GEOIP_DB_PATH;
  if (!dbPath) return null;
  try {
    const maxmind = await import('maxmind');
    cachedReader = await maxmind.open(dbPath);
    return cachedReader;
  } catch {
    return null;
  }
}

export async function resolveIpCountry(ip: string): Promise<string | null> {
  if (!ip) return null;
  if (customResolver) return customResolver(ip);
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
    return process.env.GEOIP_LOCAL_COUNTRY ?? 'US';
  }
  const reader = await getMaxmindReader();
  if (!reader) return null;
  const result = (reader as { get: (ip: string) => unknown }).get(ip) as
    | { country?: { iso_code?: string } }
    | null;
  return result?.country?.iso_code ?? null;
}

// For tests: reset the cached reader so subsequent calls re-attempt load.
export function _resetForTests(): void {
  cachedReader = null;
  loadAttempted = false;
  customResolver = null;
}
