/**
 * wifi.ts - wifi_trust signal collector.
 *
 * Uses node-wifi@2.0.16 under the hood. Never transmits raw SSID or BSSID.
 * SSID is SHA-256 hashed and matched against a home-set of hashes stored in
 * the onboarding-generated device config.
 *
 * Windows: `netsh wlan show interfaces` works without permission prompts.
 * macOS 14.4+ silently redacts SSID unless Location Services is granted - the
 * onboarding flow prompts for that, and we map blank SSID to `unknown`.
 */

import { createHash } from 'crypto';
import type { WifiTrust } from './types';

// Import is lazy-loaded so unit tests can stub it without requiring the
// native dependency on every environment.
type WifiLibrary = {
  init: (options: { iface: string | null }) => void;
  getCurrentConnections: () => Promise<Array<{ ssid?: string; bssid?: string }>>;
};

let wifiLib: WifiLibrary | null = null;

function loadWifi(): WifiLibrary {
  if (wifiLib) return wifiLib;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('node-wifi') as WifiLibrary;
  mod.init({ iface: null });
  wifiLib = mod;
  return mod;
}

export function hashSsid(ssid: string): string {
  return createHash('sha256').update(ssid, 'utf8').digest('hex');
}

export interface WifiConfig {
  /** SHA-256 hex digests of SSIDs tagged as the user's home network. */
  home_ssid_hashes: ReadonlySet<string>;
  /** SHA-256 hex digests of SSIDs the user has marked as `known` (office, cafe, etc.). */
  known_ssid_hashes: ReadonlySet<string>;
}

export interface WifiSampleResult {
  trust: WifiTrust;
  ssid_hash: string | null;
}

/**
 * Classify the current WiFi connection.
 *
 * Rules:
 *   1. No active connection -> `offline`.
 *   2. Empty/redacted SSID -> `unknown`.
 *   3. Hash matches home set -> `home`.
 *   4. Hash matches known set -> `known`.
 *   5. Otherwise -> `public`.
 *
 * `public` vs `unknown` is intentional: `unknown` means we could not read the
 * SSID at all (permission denied, hidden network), while `public` means we
 * read an SSID but the user has not classified it.
 */
export async function sampleWifi(
  config: WifiConfig,
  wifiOverride?: WifiLibrary,
): Promise<WifiSampleResult> {
  const wifi = wifiOverride ?? loadWifi();
  let connections: Array<{ ssid?: string; bssid?: string }>;
  try {
    connections = await wifi.getCurrentConnections();
  } catch {
    return { trust: 'offline', ssid_hash: null };
  }
  if (!connections || connections.length === 0) {
    return { trust: 'offline', ssid_hash: null };
  }
  const ssid = connections[0]?.ssid;
  if (!ssid || ssid.trim() === '') {
    return { trust: 'unknown', ssid_hash: null };
  }
  const hash = hashSsid(ssid);
  if (config.home_ssid_hashes.has(hash)) {
    return { trust: 'home', ssid_hash: hash };
  }
  if (config.known_ssid_hashes.has(hash)) {
    return { trust: 'known', ssid_hash: hash };
  }
  return { trust: 'public', ssid_hash: hash };
}
