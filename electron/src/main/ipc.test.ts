import { describe, it, expect, beforeEach } from 'vitest';
import { ipcMain as realIpcMain, contextBridge } from 'electron';
import { allChannelNames, registerIpcHandlers, unregisterIpcHandlers } from './ipc.js';

// In test mode, `electron` is aliased to our in-memory mock which extends
// IpcMain with `invoke` + `__reset` + `__channels`. Narrow the import once
// so every assertion below stays clean.
interface IpcMock {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  __reset: () => void;
  __channels: () => string[];
}
const ipcMain = realIpcMain as unknown as typeof realIpcMain & IpcMock;
import { createSignalCollector } from '../signal-collector/index.js';
import { createAutoSigner } from '../auto-signer/index.js';
import * as sessionKey from '../session-key/index.js';
import * as keytarMock from '../__mocks__/keytar.js';
import { IPC_CHANNELS } from '../shared/constants.js';
// Importing the preload module triggers `contextBridge.exposeInMainWorld`.
// The mock contextBridge captures the exposed surface so we can assert
// the renderer-side API matches the main-process contract.
import '../preload/index.js';

describe('ipc handler registry', () => {
  beforeEach(async () => {
    unregisterIpcHandlers();
    ipcMain.__reset();
    keytarMock.__reset();
    const collector = await createSignalCollector();
    const autoSigner = await createAutoSigner({ session: { sign: sessionKey.sign } });
    registerIpcHandlers({ collector, autoSigner });
  });

  it('registers every advertised channel', () => {
    const mainChannels = ipcMain.__channels();
    for (const c of allChannelNames()) {
      expect(mainChannels).toContain(c);
    }
  });

  it('session.getPublicKey returns a 32-byte hex string', async () => {
    const pub = await ipcMain.invoke(IPC_CHANNELS.session.getPublicKey);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });

  it('session.rotate changes the public key', async () => {
    const a = await ipcMain.invoke(IPC_CHANNELS.session.getPublicKey);
    const b = await ipcMain.invoke(IPC_CHANNELS.session.rotate);
    expect(b).not.toBe(a);
  });

  it('session.sign returns a Uint8Array of length 64', async () => {
    const msg = new TextEncoder().encode('hi');
    const sig = (await ipcMain.invoke(IPC_CHANNELS.session.sign, msg)) as Uint8Array;
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
  });

  it('signals.start rejects when policyId is empty', async () => {
    await expect(ipcMain.invoke(IPC_CHANNELS.signals.start, '')).rejects.toThrow(
      /non-empty string/,
    );
  });

  it('signals.getLatest returns null before any collection runs (stub)', async () => {
    const out = await ipcMain.invoke(IPC_CHANNELS.signals.getLatest);
    expect(out).toBeNull();
  });

  it('settlement.registerAuthorization validates payload shape', async () => {
    await expect(
      ipcMain.invoke(IPC_CHANNELS.settlement.registerAuthorization, { bogus: true }),
    ).rejects.toThrow();
  });

  it('settlement.getStatus reports awaiting_auth before registration', async () => {
    const status = (await ipcMain.invoke(IPC_CHANNELS.settlement.getStatus)) as {
      state: string;
    };
    expect(status.state).toBe('awaiting_auth');
  });

  it('config.get/set round-trip', async () => {
    await ipcMain.invoke(IPC_CHANNELS.config.set, 'backendUrl', 'http://localhost:9999');
    const v = await ipcMain.invoke(IPC_CHANNELS.config.get, 'backendUrl');
    expect(v).toBe('http://localhost:9999');
  });

  it('device.getPublicKey + device.fingerprint both return 64-hex', async () => {
    const pub = (await ipcMain.invoke(IPC_CHANNELS.device.getPublicKey)) as string;
    const fp = (await ipcMain.invoke(IPC_CHANNELS.device.fingerprint)) as string;
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preload exposes window.electron with expected top-level namespaces', () => {
    const bridge = contextBridge as unknown as {
      __read: (k: string) => Record<string, Record<string, unknown>> | undefined;
    };
    const api = bridge.__read('electron');
    expect(api).toBeDefined();
    if (!api) throw new Error('bridge empty');
    expect(Object.keys(api).sort()).toEqual(
      ['config', 'device', 'session', 'settlement', 'signals', 'telemetry'].sort(),
    );
  });

  it('every preload namespace exposes the expected method names', () => {
    const bridge = contextBridge as unknown as {
      __read: (k: string) => Record<string, Record<string, unknown>> | undefined;
    };
    const api = bridge.__read('electron');
    if (!api) throw new Error('bridge empty');
    const session = api.session ?? {};
    const device = api.device ?? {};
    const signals = api.signals ?? {};
    const settlement = api.settlement ?? {};
    const config = api.config ?? {};
    const telemetry = api.telemetry ?? {};
    expect(Object.keys(session).sort()).toEqual(['getPublicKey', 'rotate', 'sign']);
    expect(Object.keys(device).sort()).toEqual(['fingerprint', 'getPublicKey']);
    expect(Object.keys(signals).sort()).toEqual(['getLatest', 'start', 'stop']);
    expect(Object.keys(settlement).sort()).toEqual(['getStatus', 'registerAuthorization']);
    expect(Object.keys(config).sort()).toEqual(['get', 'set']);
    expect(Object.keys(telemetry).sort()).toEqual(['track']);
  });
});
