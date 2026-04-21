// Replay — /admin/replay
// Form: (policy_id, time_window, model_version).
// POST /admin/replay -> per-minute multiplier series + accrued delta table.

import { FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AdminApiError, runReplay } from './adminClient';
import type { ReplayRequest, ReplayResult } from './types';
import { fmtMultiplier, fmtTs, fmtUsdc } from './formatters';

interface OutletCtx {
  wallet: string;
}

export default function Replay() {
  const ctx = useOutletContext<OutletCtx>();
  const [form, setForm] = useState<ReplayRequest>({
    policy_id: '',
    window_start: '',
    window_end: '',
    model_version: 'v1.0.0',
  });
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setSubmitting(true);
    try {
      const r = await runReplay(ctx.wallet, form);
      setResult(r);
    } catch (err) {
      setError(
        err instanceof AdminApiError
          ? `HTTP ${err.status}: ${err.message}`
          : 'Replay failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="replay-page">
      <section className="bg-[#0e0e0e] border border-[#1a1a1a]">
        <div className="px-6 py-4 border-b border-[#1a1a1a]">
          <span className="text-xs uppercase tracking-widest text-[#666666]">
            Replay Configuration
          </span>
        </div>
        <form className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={onSubmit}>
          <Field label="Policy ID">
            <input
              required
              value={form.policy_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, policy_id: e.target.value }))
              }
              className="bg-[#141414] border border-[#1e1e1e] text-[#f0f0f0] font-dm-mono text-sm px-3 py-2 w-full focus:outline-none focus:border-[#e8a020]"
            />
          </Field>
          <Field label="Model Version">
            <input
              required
              value={form.model_version}
              onChange={(e) =>
                setForm((f) => ({ ...f, model_version: e.target.value }))
              }
              className="bg-[#141414] border border-[#1e1e1e] text-[#f0f0f0] font-dm-mono text-sm px-3 py-2 w-full focus:outline-none focus:border-[#e8a020]"
            />
          </Field>
          <Field label="Window Start (ISO)">
            <input
              required
              type="datetime-local"
              value={form.window_start}
              onChange={(e) =>
                setForm((f) => ({ ...f, window_start: e.target.value }))
              }
              className="bg-[#141414] border border-[#1e1e1e] text-[#f0f0f0] font-dm-mono text-sm px-3 py-2 w-full focus:outline-none focus:border-[#e8a020]"
            />
          </Field>
          <Field label="Window End (ISO)">
            <input
              required
              type="datetime-local"
              value={form.window_end}
              onChange={(e) =>
                setForm((f) => ({ ...f, window_end: e.target.value }))
              }
              className="bg-[#141414] border border-[#1e1e1e] text-[#f0f0f0] font-dm-mono text-sm px-3 py-2 w-full focus:outline-none focus:border-[#e8a020]"
            />
          </Field>
          <div className="md:col-span-2 flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#e8a020] text-[#080808] px-5 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
              data-testid="replay-submit"
            >
              {submitting ? 'Running...' : 'Run Replay'}
            </button>
            {error && (
              <span className="text-[#e05656] text-xs" role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
      </section>

      {result && <ResultView result={result} />}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-[#666666]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ResultView({ result }: { result: ReplayResult }) {
  const pos = result.minute_series.filter((m) => m.delta > 0).length;
  const neg = result.minute_series.filter((m) => m.delta < 0).length;
  return (
    <section
      className="bg-[#0e0e0e] border border-[#1a1a1a]"
      data-testid="replay-result"
    >
      <div className="px-6 py-4 border-b border-[#1a1a1a]">
        <span className="text-xs uppercase tracking-widest text-[#666666]">
          Replay Result
        </span>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kv label="Generated" value={fmtTs(result.generated_at)} />
          <Kv label="Minutes" value={result.minute_series.length.toString()} />
          <Kv label="Positive Δ" value={pos.toString()} />
          <Kv label="Negative Δ" value={neg.toString()} />
          <Kv
            label="Total Δ"
            value={`${fmtUsdc(result.total_accrued_delta_usdc, 6)} USDC`}
          />
        </div>
        <MultiplierChart result={result} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-dm-mono">
            <thead>
              <tr className="text-[#666666] uppercase tracking-widest border-b border-[#1a1a1a]">
                <th className="text-left py-2 pr-4 font-normal">TS</th>
                <th className="text-left py-2 pr-4 font-normal">Replay</th>
                <th className="text-left py-2 pr-4 font-normal">Actual</th>
                <th className="text-left py-2 pr-4 font-normal">Δ Multiplier</th>
                <th className="text-left py-2 pr-4 font-normal">Δ Accrued</th>
              </tr>
            </thead>
            <tbody>
              {result.minute_series.map((m, i) => (
                <tr key={i} className="border-b border-[#141414] text-[#cccccc]">
                  <td className="py-2 pr-4">{fmtTs(m.ts)}</td>
                  <td className="py-2 pr-4">{fmtMultiplier(m.multiplier_replay)}</td>
                  <td className="py-2 pr-4">{fmtMultiplier(m.multiplier_actual)}</td>
                  <td
                    className={`py-2 pr-4 ${
                      m.delta > 0
                        ? 'text-[#e8a020]'
                        : m.delta < 0
                          ? 'text-[#e05656]'
                          : ''
                    }`}
                  >
                    {m.delta >= 0 ? '+' : ''}
                    {m.delta.toFixed(3)}
                  </td>
                  <td className="py-2 pr-4">
                    {m.accrued_delta_usdc >= 0 ? '+' : ''}
                    {fmtUsdc(m.accrued_delta_usdc, 6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#141414] border border-[#1e1e1e] px-4 py-3">
      <div className="text-xs text-[#444444] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className="font-dm-mono text-sm text-[#f0f0f0]">{value}</div>
    </div>
  );
}

// MultiplierChart renders replay vs actual as a minimal SVG path so we avoid
// pulling recharts (or any runtime charting dep) into the admin bundle.
// The chart is intentionally simple: two polylines on a fixed viewBox. All
// data scaling is done inline so the SVG is deterministic for snapshots.
function MultiplierChart({ result }: { result: ReplayResult }) {
  const series = result.minute_series;
  if (series.length === 0) {
    return (
      <div
        className="bg-[#141414] border border-[#1e1e1e] px-4 py-6 text-xs text-[#555555] italic"
        data-testid="replay-chart-empty"
      >
        No replay minutes in the selected window.
      </div>
    );
  }

  // Viewbox uses simple integer coordinates; CSS scales to container width.
  const W = 640;
  const H = 160;
  const padX = 24;
  const padY = 12;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const all = series.flatMap((m) => [m.multiplier_replay, m.multiplier_actual]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const xFor = (i: number) =>
    series.length === 1
      ? padX + innerW / 2
      : padX + (i / (series.length - 1)) * innerW;
  const yFor = (v: number) => padY + innerH - ((v - min) / span) * innerH;

  const pathFor = (pick: (m: ReplayResult['minute_series'][number]) => number) =>
    series
      .map((m, i) => {
        const cmd = i === 0 ? 'M' : 'L';
        return `${cmd}${xFor(i).toFixed(2)},${yFor(pick(m)).toFixed(2)}`;
      })
      .join(' ');

  return (
    <div
      className="bg-[#141414] border border-[#1e1e1e] p-4"
      data-testid="replay-chart"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-[#666666]">
          Replay vs Actual Multiplier
        </span>
        <span className="font-dm-mono text-[10px] text-[#555555]">
          min {fmtMultiplier(min)} / max {fmtMultiplier(max)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40"
        role="img"
        aria-label="Replay multiplier series"
        data-testid="replay-chart-svg"
      >
        <rect x="0" y="0" width={W} height={H} fill="#0e0e0e" />
        <path
          d={pathFor((m) => m.multiplier_actual)}
          fill="none"
          stroke="#666666"
          strokeWidth="1.25"
          data-testid="replay-chart-actual"
        />
        <path
          d={pathFor((m) => m.multiplier_replay)}
          fill="none"
          stroke="#e8a020"
          strokeWidth="1.5"
          data-testid="replay-chart-replay"
        />
      </svg>
      <div className="flex gap-4 mt-2 text-[10px] text-[#666666] font-dm-mono">
        <span>
          <span
            className="inline-block w-3 h-[2px] align-middle mr-1"
            style={{ backgroundColor: '#e8a020' }}
          />
          replay
        </span>
        <span>
          <span
            className="inline-block w-3 h-[2px] align-middle mr-1"
            style={{ backgroundColor: '#666666' }}
          />
          actual
        </span>
      </div>
    </div>
  );
}
