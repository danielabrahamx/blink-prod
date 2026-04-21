import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OfflineQueue, defaultQueuePath } from '../src/signal-collector/offline-queue';
import {
  signEnvelope,
  generateDeviceKey,
  type DeviceKey,
} from '../src/signal-collector/envelope';
import type { Envelope, SignedEnvelope } from '../src/signal-collector/types';

function mkEnvelope(nonce: string): Envelope {
  return {
    schema_version: '1.0',
    policy_id: 'pol_test',
    client_ts: new Date().toISOString(),
    client_nonce: nonce,
    trigger: 'scheduled',
    event_signal: null,
    signals: {
      wifi_trust: 'home',
      charging_state: 'ac',
      lid_state: 'open',
      app_category: 'productivity',
      input_idle_flag: false,
      battery_health_pct: 95,
    },
  };
}

describe('OfflineQueue', () => {
  let tmp: string;
  let dbPath: string;
  let queue: OfflineQueue;
  let key: DeviceKey;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'blink-queue-'));
    dbPath = join(tmp, 'queue.db');
    queue = new OfflineQueue(dbPath);
    key = generateDeviceKey();
  });

  afterEach(() => {
    queue.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('enqueue + size', () => {
    expect(queue.size()).toBe(0);
    expect(queue.enqueue(signEnvelope(mkEnvelope('n1'), key))).toBe(true);
    expect(queue.size()).toBe(1);
  });

  it('enqueue dedupes on nonce', () => {
    const signed = signEnvelope(mkEnvelope('nDup'), key);
    expect(queue.enqueue(signed)).toBe(true);
    expect(queue.enqueue(signed)).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it('peek returns FIFO order', () => {
    queue.enqueue(signEnvelope(mkEnvelope('a'), key));
    queue.enqueue(signEnvelope(mkEnvelope('b'), key));
    queue.enqueue(signEnvelope(mkEnvelope('c'), key));
    const rows = queue.peek(10);
    expect(rows.map((r) => r.signed.envelope.client_nonce)).toEqual(['a', 'b', 'c']);
  });

  it('flush removes rows on successful send', async () => {
    queue.enqueue(signEnvelope(mkEnvelope('a'), key));
    queue.enqueue(signEnvelope(mkEnvelope('b'), key));
    const sent: string[] = [];
    const flushed = await queue.flush(async (s: SignedEnvelope) => {
      sent.push(s.envelope.client_nonce);
      return true;
    });
    expect(flushed).toBe(2);
    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('flush preserves order when send fails mid-batch', async () => {
    queue.enqueue(signEnvelope(mkEnvelope('a'), key));
    queue.enqueue(signEnvelope(mkEnvelope('b'), key));
    queue.enqueue(signEnvelope(mkEnvelope('c'), key));
    let count = 0;
    const flushed = await queue.flush(async () => {
      count += 1;
      return count <= 1;
    });
    expect(flushed).toBe(1);
    expect(queue.size()).toBe(2);
    const rows = queue.peek(10);
    expect(rows.map((r) => r.signed.envelope.client_nonce)).toEqual(['b', 'c']);
  });

  it('flush handles throw as failure', async () => {
    queue.enqueue(signEnvelope(mkEnvelope('a'), key));
    const flushed = await queue.flush(async () => {
      throw new Error('network down');
    });
    expect(flushed).toBe(0);
    expect(queue.size()).toBe(1);
  });

  it('survives restart - rows persist across reopening the DB', () => {
    queue.enqueue(signEnvelope(mkEnvelope('persist-1'), key));
    queue.enqueue(signEnvelope(mkEnvelope('persist-2'), key));
    queue.close();
    const reopened = new OfflineQueue(dbPath);
    try {
      expect(reopened.size()).toBe(2);
      expect(reopened.peek(10).map((r) => r.signed.envelope.client_nonce)).toEqual([
        'persist-1',
        'persist-2',
      ]);
    } finally {
      reopened.close();
    }
    // Re-open the original handle so afterEach close() is a no-op on a valid
    // connection. Easier than conditional teardown.
    queue = new OfflineQueue(dbPath);
  });
});

describe('defaultQueuePath', () => {
  it('returns a path ending in Blink/offline-queue.db', () => {
    const p = defaultQueuePath();
    // Uses OS path separator, normalise for the assertion.
    const normalised = p.replace(/\\/g, '/');
    expect(normalised).toMatch(/\/Blink\/offline-queue\.db$/);
  });

  it('is absolute', () => {
    const p = defaultQueuePath();
    // Windows absolute paths start with a drive letter, POSIX with '/'.
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
    expect(isAbsolute).toBe(true);
  });
});
