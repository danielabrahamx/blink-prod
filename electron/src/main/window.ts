// BrowserWindow creation + state persistence.
// Stores last position/size/maximized flag via electron-store so subsequent
// launches restore the previous window layout.

import { BrowserWindow, app, session } from 'electron';
import Store from 'electron-store';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { WindowState } from '../shared/types.js';
import { getLogger } from './logger.js';

const DEFAULT_STATE: WindowState = {
  x: null,
  y: null,
  width: 1280,
  height: 800,
  maximized: false,
};

// CSP per handoff spec. `connect-src` allows local backend + Arc testnet RPC.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' http://localhost:3001 ws://localhost:5173 http://localhost:5173 https://rpc.testnet.arc.network",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function resolvePreload(): string {
  // In packaged builds preload is in `out/preload/index.js`. In electron-vite
  // dev the main bundle is loaded from `out/main/index.js` too, so we resolve
  // relative to the main bundle's directory.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'preload', 'index.js');
}

function resolveRendererEntry(): { kind: 'url' | 'file'; target: string } {
  // electron-vite sets `process.env.ELECTRON_RENDERER_URL` in dev.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && !app.isPackaged) {
    return { kind: 'url', target: devUrl };
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(here, '..', 'renderer', 'index.html');
  return { kind: 'file', target: htmlPath };
}

export async function createWindow(): Promise<BrowserWindow> {
  const log = getLogger();
  // electron-store slice scoped to the window layout. Typed narrowly so
  // `store.get('windowState')` is inferred correctly by TS.
  type WindowSlice = { windowState: WindowState };
  const store = new Store<WindowSlice>({ defaults: { windowState: DEFAULT_STATE } });
  const state: WindowState = store.get('windowState') ?? DEFAULT_STATE;

  // Enforce CSP on ALL responses (renderer + XHR). Must be attached before load.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  const win = new BrowserWindow({
    x: state.x ?? undefined,
    y: state.y ?? undefined,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0a0a',
    title: 'Blink',
    webPreferences: {
      preload: resolvePreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = win;

  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => {
    win.show();
    if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
  });

  const persist = (): void => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    store.set('windowState', {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized: win.isMaximized(),
    });
  };
  win.on('close', persist);
  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);

  // Block unexpected navigation (clicks on external links should open in the
  // default browser, not the Electron window).
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://localhost') || url.startsWith('file://')) return;
    event.preventDefault();
  });

  const entry = resolveRendererEntry();
  try {
    if (entry.kind === 'url') {
      log.info({ url: entry.target }, 'loading renderer from dev server');
      await win.loadURL(entry.target);
    } else {
      if (!existsSync(entry.target)) {
        log.error({ path: entry.target }, 'renderer index.html missing');
      }
      log.info({ path: entry.target }, 'loading renderer from file');
      await win.loadFile(entry.target);
    }
  } catch (err) {
    log.error({ err: String(err) }, 'failed to load renderer');
    throw err;
  }

  return win;
}

// Exported purely for tests: the preload path resolver is pure and cheap
// to assert against.
export const __internals = { resolvePreload, resolveRendererEntry, DEFAULT_STATE };
