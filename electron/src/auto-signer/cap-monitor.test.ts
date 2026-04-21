import { describe, expect, it, vi } from 'vitest';
import { CapMonitor } from './cap-monitor';
import type { PolicyAuthStatus, CapMonitorEvent } from './types';

function status(overrides: Partial<PolicyAuthStatus>): PolicyAuthStatus {
  return {
    policyId: 'pol-1',
    authId: 'auth-1',
    capUsdc: '50.000000',
    consumedUsdc: '0.000000',
    ratio: 0,
    validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    revoked: false,
    receiptsPending: 0,
    receiptsConfirmed: 0,
    ...overrides,
  };
}

describe('CapMonitor', () => {
  it('emits cap-warning at 80% consumption (once)', async () => {
    const emits: CapMonitorEvent[] = [];
    const monitor = new CapMonitor({
      fetchStatus: vi.fn().mockResolvedValue(status({ consumedUsdc: '40.000000', ratio: 0.8 })),
      emit: (e) => emits.push(e),
    });
    await monitor.tick('pol-1');
    expect(emits.find((e) => e.kind === 'cap-warning')).toBeTruthy();
    // second tick is deduplicated
    await monitor.tick('pol-1');
    const warnings = emits.filter((e) => e.kind === 'cap-warning');
    expect(warnings.length).toBe(1);
  });

  it('emits cap-exhausted at 100% and sets halt flag', async () => {
    const emits: CapMonitorEvent[] = [];
    const monitor = new CapMonitor({
      fetchStatus: vi.fn().mockResolvedValue(status({ consumedUsdc: '50.000000', ratio: 1 })),
      emit: (e) => emits.push(e),
    });
    await monitor.tick('pol-1');
    expect(emits.some((e) => e.kind === 'cap-exhausted')).toBe(true);
    expect(monitor.shouldHalt('pol-1')).toBe(true);
  });

  it('emits expiry-warning within 24h of expiry', async () => {
    const emits: CapMonitorEvent[] = [];
    const monitor = new CapMonitor({
      fetchStatus: vi.fn().mockResolvedValue(status({ validUntil: new Date(Date.now() + 3600_000).toISOString() })),
      emit: (e) => emits.push(e),
    });
    await monitor.tick('pol-1');
    expect(emits.find((e) => e.kind === 'expiry-warning')).toBeTruthy();
  });

  it('reset clears sticky flags so re-authorization resumes warnings', async () => {
    const emits: CapMonitorEvent[] = [];
    const monitor = new CapMonitor({
      fetchStatus: vi.fn().mockResolvedValue(status({ consumedUsdc: '50.000000', ratio: 1 })),
      emit: (e) => emits.push(e),
    });
    await monitor.tick('pol-1');
    monitor.reset('pol-1');
    await monitor.tick('pol-1');
    const exhausted = emits.filter((e) => e.kind === 'cap-exhausted');
    expect(exhausted.length).toBe(2);
  });

  it('does not emit warnings below the threshold', async () => {
    const emits: CapMonitorEvent[] = [];
    const monitor = new CapMonitor({
      fetchStatus: vi.fn().mockResolvedValue(status({ consumedUsdc: '20.000000', ratio: 0.4 })),
      emit: (e) => emits.push(e),
    });
    await monitor.tick('pol-1');
    expect(emits.filter((e) => e.kind === 'cap-warning').length).toBe(0);
  });
});
