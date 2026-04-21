// electron-updater integration.
//
// Disabled in the pilot (unsigned Windows build, no published artifacts yet)
// but wired so that the Help > Check for Updates menu item and the app's
// periodic check compile today. Flip `ENABLED` to true once we publish
// signed artifacts to a release channel (GitHub Releases or an S3 bucket).

import { app, dialog } from 'electron';
import { getLogger } from './logger.js';

const ENABLED = false;

export interface CheckForUpdatesOpts {
  userInitiated: boolean;
}

export async function checkForUpdates(opts: CheckForUpdatesOpts): Promise<void> {
  const log = getLogger();
  if (!ENABLED) {
    log.info({ userInitiated: opts.userInitiated }, 'auto-update disabled in pilot');
    if (opts.userInitiated) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Updates',
        message: `Blink ${app.getVersion()}`,
        detail:
          'Auto-update is disabled in the pilot build. Install the latest .exe manually to upgrade.',
      });
    }
    return;
  }

  // Guarded dynamic import: `electron-updater` is only pulled in when
  // ENABLED flips, so bundled pilot builds don't pay the cost.
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = log as unknown as typeof autoUpdater.logger;
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', (info) => log.info({ info }, 'update-available'));
    autoUpdater.on('update-not-available', () => log.info('update-not-available'));
    autoUpdater.on('error', (err) => log.error({ err: String(err) }, 'updater error'));
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.warn({ err: String(err) }, 'updater unavailable');
  }
}

export function scheduleBackgroundChecks(): void {
  if (!ENABLED) return;
  // Placeholder for the signed-builds phase. Wave 3 wires a 6h interval.
}
