// Structured logger for the main process.
// Writes JSON lines to %APPDATA%\Blink\logs\main.log (Roaming app data on
// Windows) AND echoes human-readable output to stdout during dev.

import { app } from 'electron';
import pino, { type Logger } from 'pino';
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';

let cached: Logger | null = null;

function logFilePath(): string {
  // `app.getPath('logs')` resolves to `%APPDATA%\Blink\logs` on Windows
  // once `app.setName()` runs before app.ready. Electron default is
  // `%APPDATA%\<appName>\logs` which matches the handoff spec.
  const dir = app.getPath('logs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'main.log');
}

export function getLogger(): Logger {
  if (cached) return cached;
  const isDev = !app.isPackaged;
  const stream = createWriteStream(logFilePath(), { flags: 'a' });
  cached = pino(
    {
      level: isDev ? 'debug' : 'info',
      base: { pid: process.pid, app: 'blink-electron', version: app.getVersion() },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    // Multistream: file always, stdout in dev.
    isDev ? pino.multistream([{ stream }, { stream: process.stdout }]) : stream,
  );
  return cached;
}
