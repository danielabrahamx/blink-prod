/**
 * In-process metrics aggregator for `/admin/metrics`. Full production
 * observability (structured logs, Grafana) is deferred to beta-10 per the
 * design doc. Until then, we expose a JSON snapshot.
 */

export interface LatencyHistogram {
  count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

class RollingSamples {
  private readonly samples: number[] = [];
  private readonly capacity: number;
  constructor(capacity = 1000) {
    this.capacity = capacity;
  }
  observe(value: number): void {
    if (this.samples.length >= this.capacity) this.samples.shift();
    this.samples.push(value);
  }
  snapshot(): LatencyHistogram {
    if (this.samples.length === 0) {
      return { count: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const q = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      count: sorted.length,
      p50_ms: q(0.5),
      p95_ms: q(0.95),
      p99_ms: q(0.99),
      max_ms: sorted[sorted.length - 1],
    };
  }
}

const state = {
  active_policies: 0,
  total_policies_ever: 0,
  total_multiplier_sum: 0,
  total_multiplier_n: 0,
  claim_queue_depth: 0,
  authorization_consumption_pct: 0,
  signal_latency: new RollingSamples(1000),
};

export function incActivePolicies(delta = 1): void {
  state.active_policies += delta;
  if (delta > 0) state.total_policies_ever += delta;
}

export function observeMultiplier(m: number): void {
  state.total_multiplier_sum += m;
  state.total_multiplier_n += 1;
}

export function observeSignalLatency(ms: number): void {
  state.signal_latency.observe(ms);
}

export function setClaimQueueDepth(n: number): void {
  state.claim_queue_depth = n;
}

export function setAuthorizationConsumptionPct(p: number): void {
  state.authorization_consumption_pct = p;
}

export function snapshot() {
  return {
    active_policies: state.active_policies,
    total_policies_ever: state.total_policies_ever,
    avg_multiplier:
      state.total_multiplier_n === 0
        ? null
        : state.total_multiplier_sum / state.total_multiplier_n,
    signal_latency_ms: state.signal_latency.snapshot(),
    claim_queue_depth: state.claim_queue_depth,
    authorization_consumption_pct: state.authorization_consumption_pct,
    generated_at: new Date().toISOString(),
  };
}

export function _resetForTests(): void {
  state.active_policies = 0;
  state.total_policies_ever = 0;
  state.total_multiplier_sum = 0;
  state.total_multiplier_n = 0;
  state.claim_queue_depth = 0;
  state.authorization_consumption_pct = 0;
  state.signal_latency = new RollingSamples(1000);
}
