/**
 * charging.ts - charging_state signal collector.
 *
 * Hybrid strategy: Electron `powerMonitor` fires events on plug/unplug within
 * ~500ms on Windows and macOS. We also run a 1s polling interval as a
 * belt-and-braces safeguard against missed events after suspend/resume.
 */

import type { ChargingState } from './types';

export interface PowerMonitorLike {
  on(
    event: 'on-ac' | 'on-battery' | 'shutdown' | 'suspend' | 'resume',
    listener: () => void,
  ): void;
  removeAllListeners?(event: string): void;
  isOnBatteryPower?: () => boolean;
}

export type ChargingListener = (state: ChargingState) => void;

export interface ChargingWatcherOptions {
  powerMonitor: PowerMonitorLike;
  /** Belt-and-braces poll cadence in ms. Default 1000. */
  pollIntervalMs?: number;
  onChange: ChargingListener;
}

export class ChargingWatcher {
  private readonly powerMonitor: PowerMonitorLike;
  private readonly pollIntervalMs: number;
  private readonly onChange: ChargingListener;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private last: ChargingState | null = null;

  constructor(opts: ChargingWatcherOptions) {
    this.powerMonitor = opts.powerMonitor;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.onChange = opts.onChange;
  }

  start(): void {
    this.powerMonitor.on('on-ac', () => this.emit('ac'));
    this.powerMonitor.on('on-battery', () => this.emit('battery'));

    // Seed + polling safety net.
    this.emit(this.readCurrent());
    this.pollHandle = setInterval(() => {
      this.emit(this.readCurrent());
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.powerMonitor.removeAllListeners?.('on-ac');
    this.powerMonitor.removeAllListeners?.('on-battery');
  }

  readCurrent(): ChargingState {
    if (typeof this.powerMonitor.isOnBatteryPower === 'function') {
      return this.powerMonitor.isOnBatteryPower() ? 'battery' : 'ac';
    }
    return this.last ?? 'ac';
  }

  /**
   * Exposed for the orchestrator's scheduled tick - returns the most recent
   * state without emitting.
   */
  current(): ChargingState {
    return this.last ?? this.readCurrent();
  }

  private emit(state: ChargingState): void {
    if (state !== this.last) {
      this.last = state;
      this.onChange(state);
    }
  }
}
