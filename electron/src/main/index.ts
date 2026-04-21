// Electron main-process entry point.
// Responsibilities:
//   - single-instance lock (second launches focus existing window)
//   - wire IPC handlers
//   - construct the BrowserWindow
//   - build the application menu
//   - install the updater stub (disabled for pilot)

import { app, BrowserWindow } from 'electron';
import { createWindow, getMainWindow } from './window.js';
import { registerIpcHandlers } from './ipc.js';
import { buildMenu } from './menu.js';
import { scheduleBackgroundChecks } from './updater.js';
import { getLogger } from './logger.js';
import { createSignalCollector } from '../signal-collector/index.js';
import { createAutoSigner } from '../auto-signer/index.js';
import * as sessionKey from '../session-key/index.js';

// Name must be set BEFORE `app.whenReady()` so `app.getPath('logs')` resolves
// to `%APPDATA%\Blink\logs` rather than the default Electron name.
app.setName('Blink');
app.setAppUserModelId('com.sibrox.blink');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const log = getLogger();
    try {
      const collector = await createSignalCollector();
      const autoSigner = await createAutoSigner({ session: { sign: sessionKey.sign } });
      registerIpcHandlers({ collector, autoSigner });
      buildMenu();
      await createWindow();
      scheduleBackgroundChecks();

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
      });

      log.info('main process ready');
    } catch (err) {
      log.error({ err: String(err) }, 'main-process bootstrap failed');
      throw err;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
