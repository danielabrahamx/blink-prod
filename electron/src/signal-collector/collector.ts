/**
 * collector.ts - the signal collector orchestrator.
 *
 * Responsibilities:
 *   - 60s scheduled tick that samples all signals and emits a signed envelope
 *     (trigger: 'scheduled').
 *   - Event-driven ticks on charging/lid/wifi/idle transitions that emit
 *     within 500ms (trigger: 'event').
 *   - Debounces back-to-back events within 5s into one envelope.
 *   - Hands envelopes to the transport layer; on failure hands them to the
 *     offline queue.
 *   - On reconnect, flushes the queue in FIFO order with trigger:
 *     'resume-from-offline'.
 */

import { randomUUID } from 'crypto';

import type {
  ChargingState,
  ClientSignals,
  Envelope,
  EventSignal,
  LidState,
  SignedEnvelope,
  Trigger,
  WifiTrust,
} from './types';
import { signEnvelope, type DeviceKey } from './envelope';
import type { OfflineQueue } from './offline-queue';

const ONE_MINUTE_MS = 60_000;
const EVENT_FLUSH_DELAY_MS = 500;
const EVENT_DEBOUNCE_MS = 5_000;

export interface Transport {
  /** Returns true on 2xx, false on any failure (network, server, 409, etc). */
  send(signed: SignedEnvelope): Promise<boolean>;
}

export interface CollectorOptions {
  policy_id: string;
  deviceKey: DeviceKey;
  transport: Transport;
  offlineQueue: OfflineQueue;
  /** Snapshot providers - orchestrator pulls current values at tick time. */
  snapshot: () => Promise<ClientSignals>;
  /** Clock injection for tests. */
  now?: () => Date;
  /** uuid-v7 or uuid-v4 generator (tests stub for determinism). */
  nonce?: () => string;
  /** Scheduled tick override (default 60s). */
  scheduledIntervalMs?: number;
}

export class SignalCollector {
  private readonly policy_id: string;
  private readonly deviceKey: DeviceKey;
  private readonly transport: Transport;
  private readonly queue: OfflineQueue;
  private readonly snapshot: () => Promise<ClientSignals>;
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private readonly scheduledIntervalMs: number;

  private scheduledTimer: ReturnType<typeof setInterval> | null = null;
  private pendingEventTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEventSignal: EventSignal = null;
  private lastEventAt = 0;
  private running = false;

  constructor(opts: CollectorOptions) {
    this.policy_id = opts.policy_id;
    this.deviceKey = opts.deviceKey;
    this.transport = opts.transport;
    this.queue = opts.offlineQueue;
    this.snapshot = opts.snapshot;
    this.now = opts.now ?? (() => new Date());
    this.nonce = opts.nonce ?? (() => randomUUID());
    this.scheduledIntervalMs = opts.scheduledIntervalMs ?? ONE_MINUTE_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Tick once immediately so the server has a baseline, then every 60s.
    void this.tickScheduled();
    this.scheduledTimer = setInterval(() => void this.tickScheduled(), this.scheduledIntervalMs);
  }

  stop(): void {
    if (this.scheduledTimer) clearInterval(this.scheduledTimer);
    if (this.pendingEventTimer) clearTimeout(this.pendingEventTimer);
    this.scheduledTimer = null;
    this.pendingEventTimer = null;
    this.running = false;
  }

  /**
   * Notify the orchestrator that an event-relevant signal just changed.
   * Within EVENT_FLUSH_DELAY_MS we will emit an event envelope, debounced
   * against any other event that fired within EVENT_DEBOUNCE_MS of the first.
   */
  notifyEvent(signal: EventSignal): void {
    const nowMs = this.now().getTime();
    // Debounce: if an event is already queued and we saw a previous event
    // within 5s, coalesce.
    if (this.pendingEventTimer) {
      // Keep the earliest signal to preserve causality in the envelope.
      return;
    }
    if (nowMs - this.lastEventAt < EVENT_DEBOUNCE_MS) {
      // Too soon since last event envelope - fold into next scheduled tick.
      return;
    }
    this.pendingEventSignal = signal;
    this.pendingEventTimer = setTimeout(() => {
      this.pendingEventTimer = null;
      void this.tickEvent(this.pendingEventSignal);
      this.pendingEventSignal = null;
      this.lastEventAt = this.now().getTime();
    }, EVENT_FLUSH_DELAY_MS);
  }

  /** Force a flush of the offline queue (e.g. after network-up). */
  async flushOfflineQueue(): Promise<number> {
    return this.queue.flush((signed) => this.transport.send(signed));
  }

  private async tickScheduled(): Promise<void> {
    await this.tick('scheduled', null);
  }

  private async tickEvent(event: EventSignal): Promise<void> {
    await this.tick('event', event);
  }

  private async tick(trigger: Trigger, event: EventSignal): Promise<void> {
    let snapshot: ClientSignals;
    try {
      snapshot = await this.snapshot();
    } catch {
      // Snapshot failed - skip this tick rather than send garbage.
      return;
    }
    const envelope = this.buildEnvelope(trigger, event, snapshot);
    const signed = signEnvelope(envelope, this.deviceKey);

    let delivered = false;
    try {
      delivered = await this.transport.send(signed);
    } catch {
      delivered = false;
    }
    if (!delivered) {
      this.queue.enqueue(signed);
      return;
    }
    // Network worked - try to drain anything that accumulated during the
    // outage. Fire-and-forget so we don't block the scheduled tick.
    void this.queue.flush((s) => this.transport.send(s));
  }

  private buildEnvelope(
    trigger: Trigger,
    event: EventSignal,
    signals: ClientSignals,
  ): Envelope {
    return {
      schema_version: '1.0',
      policy_id: this.policy_id,
      client_ts: this.now().toISOString(),
      client_nonce: this.nonce(),
      trigger,
      event_signal: event,
      signals,
    };
  }
}

/**
 * Convenience factory that wires signal event sources to the collector.
 * The main process calls this once from app.ready().
 */
export function wireEventSources(
  collector: SignalCollector,
  subscribe: {
    onChargingChange: (fn: (state: ChargingState) => void) => void;
    onLidChange: (fn: (state: LidState) => void) => void;
    onWifiChange: (fn: (trust: WifiTrust) => void) => void;
    onIdleChange: (fn: (idle: boolean) => void) => void;
  },
): void {
  subscribe.onChargingChange(() => collector.notifyEvent('charging_state'));
  subscribe.onLidChange(() => collector.notifyEvent('lid_state'));
  subscribe.onWifiChange(() => collector.notifyEvent('wifi_trust'));
  subscribe.onIdleChange(() => collector.notifyEvent('input_idle_flag'));
}
