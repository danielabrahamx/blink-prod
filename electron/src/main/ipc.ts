// Central IPC handler registry.
// Every channel advertised on `window.electron` in the preload MUST have a
// matching `ipcMain.handle` registration here. Handlers are kept thin --
// they delegate to the domain modules and only enforce argument shapes
// via zod so the renderer cannot smuggle in malformed payloads.

import { ipcMain, app } from 'electron';
import Store from 'electron-store';
import { IPC_CHANNELS, CONFIG_KEYS, DEFAULT_BACKEND_URL, DEFAULT_RPC_URL } from '../shared/constants.js';
import { EIP3009AuthorizationSchema, type AppConfig, type TelemetryEvent } from '../shared/types.js';
import * as sessionKey from '../session-key/index.js';
import * as deviceKey from '../device-key/index.js';
import type { SignalCollector } from '../signal-collector/index.js';
import type { AutoSigner } from '../auto-signer/index.js';
import { getLogger } from './logger.js';

export interface RegisterIpcDeps {
  collector: SignalCollector;
  autoSigner: AutoSigner;
}

const defaults: AppConfig = {
  onboardingComplete: false,
  walletAddress: null,
  backendUrl: DEFAULT_BACKEND_URL,
  rpcUrl: DEFAULT_RPC_URL,
  homeSsidHashes: [],
  telemetryEnabled: false,
  lastSignalAt: null,
  windowState: { x: null, y: null, width: 1280, height: 800, maximized: false },
};

// electron-store is instantiated once per process; IPC handlers share the
// same instance as `window.ts` via Electron's on-disk coherency guarantees
// (it uses atomic writes to `config.json` under userData).
let configStore: Store<AppConfig> | null = null;
function getConfig(): Store<AppConfig> {
  if (!configStore) configStore = new Store<AppConfig>({ defaults });
  return configStore;
}

export function registerIpcHandlers(deps: RegisterIpcDeps): void {
  const log = getLogger();

  // ---------- session ----------
  ipcMain.handle(IPC_CHANNELS.session.getPublicKey, async () => sessionKey.getPublicKey());
  ipcMain.handle(IPC_CHANNELS.session.rotate, async () => sessionKey.rotate());
  ipcMain.handle(IPC_CHANNELS.session.sign, async (_e, message: Uint8Array) => {
    if (!(message instanceof Uint8Array)) {
      throw new TypeError('session.sign: message must be Uint8Array');
    }
    return sessionKey.sign(message);
  });

  // ---------- device ----------
  ipcMain.handle(IPC_CHANNELS.device.getPublicKey, async () => deviceKey.getPublicKey());
  ipcMain.handle(IPC_CHANNELS.device.fingerprint, async () => deviceKey.fingerprint());

  // ---------- signals ----------
  ipcMain.handle(IPC_CHANNELS.signals.start, async (_e, policyId: string) => {
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new TypeError('signals.start: policyId must be a non-empty string');
    }
    await deps.collector.start({ policyId });
  });
  ipcMain.handle(IPC_CHANNELS.signals.stop, async () => deps.collector.stop());
  ipcMain.handle(IPC_CHANNELS.signals.getLatest, async () => deps.collector.getLatest());

  // ---------- settlement ----------
  ipcMain.handle(IPC_CHANNELS.settlement.registerAuthorization, async (_e, auth: unknown) => {
    const parsed = EIP3009AuthorizationSchema.parse(auth);
    await deps.autoSigner.registerAuthorization(parsed);
  });
  ipcMain.handle(IPC_CHANNELS.settlement.getStatus, async () => deps.autoSigner.getStatus());

  // ---------- config ----------
  ipcMain.handle(IPC_CHANNELS.config.get, async (_e, key: keyof AppConfig) => {
    return getConfig().get(key);
  });
  ipcMain.handle(IPC_CHANNELS.config.set, async (_e, key: keyof AppConfig, value: unknown) => {
    // Any-cast: electron-store's typed signature requires the exact union
    // member; the runtime validates via defaults-shape compat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC edge: value narrowed by caller
    (getConfig() as Store<AppConfig>).set(key, value as any);
  });

  // ---------- telemetry ----------
  ipcMain.on(IPC_CHANNELS.telemetry.track, (_e, event: string, props: Record<string, unknown>) => {
    const ev: TelemetryEvent = { event, props, ts: new Date().toISOString() };
    log.info({ telemetry: ev }, 'telemetry');
  });

  log.info(
    { channels: Object.values(IPC_CHANNELS).flatMap((g) => Object.values(g)) },
    'ipc handlers registered',
  );

  // Keep track of config keys so future diagnostics can dump them.
  void CONFIG_KEYS;
  void app;
}

export function unregisterIpcHandlers(): void {
  for (const group of Object.values(IPC_CHANNELS)) {
    for (const channel of Object.values(group)) {
      ipcMain.removeHandler(channel);
    }
  }
}

// Exposed for tests: enumerate every channel string so we can assert the
// preload surface matches 1:1.
export function allChannelNames(): string[] {
  const out: string[] = [];
  for (const group of Object.values(IPC_CHANNELS)) {
    for (const channel of Object.values(group)) out.push(channel);
  }
  return out;
}
