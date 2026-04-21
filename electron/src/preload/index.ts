// Preload script. Runs in an isolated world with nodeIntegration: false +
// contextIsolation: true. Exposes a narrow, typed API on `window.electron`
// so the renderer never sees `ipcRenderer` directly.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants.js';
import type {
  AppConfig,
  EIP3009Authorization,
  SettlementStatus,
  SignalEnvelope,
} from '../shared/types.js';
import type { BlinkElectronApi } from './api.js';

const api: BlinkElectronApi = {
  session: {
    getPublicKey: () => ipcRenderer.invoke(IPC_CHANNELS.session.getPublicKey) as Promise<string>,
    rotate: () => ipcRenderer.invoke(IPC_CHANNELS.session.rotate) as Promise<string>,
    sign: (message: Uint8Array) =>
      ipcRenderer.invoke(IPC_CHANNELS.session.sign, message) as Promise<Uint8Array>,
  },
  device: {
    getPublicKey: () => ipcRenderer.invoke(IPC_CHANNELS.device.getPublicKey) as Promise<string>,
    fingerprint: () => ipcRenderer.invoke(IPC_CHANNELS.device.fingerprint) as Promise<string>,
  },
  signals: {
    start: (policyId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.signals.start, policyId) as Promise<void>,
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.signals.stop) as Promise<void>,
    getLatest: () =>
      ipcRenderer.invoke(IPC_CHANNELS.signals.getLatest) as Promise<SignalEnvelope | null>,
  },
  settlement: {
    registerAuthorization: (auth: EIP3009Authorization) =>
      ipcRenderer.invoke(IPC_CHANNELS.settlement.registerAuthorization, auth) as Promise<void>,
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.settlement.getStatus) as Promise<SettlementStatus>,
  },
  config: {
    get: <K extends keyof AppConfig>(k: K): Promise<AppConfig[K]> =>
      ipcRenderer.invoke(IPC_CHANNELS.config.get, k) as Promise<AppConfig[K]>,
    set: <K extends keyof AppConfig>(k: K, v: AppConfig[K]): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.config.set, k, v) as Promise<void>,
  },
  telemetry: {
    track: (event: string, props: Record<string, unknown>): void => {
      ipcRenderer.send(IPC_CHANNELS.telemetry.track, event, props);
    },
  },
};

contextBridge.exposeInMainWorld('electron', api);
