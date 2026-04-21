// MetricsPanel — /admin/metrics
// Consumes GET /admin/metrics (JSON). Renders a simple table of pilot metrics.
// No emoji icons anywhere.

import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AdminApiError, getMetrics } from './adminClient';
import type { AdminMetrics } from './types';
import { fmtMs, fmtMultiplier, fmtPct, fmtTs } from './formatters';

interface OutletCtx {
  wallet: string;
}

export default function MetricsPanel() {
  const ctx = useOutletContext<OutletCtx>();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  async function refresh(wallet: string) {
    setLoading(true);
    setError('');
    try {
      const m = await getMetrics(wallet);
      setMetrics(m);
    } catch (e) {
      setError(
        e instanceof AdminApiError
          ? `HTTP ${e.status}: ${e.message}`
          : 'Metrics fetch failed',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ctx.wallet) refresh(ctx.wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.wallet]);

  return (
    <div className="space-y-3" data-testid="metrics-panel">
      <section className="bg-[#0e0e0e] border border-[#1a1a1a]">
        <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-[#666666]">
            Pilot Metrics
          </span>
          <button
            onClick={() => ctx.wallet && refresh(ctx.wallet)}
            disabled={loading}
            className="text-[#666666] hover:text-[#f0f0f0] text-xs uppercase tracking-widest"
            data-testid="metrics-refresh"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="p-6">
          {error && (
            <div className="text-[#e05656] text-xs mb-4" role="alert">
              {error}
            </div>
          )}
          {metrics ? (
            <MetricsTable metrics={metrics} />
          ) : (
            !loading && (
              <div className="text-xs text-[#555555] italic">
                No metrics available.
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}

function MetricsTable({ metrics }: { metrics: AdminMetrics }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Generated at', value: fmtTs(metrics.generated_at) },
    { label: 'Active policies', value: metrics.active_policies.toString() },
    { label: 'Avg multiplier', value: fmtMultiplier(metrics.avg_multiplier) },
    { label: 'Ingest latency p50', value: fmtMs(metrics.ingest_latency_ms.p50) },
    { label: 'Ingest latency p95', value: fmtMs(metrics.ingest_latency_ms.p95) },
    { label: 'Ingest latency p99', value: fmtMs(metrics.ingest_latency_ms.p99) },
    { label: 'Claim queue depth', value: metrics.claim_queue_depth.toString() },
    {
      label: 'Authorization consumption',
      value: fmtPct(metrics.authorization_consumption_pct, 2),
    },
  ];
  return (
    <table className="w-full text-xs font-dm-mono" data-testid="metrics-table">
      <thead>
        <tr className="text-[#666666] uppercase tracking-widest border-b border-[#1a1a1a]">
          <th className="text-left py-2 pr-4 font-normal">Metric</th>
          <th className="text-left py-2 pr-4 font-normal">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.label}
            className="border-b border-[#141414] text-[#cccccc]"
          >
            <td className="py-2 pr-4 text-[#888888]">{r.label}</td>
            <td className="py-2 pr-4 text-[#f0f0f0]">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
