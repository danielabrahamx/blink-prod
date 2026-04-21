// PolicyExport — /admin/export and /admin/export/:id
// Simple CSV export button per policy. Hits GET /admin/export/:id and
// triggers a browser download.

import { FormEvent, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { AdminApiError, downloadPolicyCsv } from './adminClient';

interface OutletCtx {
  wallet: string;
}

export default function PolicyExport() {
  const ctx = useOutletContext<OutletCtx>();
  const { id: routeId } = useParams<{ id: string }>();
  const [policyId, setPolicyId] = useState<string>(routeId ?? '');
  const [status, setStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string>('');

  async function onDownload(e: FormEvent) {
    e.preventDefault();
    setStatus('downloading');
    setError('');
    try {
      const blob = await downloadPolicyCsv(ctx.wallet, policyId.trim());
      triggerBlobDownload(blob, `blink-policy-${policyId.trim()}.csv`);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setError(
        err instanceof AdminApiError
          ? `HTTP ${err.status}: ${err.message}`
          : 'Download failed',
      );
    }
  }

  return (
    <div className="space-y-3" data-testid="policy-export">
      <section className="bg-[#0e0e0e] border border-[#1a1a1a]">
        <div className="px-6 py-4 border-b border-[#1a1a1a]">
          <span className="text-xs uppercase tracking-widest text-[#666666]">
            CSV Export
          </span>
        </div>
        <form className="p-6 flex flex-col md:flex-row md:items-end gap-3" onSubmit={onDownload}>
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[10px] uppercase tracking-widest text-[#666666]">
              Policy ID
            </span>
            <input
              required
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              className="bg-[#141414] border border-[#1e1e1e] text-[#f0f0f0] font-dm-mono text-sm px-3 py-2 focus:outline-none focus:border-[#e8a020]"
              data-testid="policy-export-input"
            />
          </label>
          <button
            type="submit"
            disabled={status === 'downloading' || !policyId.trim()}
            className="bg-[#e8a020] text-[#080808] px-5 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
            data-testid="policy-export-button"
          >
            {status === 'downloading' ? 'Downloading...' : 'Download CSV'}
          </button>
        </form>
        <div className="px-6 pb-6">
          {status === 'done' && (
            <div className="text-xs text-[#8aba8a]" data-testid="policy-export-done">
              Download triggered.
            </div>
          )}
          {status === 'error' && (
            <div className="text-xs text-[#e05656]" role="alert">
              {error}
            </div>
          )}
          <p className="text-[11px] text-[#555555] mt-3 leading-relaxed">
            CSV columns: policy_id, wallet_addr, state, minute_index, ts,
            multiplier, rate_usdc, accrued_usdc, rulebook_version.
          </p>
        </div>
      </section>
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  // Guarded so tests running in jsdom without URL.createObjectURL don't crash.
  if (typeof URL === 'undefined' || typeof document === 'undefined') return;
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
