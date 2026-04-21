/**
 * offline-queue.ts - FIFO SQLite-backed queue for signed envelopes.
 *
 * better-sqlite3 is synchronous. That is a feature, not a bug: envelope
 * enqueue is on the hot path (every 60s + every event) and we don't want to
 * pay a promise round-trip. The network flush runs in its own tick.
 *
 * Schema:
 *   queue(
 *     id         INTEGER PRIMARY KEY AUTOINCREMENT,
 *     nonce      TEXT UNIQUE NOT NULL,
 *     payload    TEXT NOT NULL,       -- JSON.stringify(SignedEnvelope)
 *     created_at INTEGER NOT NULL     -- ms since epoch
 *   )
 *
 * The backend dedupes by client_nonce regardless, but enforcing UNIQUE here
 * makes enqueue idempotent so a crash-restart cannot double-emit an envelope.
 */

import * as path from 'path';
import * as os from 'os';

import type { SignedEnvelope } from './types';

/**
 * Platform-appropriate default queue location.
 *
 * Windows: `%APPDATA%\Blink\offline-queue.db`
 * macOS:   `~/Library/Application Support/Blink/offline-queue.db`
 * Linux:   `$XDG_DATA_HOME/Blink/offline-queue.db` or `~/.local/share/Blink/offline-queue.db`
 *
 * Electron's `app.getPath('userData')` is the preferred source when running
 * inside Electron. This helper is only used for headless tests and for the
 * rare case where the main process bootstraps the queue before Electron
 * `app` is ready.
 */
export function defaultQueuePath(): string {
  const appName = 'Blink';
  const fileName = 'offline-queue.db';
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, appName, fileName);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName, fileName);
  }
  const xdg = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, appName, fileName);
}

type BetterSqliteDB = {
  exec(sql: string): void;
  prepare(sql: string): {
    run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
  close(): void;
};

type BetterSqliteCtor = new (path: string, opts?: { readonly?: boolean }) => BetterSqliteDB;

let cachedCtor: BetterSqliteCtor | null = null;

function loadBetterSqlite(): BetterSqliteCtor {
  if (cachedCtor) return cachedCtor;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedCtor = require('better-sqlite3') as BetterSqliteCtor;
  return cachedCtor;
}

export interface QueueRow {
  id: number;
  nonce: string;
  signed: SignedEnvelope;
  created_at: number;
}

export class OfflineQueue {
  private readonly db: BetterSqliteDB;

  constructor(dbPath: string, ctorOverride?: BetterSqliteCtor) {
    const Ctor = ctorOverride ?? loadBetterSqlite();
    this.db = new Ctor(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nonce TEXT UNIQUE NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_created_at ON queue(created_at);
    `);
  }

  enqueue(signed: SignedEnvelope): boolean {
    const nonce = signed.envelope.client_nonce;
    const payload = JSON.stringify(signed);
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO queue(nonce, payload, created_at) VALUES (?, ?, ?)',
    );
    const result = stmt.run(nonce, payload, Date.now());
    return result.changes === 1;
  }

  /** Peek at up to `limit` rows in FIFO order without removing them. */
  peek(limit: number): QueueRow[] {
    const rows = this.db
      .prepare('SELECT id, nonce, payload, created_at FROM queue ORDER BY id ASC LIMIT ?')
      .all(limit) as Array<{ id: number; nonce: string; payload: string; created_at: number }>;
    return rows.map((r) => ({
      id: r.id,
      nonce: r.nonce,
      signed: JSON.parse(r.payload) as SignedEnvelope,
      created_at: r.created_at,
    }));
  }

  deleteById(id: number): void {
    this.db.prepare('DELETE FROM queue WHERE id = ?').run(id);
  }

  size(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM queue').get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Flush in FIFO order. `send` is the network call; on success the row is
   * deleted, on failure the loop stops so we preserve order on the next
   * attempt. Returns the number successfully flushed.
   */
  async flush(
    send: (signed: SignedEnvelope) => Promise<boolean>,
    batchSize = 50,
  ): Promise<number> {
    let flushed = 0;
    while (true) {
      const rows = this.peek(batchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        let ok = false;
        try {
          ok = await send(row.signed);
        } catch {
          ok = false;
        }
        if (!ok) return flushed;
        this.deleteById(row.id);
        flushed += 1;
      }
    }
    return flushed;
  }
}
