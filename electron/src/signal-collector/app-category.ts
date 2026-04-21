/**
 * app-category.ts - app_category signal collector.
 *
 * Uses `get-windows` (the maintained successor to the deprecated `active-win`).
 * Both `accessibilityPermission` and `screenRecordingPermission` flags are
 * set to `false`. With these flags:
 *   - macOS returns only bundleId + ownerName + processName (no title).
 *   - Windows returns processPath + executableName.
 *
 * Bundle-ID / executable name -> category is a static lookup table. Unknown
 * binaries fall through to `unknown`. When the system is idle past the
 * threshold we return `idle` instead of the foreground app.
 */

import type { AppCategory } from './types';

type GetWindowsResult = {
  title?: string;
  id?: number;
  bounds?: unknown;
  owner?: {
    name?: string;
    processId?: number;
    bundleId?: string;
    path?: string;
  };
  memoryUsage?: number;
  platform?: string;
};

type GetWindowsFn = (options: {
  accessibilityPermission: boolean;
  screenRecordingPermission: boolean;
}) => Promise<GetWindowsResult | undefined>;

let cachedFn: GetWindowsFn | null = null;

async function loadGetWindows(): Promise<GetWindowsFn> {
  if (cachedFn) return cachedFn;
  // Dynamic import because `get-windows` is ESM-only and the Electron main
  // may be CJS in older templates.
  const mod = await import('get-windows');
  cachedFn = (mod as unknown as { activeWindow: GetWindowsFn }).activeWindow;
  return cachedFn;
}

/**
 * Static bundle-ID / process-name -> category table.
 *
 * Keys are lower-cased. macOS uses reverse-DNS bundleId. Windows uses the
 * executable basename (sans .exe) because bundleId is not a first-class
 * concept there.
 */
export const APP_CATEGORY_TABLE: Readonly<Record<string, Exclude<AppCategory, 'idle' | null>>> = {
  // Productivity
  'com.microsoft.vscode': 'productivity',
  'com.microsoft.word': 'productivity',
  'com.microsoft.excel': 'productivity',
  'com.microsoft.powerpoint': 'productivity',
  'com.microsoft.outlook': 'productivity',
  'com.apple.mail': 'productivity',
  'com.apple.notes': 'productivity',
  'com.figma.desktop': 'productivity',
  'com.linear.linear': 'productivity',
  'com.tinyspeck.slackmacgap': 'productivity',
  code: 'productivity',
  'code - insiders': 'productivity',
  winword: 'productivity',
  excel: 'productivity',
  powerpnt: 'productivity',
  outlook: 'productivity',
  slack: 'productivity',
  figma: 'productivity',
  notion: 'productivity',
  linear: 'productivity',
  cursor: 'productivity',
  devenv: 'productivity',
  // Browser
  'com.apple.safari': 'browser',
  'com.google.chrome': 'browser',
  'com.mozilla.firefox': 'browser',
  'com.microsoft.edgemac': 'browser',
  'com.brave.browser': 'browser',
  'com.operasoftware.opera': 'browser',
  chrome: 'browser',
  firefox: 'browser',
  msedge: 'browser',
  safari: 'browser',
  brave: 'browser',
  opera: 'browser',
  arc: 'browser',
  // Media
  'com.spotify.client': 'media',
  'com.apple.music': 'media',
  'com.apple.tv': 'media',
  'tv.plex.plexmediaplayer': 'media',
  'com.netflix.mac': 'media',
  'com.valvesoftware.steam': 'media',
  spotify: 'media',
  vlc: 'media',
  wmplayer: 'media',
  steam: 'media',
  discord: 'media',
  'mpv-wrapper': 'media',
};

function normalizeKey(value: string | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/\.exe$/, '').trim() || null;
}

export interface SampleAppOptions {
  /** Pass `true` when the user is currently idle past the idle threshold. */
  isIdle: boolean;
  /** Override for tests. */
  getActiveWindow?: GetWindowsFn;
  /** Table override for tests. */
  table?: Readonly<Record<string, Exclude<AppCategory, 'idle' | null>>>;
}

/**
 * Sample the foreground application category.
 *
 * Null-tolerant: if `get-windows` fails or returns undefined (e.g. no
 * foreground window because the user is on the lock screen) we return `null`.
 */
export async function sampleAppCategory(opts: SampleAppOptions): Promise<AppCategory> {
  if (opts.isIdle) return 'idle';

  const fn = opts.getActiveWindow ?? (await loadGetWindows());
  let result: GetWindowsResult | undefined;
  try {
    result = await fn({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
  } catch {
    return null;
  }
  if (!result) return null;
  const table = opts.table ?? APP_CATEGORY_TABLE;

  const bundle = normalizeKey(result.owner?.bundleId);
  if (bundle && table[bundle]) return table[bundle];

  const path = result.owner?.path;
  let exec: string | null = null;
  if (path) {
    const base = path.split(/[\\/]/).pop();
    exec = normalizeKey(base);
  }
  if (exec && table[exec]) return table[exec];

  const name = normalizeKey(result.owner?.name);
  if (name && table[name]) return table[name];

  return 'unknown';
}
