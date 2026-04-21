/**
 * Cap-monitor: polls GET /settlement/status/:policyId and emits IPC events at
 *   - 80% cap consumption: `cap-warning`
 *   - 100% cap consumption: `cap-exhausted` (+ auto-signer halt)
 *   - <24h to expiry: `expiry-warning`
 *
 * The actual IPC transport is injected so unit tests can assert on emitted
 * events without Electron running. The prod wire-up (Agent C's scope) binds
 * `emit` to `mainWindow.webContents.send('auto-signer:event', ...)`.
 */
import type { CapMonitorEvent, PolicyAuthStatus } from './types';

export interface CapMonitorDeps {
  /** Fetch status from the backend. Typed for test injection. */
  fetchStatus(policyId: string): Promise<PolicyAuthStatus>;
  emit(event: CapMonitorEvent): void;
  now?: () => Date;
}

export interface CapMonitorConfig {
  warningRatio?: number; // default 0.8
  expiryWarningMs?: number; // default 24h
}

const DEFAULT_WARNING_RATIO = 0.8;
const DEFAULT_EXPIRY_WARNING_MS = 24 * 3600 * 1000;

export class CapMonitor {
  private readonly warnedOnce = new Set<string>();
  private readonly exhaustedOnce = new Set<string>();
  private readonly expiryWarnedOnce = new Set<string>();
  private readonly cfg: Required<CapMonitorConfig>;

  constructor(
    private readonly deps: CapMonitorDeps,
    cfg: CapMonitorConfig = {},
  ) {
    this.cfg = {
      warningRatio: cfg.warningRatio ?? DEFAULT_WARNING_RATIO,
      expiryWarningMs: cfg.expiryWarningMs ?? DEFAULT_EXPIRY_WARNING_MS,
    };
  }

  /** One-shot poll used by the interval runner and by tests. */
  async tick(policyId: string): Promise<CapMonitorEvent[]> {
    const status = await this.deps.fetchStatus(policyId);
    const emitted: CapMonitorEvent[] = [];
    const ratio = clamp(status.ratio, 0, 1);
    if (ratio >= 1 - 1e-9 && !this.exhaustedOnce.has(policyId)) {
      const ev: CapMonitorEvent = {
        kind: 'cap-exhausted',
        policyId,
        consumedUsdc: status.consumedUsdc,
        capUsdc: status.capUsdc,
      };
      this.deps.emit(ev);
      emitted.push(ev);
      this.exhaustedOnce.add(policyId);
    } else if (ratio >= this.cfg.warningRatio && !this.warnedOnce.has(policyId)) {
      const ev: CapMonitorEvent = {
        kind: 'cap-warning',
        policyId,
        consumedUsdc: status.consumedUsdc,
        capUsdc: status.capUsdc,
        ratio,
      };
      this.deps.emit(ev);
      emitted.push(ev);
      this.warnedOnce.add(policyId);
    }

    const now = (this.deps.now ?? (() => new Date()))();
    const validUntil = new Date(status.validUntil);
    const millisRemaining = validUntil.valueOf() - now.valueOf();
    if (millisRemaining > 0 && millisRemaining <= this.cfg.expiryWarningMs && !this.expiryWarnedOnce.has(policyId)) {
      const ev: CapMonitorEvent = {
        kind: 'expiry-warning',
        policyId,
        validUntil,
        millisRemaining,
      };
      this.deps.emit(ev);
      emitted.push(ev);
      this.expiryWarnedOnce.add(policyId);
    }

    return emitted;
  }

  /** Reset sticky flags (used after a re-authorization). */
  reset(policyId: string): void {
    this.warnedOnce.delete(policyId);
    this.exhaustedOnce.delete(policyId);
    this.expiryWarnedOnce.delete(policyId);
  }

  /** Check whether the auto-signer should pause for this policy. */
  shouldHalt(policyId: string): boolean {
    return this.exhaustedOnce.has(policyId);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
