/**
 * lid.ts - lid_state signal collector (Windows heuristic).
 *
 * Electron does not expose a native lid-state API, and Windows has no simple
 * JS binding for GUID_LIDSWITCH_STATE_CHANGE. Until a native sidecar ships in
 * the friendly-beta phase, we combine four proxy signals and declare
 * `lid_state: closed` when three of four fire within a 5s window.
 *
 * Proxies:
 *   1. `powerMonitor.on('lock-screen')` - laptop locked.
 *   2. `screen.getAllDisplays().filter(d => d.internal).length === 0` -
 *      internal display turned off.
 *   3. `getSystemIdleTime()` spikes past threshold within 2s.
 *   4. A charging-state change (user often unplugs then closes lid).
 *
 * The inverse pattern (unlock / internal display back on / low idle time /
 * charging change) flips to `open`. Starting state is `open`.
 *
 * False positives are expected - this is a demo-grade heuristic. The beta
 * plan is to replace with a Win32 helper registered against
 * RegisterPowerSettingNotification(GUID_LIDSWITCH_STATE_CHANGE).
 */

import type { LidState } from './types';

export interface PowerMonitorForLid {
  on(event: 'lock-screen' | 'unlock-screen', listener: () => void): void;
  getSystemIdleTime?(): number;
  removeAllListeners?(event: string): void;
}

export interface ScreenForLid {
  getAllDisplays(): Array<{ internal?: boolean; id?: number }>;
}

export type LidListener = (state: LidState) => void;

export interface LidWatcherOptions {
  powerMonitor: PowerMonitorForLid;
  screen: ScreenForLid;
  /** Observation window in ms. 3 of 4 within this window => closed. */
  windowMs?: number;
  /** Idle-time jump in seconds that counts as a "spike". Default 60. */
  idleSpikeSeconds?: number;
  /** Clock injection for tests. */
  now?: () => number;
  onChange: LidListener;
  /** External notification that charging state changed (wired from ChargingWatcher). */
  onChargingChangeHook?: (handler: () => void) => void;
}

type ProxyKey = 'lock' | 'internal_off' | 'idle_spike' | 'charging_change';

export class LidWatcher {
  private readonly powerMonitor: PowerMonitorForLid;
  private readonly screen: ScreenForLid;
  private readonly windowMs: number;
  private readonly idleSpikeSeconds: number;
  private readonly now: () => number;
  private readonly onChange: LidListener;
  private readonly onChargingChangeHook: ((handler: () => void) => void) | undefined;
  private readonly hits: Map<ProxyKey, number> = new Map();
  private lastIdle = 0;
  private last: LidState = 'open';
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private displayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: LidWatcherOptions) {
    this.powerMonitor = opts.powerMonitor;
    this.screen = opts.screen;
    this.windowMs = opts.windowMs ?? 5000;
    this.idleSpikeSeconds = opts.idleSpikeSeconds ?? 60;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.onChargingChangeHook = opts.onChargingChangeHook;
  }

  start(): void {
    this.powerMonitor.on('lock-screen', () => this.recordProxy('lock', 'closed'));
    this.powerMonitor.on('unlock-screen', () => this.recordProxy('lock', 'open'));

    this.idleTimer = setInterval(() => this.sampleIdle(), 2000);
    this.displayTimer = setInterval(() => this.sampleDisplays(), 2000);

    if (this.onChargingChangeHook) {
      this.onChargingChangeHook(() => this.recordProxy('charging_change', 'closed'));
    }
  }

  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.displayTimer) clearInterval(this.displayTimer);
    this.powerMonitor.removeAllListeners?.('lock-screen');
    this.powerMonitor.removeAllListeners?.('unlock-screen');
  }

  current(): LidState {
    return this.last;
  }

  /**
   * Public hook so the orchestrator can forward charging events. Marks a
   * charging-change proxy hit.
   */
  noteChargingChange(): void {
    this.recordProxy('charging_change', 'closed');
  }

  private sampleIdle(): void {
    const idle = this.powerMonitor.getSystemIdleTime?.() ?? 0;
    const prev = this.lastIdle;
    this.lastIdle = idle;
    // Jump past threshold within the 2s sample => spike.
    if (prev < this.idleSpikeSeconds && idle >= this.idleSpikeSeconds) {
      this.recordProxy('idle_spike', 'closed');
    }
    // Sharp drop => activity resumed, suggests lid opening.
    if (prev >= this.idleSpikeSeconds && idle < 2) {
      this.recordProxy('idle_spike', 'open');
    }
  }

  private sampleDisplays(): void {
    const displays = this.screen.getAllDisplays();
    const internalActive = displays.some((d) => d.internal === true);
    if (!internalActive) {
      this.recordProxy('internal_off', 'closed');
    } else {
      this.recordProxy('internal_off', 'open');
    }
  }

  private recordProxy(key: ProxyKey, towards: LidState): void {
    const now = this.now();
    // We keep timestamps by proxy so that the same proxy firing twice does
    // not trivially satisfy 3-of-4.
    const stamp = towards === 'closed' ? now : -now;
    this.hits.set(key, stamp);
    this.evaluate();
  }

  private evaluate(): void {
    const now = this.now();
    let closedHits = 0;
    let openHits = 0;
    for (const [, stamp] of this.hits) {
      const ts = Math.abs(stamp);
      if (now - ts > this.windowMs) continue;
      if (stamp > 0) closedHits += 1;
      else openHits += 1;
    }
    let next: LidState = this.last;
    if (closedHits >= 3) next = 'closed';
    else if (openHits >= 3) next = 'open';
    if (next !== this.last) {
      this.last = next;
      this.onChange(next);
    }
  }
}
