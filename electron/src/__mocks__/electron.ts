// Electron mock surface for vitest.
// Exposes the symbols the main + preload layers touch during unit tests.

import { EventEmitter } from 'node:events';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

// ---------- ipcMain ----------
class IpcMainMock {
  private handlers = new Map<string, Handler>();
  private listeners = new Map<string, Handler[]>();

  handle(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  on(channel: string, listener: Handler): void {
    const arr = this.listeners.get(channel) ?? [];
    arr.push(listener);
    this.listeners.set(channel, arr);
  }

  removeListener(channel: string, listener: Handler): void {
    const arr = this.listeners.get(channel);
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`ipcMain: no handler for "${channel}"`);
    return handler({}, ...args);
  }

  emit(channel: string, ...args: unknown[]): void {
    const arr = this.listeners.get(channel);
    if (!arr) return;
    for (const l of arr) l({}, ...args);
  }

  __reset(): void {
    this.handlers.clear();
    this.listeners.clear();
  }

  __has(channel: string): boolean {
    return this.handlers.has(channel) || this.listeners.has(channel);
  }

  __channels(): string[] {
    return Array.from(new Set([...this.handlers.keys(), ...this.listeners.keys()]));
  }
}
export const ipcMain = new IpcMainMock();

// ---------- ipcRenderer ----------
class IpcRendererMock {
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return ipcMain.invoke(channel, ...args);
  }

  send(channel: string, ...args: unknown[]): void {
    ipcMain.emit(channel, ...args);
  }
}
export const ipcRenderer = new IpcRendererMock();

// ---------- contextBridge ----------
interface BridgeStore {
  [apiKey: string]: unknown;
}
const bridge: BridgeStore = {};
export const contextBridge = {
  exposeInMainWorld(apiKey: string, api: unknown): void {
    bridge[apiKey] = api;
    (globalThis as Record<string, unknown>)[apiKey] = api;
  },
  __read(apiKey: string): unknown {
    return bridge[apiKey];
  },
  __reset(): void {
    for (const k of Object.keys(bridge)) delete bridge[k];
  },
};

// ---------- app ----------
class AppMock extends EventEmitter {
  private paths = new Map<string, string>([
    ['userData', '/tmp/blink-test/userData'],
    ['logs', '/tmp/blink-test/logs'],
    ['appData', '/tmp/blink-test/appData'],
  ]);
  private locked = false;

  getPath(name: string): string {
    return this.paths.get(name) ?? '/tmp/blink-test/default';
  }

  getName(): string {
    return 'Blink';
  }

  getVersion(): string {
    return '0.1.0-dev';
  }

  requestSingleInstanceLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  quit(): void {
    /* no-op */
  }

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  isReady(): boolean {
    return true;
  }

  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
}
export const app = new AppMock();

// ---------- BrowserWindow ----------
export class BrowserWindow extends EventEmitter {
  webContents = {
    send: (_channel: string, ..._args: unknown[]): void => {
      /* no-op in tests */
    },
    session: {
      webRequest: {
        onHeadersReceived: (_fn: unknown): void => {
          /* no-op */
        },
      },
    },
    on: (_event: string, _listener: unknown): void => {
      /* no-op */
    },
    openDevTools: (): void => {
      /* no-op */
    },
  };
  private bounds = { x: 0, y: 0, width: 1280, height: 800 };
  private maximized = false;
  private destroyed = false;

  constructor(public options: Record<string, unknown> = {}) {
    super();
  }

  loadURL(_url: string): Promise<void> {
    return Promise.resolve();
  }

  loadFile(_path: string): Promise<void> {
    return Promise.resolve();
  }

  show(): void {
    /* no-op */
  }

  focus(): void {
    /* no-op */
  }

  isMinimized(): boolean {
    return false;
  }

  restore(): void {
    /* no-op */
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds };
  }

  setBounds(b: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...b };
  }

  maximize(): void {
    this.maximized = true;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
  }

  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}

// ---------- Menu ----------
export const Menu = {
  buildFromTemplate: (template: unknown): unknown => template,
  setApplicationMenu: (_menu: unknown): void => {
    /* no-op */
  },
};

// ---------- shell ----------
export const shell = {
  openExternal: async (_url: string): Promise<void> => {
    /* no-op */
  },
};

// ---------- dialog ----------
export const dialog = {
  showErrorBox: (_title: string, _message: string): void => {
    /* no-op */
  },
  showMessageBox: async (): Promise<{ response: number }> => ({ response: 0 }),
};

// ---------- session ----------
export const session = {
  defaultSession: {
    webRequest: {
      onHeadersReceived: (_fn: unknown): void => {
        /* no-op */
      },
    },
  },
};

export default {
  app,
  BrowserWindow,
  Menu,
  contextBridge,
  ipcMain,
  ipcRenderer,
  shell,
  dialog,
  session,
};
