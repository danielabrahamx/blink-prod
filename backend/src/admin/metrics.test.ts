import { describe, it, expect, beforeEach } from 'vitest';
import {
  incActivePolicies,
  observeMultiplier,
  observeSignalLatency,
  setClaimQueueDepth,
  setAuthorizationConsumptionPct,
  snapshot,
  _resetForTests,
} from './metrics.js';

describe('admin/metrics', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('default snapshot has zero state', () => {
    const s = snapshot();
    expect(s.active_policies).toBe(0);
    expect(s.avg_multiplier).toBeNull();
    expect(s.signal_latency_ms.count).toBe(0);
  });

  it('tracks counters', () => {
    incActivePolicies(2);
    incActivePolicies(1);
    expect(snapshot().active_policies).toBe(3);
    expect(snapshot().total_policies_ever).toBe(3);
    incActivePolicies(-1);
    expect(snapshot().active_policies).toBe(2);
    expect(snapshot().total_policies_ever).toBe(3);
  });

  it('averages multipliers', () => {
    observeMultiplier(1);
    observeMultiplier(2);
    observeMultiplier(3);
    expect(snapshot().avg_multiplier).toBeCloseTo(2);
  });

  it('computes latency histogram', () => {
    for (let i = 1; i <= 100; i += 1) observeSignalLatency(i);
    const h = snapshot().signal_latency_ms;
    expect(h.count).toBe(100);
    expect(h.p50_ms).toBeGreaterThan(40);
    expect(h.p95_ms).toBeGreaterThan(90);
    expect(h.max_ms).toBe(100);
  });

  it('bounds rolling window', () => {
    for (let i = 0; i < 2000; i += 1) observeSignalLatency(i);
    expect(snapshot().signal_latency_ms.count).toBe(1000);
  });

  it('tracks claim queue + authorization consumption', () => {
    setClaimQueueDepth(4);
    setAuthorizationConsumptionPct(0.37);
    const s = snapshot();
    expect(s.claim_queue_depth).toBe(4);
    expect(s.authorization_consumption_pct).toBeCloseTo(0.37);
  });
});
