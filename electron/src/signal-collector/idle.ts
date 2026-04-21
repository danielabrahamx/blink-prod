/**
 * idle.ts - input_idle_flag signal collector.
 *
 * Thin wrapper over `powerMonitor.getSystemIdleTime()` (which returns seconds).
 * Threshold is 120s per the design doc. No prompts on any platform:
 * macOS uses CGEventSourceSecondsSinceLastEventType, Windows uses
 * GetLastInputInfo.
 */

export interface PowerMonitorForIdle {
  getSystemIdleTime(): number;
}

export const DEFAULT_IDLE_THRESHOLD_SECONDS = 120;

export function sampleIdle(
  powerMonitor: PowerMonitorForIdle,
  thresholdSeconds: number = DEFAULT_IDLE_THRESHOLD_SECONDS,
): boolean {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  return idleSeconds >= thresholdSeconds;
}

/**
 * Tracks idle transitions so the orchestrator can fire event envelopes on
 * active -> idle and idle -> active changes.
 */
export class IdleWatcher {
  private readonly powerMonitor: PowerMonitorForIdle;
  private readonly thresholdSeconds: number;
  private readonly onChange: (idle: boolean) => void;
  private lastIdle = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    powerMonitor: PowerMonitorForIdle,
    onChange: (idle: boolean) => void,
    thresholdSeconds: number = DEFAULT_IDLE_THRESHOLD_SECONDS,
  ) {
    this.powerMonitor = powerMonitor;
    this.thresholdSeconds = thresholdSeconds;
    this.onChange = onChange;
  }

  start(pollMs = 5000): void {
    const tick = () => {
      const idle = sampleIdle(this.powerMonitor, this.thresholdSeconds);
      if (idle !== this.lastIdle) {
        this.lastIdle = idle;
        this.onChange(idle);
      }
    };
    tick();
    this.timer = setInterval(tick, pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  current(): boolean {
    return this.lastIdle;
  }
}
