import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SignalCollector, type Transport } from '../src/signal-collector/collector';
import { generateDeviceKey } from '../src/signal-collector/envelope';
import { OfflineQueue } from '../src/signal-collector/offline-queue';
import type { ClientSignals, SignedEnvelope } from '../src/signal-collector/types';

function makeSnapshot(partial: Partial<ClientSignals> = {}): () => Promise<ClientSignals> {
  const base: ClientSignals = {
    wifi_trust: 'home',
    charging_state: 'ac',
    lid_state: 'open',
    app_category: 'productivity',
    input_idle_flag: false,
    battery_health_pct: 90,
  };
  return async () => ({ ...base, ...partial });
}

function makeTransport(result: boolean | 'throw' = true) {
  const sent: SignedEnvelope[] = [];
  const transport: Transport = {
    async send(signed) {
      sent.push(signed);
      if (result === 'throw') throw new Error('net');
      return result;
    },
  };
  return { transport, sent };
}

describe('SignalCollector', () => {
  it('scheduled tick builds + signs + sends an envelope', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'blink-col-'));
    const queue = new OfflineQueue(join(tmp, 'q.db'));
    const key = generateDeviceKey();
    const { transport, sent } = makeTransport(true);
    let nonceCounter = 0;
    const c = new SignalCollector({
      policy_id: 'pol_x',
      deviceKey: key,
      transport,
      offlineQueue: queue,
      snapshot: makeSnapshot(),
      nonce: () => `n-${++nonceCounter}`,
      now: () => new Date('2026-04-21T12:00:00Z'),
    });
    vi.useFakeTimers();
    c.start();
    await vi.runOnlyPendingTimersAsync();
    c.stop();
    vi.useRealTimers();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].envelope.trigger).toBe('scheduled');
    expect(sent[0].envelope.policy_id).toBe('pol_x');
    expect(sent[0].envelope.signals.wifi_trust).toBe('home');
    queue.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('enqueues to SQLite on send failure', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'blink-col-'));
    const queue = new OfflineQueue(join(tmp, 'q.db'));
    const key = generateDeviceKey();
    const { transport } = makeTransport(false);
    const c = new SignalCollector({
      policy_id: 'pol_x',
      deviceKey: key,
      transport,
      offlineQueue: queue,
      snapshot: makeSnapshot(),
      nonce: () => 'n-fail',
      now: () => new Date('2026-04-21T12:00:00Z'),
    });
    vi.useFakeTimers();
    c.start();
    await vi.runOnlyPendingTimersAsync();
    c.stop();
    vi.useRealTimers();
    expect(queue.size()).toBe(1);
    queue.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('event notifications flush within 500ms and debounce within 5s', async () => {
    vi.useFakeTimers();
    const tmp = mkdtempSync(join(tmpdir(), 'blink-col-'));
    const queue = new OfflineQueue(join(tmp, 'q.db'));
    const key = generateDeviceKey();
    const { transport, sent } = makeTransport(true);
    let nonceCounter = 0;
    let wall = new Date('2026-04-21T12:00:00Z').getTime();
    const c = new SignalCollector({
      policy_id: 'pol_x',
      deviceKey: key,
      transport,
      offlineQueue: queue,
      snapshot: makeSnapshot(),
      nonce: () => `n-${++nonceCounter}`,
      now: () => new Date(wall),
      scheduledIntervalMs: 1_000_000,
    });
    c.start();
    // Drain the initial scheduled tick that fires immediately.
    await vi.runOnlyPendingTimersAsync();
    const beforeEventCount = sent.length;
    // Fire first event.
    c.notifyEvent('charging_state');
    wall += 500;
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.length).toBe(beforeEventCount + 1);
    expect(sent[sent.length - 1].envelope.trigger).toBe('event');
    expect(sent[sent.length - 1].envelope.event_signal).toBe('charging_state');
    // Rapid second event within debounce window should be dropped.
    c.notifyEvent('lid_state');
    wall += 500;
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.length).toBe(beforeEventCount + 1);
    c.stop();
    vi.useRealTimers();
    queue.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('flushOfflineQueue drains accumulated envelopes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'blink-col-'));
    const queue = new OfflineQueue(join(tmp, 'q.db'));
    const key = generateDeviceKey();
    const { transport, sent } = makeTransport(true);
    const c = new SignalCollector({
      policy_id: 'pol_x',
      deviceKey: key,
      transport,
      offlineQueue: queue,
      snapshot: makeSnapshot(),
      nonce: (() => {
        let i = 0;
        return () => `nn-${++i}`;
      })(),
    });
    // Seed the queue directly.
    queue.enqueue({
      envelope: {
        schema_version: '1.0',
        policy_id: 'pol_x',
        client_ts: '2026-04-21T11:00:00Z',
        client_nonce: 'seed-1',
        trigger: 'scheduled',
        event_signal: null,
        signals: {
          wifi_trust: 'home',
          charging_state: 'ac',
          lid_state: 'open',
          app_category: 'productivity',
          input_idle_flag: false,
          battery_health_pct: 90,
        },
      },
      signature: 'deadbeef',
      public_key: 'cafebabe',
    });
    expect(queue.size()).toBe(1);
    const flushed = await c.flushOfflineQueue();
    expect(flushed).toBe(1);
    expect(queue.size()).toBe(0);
    expect(sent[sent.length - 1].envelope.client_nonce).toBe('seed-1');
    queue.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});
