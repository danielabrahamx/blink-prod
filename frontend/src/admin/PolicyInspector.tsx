// PolicyInspector — /admin/policy/:id
// Renders the full carrier-audit surface for a single policy:
//   - current multiplier + "why" breakdown
//   - last 24h signal timeline
//   - FeatureVector history
//   - accrual ledger
//   - escrow authorization state + consumption %
//   - settlement receipts
//   - claims
//   - FSM transition log
// Design: matches InsuracleDashboard.tsx tokens. No emojis.

import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { getPolicy, AdminApiError } from './adminClient';
import type { PolicyInspectorData } from './types';
import {
  fmtMs,
  fmtMultiplier,
  fmtPct,
  fmtTs,
  fmtUsdc,
  shortHash,
} from './formatters';

interface OutletCtx {
  wallet: string;
}

export default function PolicyInspector() {
  const { id } = useParams<{ id: string }>();
  const ctx = useOutletContext<OutletCtx>();
  const [data, setData] = useState<PolicyInspectorData | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !ctx.wallet) return;
    let cancelled = false;
    setLoading(true);
    getPolicy(ctx.wallet, id)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof AdminApiError
              ? `HTTP ${e.status}: ${e.message}`
              : 'Lookup failed',
          );
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, ctx.wallet]);

  if (!id) {
    return (
      <SectionMessage
        title="No policy selected"
        body="Append /policy/:id to view a specific policy."
      />
    );
  }
  if (loading) {
    return (
      <SectionMessage title="Loading policy" body={`Fetching ${id}...`} />
    );
  }
  if (error) {
    return <SectionMessage title="Lookup failed" body={error} tone="destructive" />;
  }
  if (!data) {
    return <SectionMessage title="No data" body="Policy returned empty." />;
  }

  return (
    <div className="space-y-3" data-testid="policy-inspector">
      <HeaderCard data={data} />
      <BreakdownCard data={data} />
      <SignalTimelineCard data={data} />
      <FeatureHistoryCard data={data} />
      <AccrualLedgerCard data={data} />
      <EscrowCard data={data} />
      <SettlementCard data={data} />
      <ClaimsCard data={data} />
      <FsmLogCard data={data} />
    </div>
  );
}

function Shell({
  title,
  children,
  testid,
}: {
  title: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <section
      className="bg-[#0e0e0e] border border-[#1a1a1a]"
      data-testid={testid}
    >
      <div className="px-6 py-4 border-b border-[#1a1a1a]">
        <span className="text-xs uppercase tracking-widest text-[#666666]">
          {title}
        </span>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[#141414] border border-[#1e1e1e] px-4 py-3">
      <div className="text-xs text-[#444444] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className="font-dm-mono text-sm text-[#f0f0f0]">{value}</div>
    </div>
  );
}

function HeaderCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="Policy" testid="policy-header">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KV label="Policy ID" value={shortHash(data.policy_id, 8, 6)} />
        <KV label="Wallet" value={shortHash(data.wallet_addr, 6, 6)} />
        <KV label="State" value={data.current_state} />
        <KV
          label="Multiplier"
          value={fmtMultiplier(data.current_multiplier)}
        />
      </div>
    </Shell>
  );
}

function BreakdownCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="Multiplier Breakdown" testid="policy-breakdown">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <KV label="Base" value={fmtMultiplier(data.breakdown.base)} />
        <KV label="Result" value={fmtMultiplier(data.breakdown.multiplier)} />
        <KV label="Rulebook" value={data.breakdown.rulebook_version} />
        <KV label="Computed" value={fmtTs(data.breakdown.computed_at)} />
      </div>
      <Table
        head={['Signal', 'Weight', 'Contribution', 'Note']}
        rows={data.breakdown.factors.map((f) => [
          f.signal,
          f.weight.toFixed(3),
          f.contribution.toFixed(3),
          f.note ?? '',
        ])}
        emptyLabel="No contributing factors."
      />
    </Shell>
  );
}

function SignalTimelineCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="24h Signal Timeline" testid="policy-signals">
      <Table
        head={['Received', 'Kind', 'Latency', 'Verified', 'Digest']}
        rows={data.signal_timeline_24h.map((s) => [
          fmtTs(s.received_at),
          s.kind,
          fmtMs(s.latency_ms),
          s.verified ? 'yes' : 'no',
          shortHash(s.payload_digest, 8, 4),
        ])}
        emptyLabel="No signals in the last 24 hours."
      />
    </Shell>
  );
}

function FeatureHistoryCard({ data }: { data: PolicyInspectorData }) {
  const featureKeys = collectFeatureKeys(data.feature_history);
  return (
    <Shell title="FeatureVector History" testid="policy-features">
      <Table
        head={['Computed', 'Rulebook', 'Multiplier', ...featureKeys]}
        rows={data.feature_history.map((fv) => [
          fmtTs(fv.computed_at),
          fv.rulebook_version,
          fmtMultiplier(fv.multiplier),
          ...featureKeys.map((k) => {
            const v = fv.features[k];
            if (v === undefined) return '';
            return String(v);
          }),
        ])}
        emptyLabel="No FeatureVector history."
      />
    </Shell>
  );
}

function collectFeatureKeys(
  history: PolicyInspectorData['feature_history'],
): string[] {
  const set = new Set<string>();
  for (const fv of history) {
    for (const key of Object.keys(fv.features)) set.add(key);
  }
  return Array.from(set).sort();
}

function AccrualLedgerCard({ data }: { data: PolicyInspectorData }) {
  const total = data.accrual_ledger.reduce(
    (acc, row) => acc + (row.accrued_usdc || 0),
    0,
  );
  return (
    <Shell title="Accrual Ledger" testid="policy-accrual">
      <div className="text-xs text-[#666666] uppercase tracking-widest mb-3">
        Cumulative accrued: {fmtUsdc(total, 6)} USDC
      </div>
      <Table
        head={['#', 'TS', 'Rate', 'Multiplier', 'Accrued', 'State']}
        rows={data.accrual_ledger.map((row) => [
          row.minute_index.toString(),
          fmtTs(row.ts),
          fmtUsdc(row.rate_usdc, 6),
          fmtMultiplier(row.multiplier),
          fmtUsdc(row.accrued_usdc, 6),
          row.state,
        ])}
        emptyLabel="Ledger empty."
      />
    </Shell>
  );
}

function EscrowCard({ data }: { data: PolicyInspectorData }) {
  const auth = data.escrow_authorization;
  return (
    <Shell title="Escrow Authorization" testid="policy-escrow">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <KV label="Auth ID" value={shortHash(auth.authorization_id, 8, 4)} />
        <KV label="Cap" value={`${fmtUsdc(auth.cap_usdc, 2)} USDC`} />
        <KV label="Consumed" value={`${fmtUsdc(auth.consumed_usdc, 2)} USDC`} />
        <KV label="Usage" value={fmtPct(auth.consumption_pct, 2)} />
        <KV label="Valid Until" value={fmtTs(auth.valid_until)} />
        <KV
          label="Session Key"
          value={shortHash(auth.session_key_pubkey, 8, 6)}
        />
        <KV label="Revoked" value={auth.revoked ? 'yes' : 'no'} />
      </div>
      <div className="bg-[#141414] border border-[#1e1e1e] h-2 w-full overflow-hidden">
        <div
          className="bg-[#e8a020] h-full"
          style={{
            width: `${Math.min(100, Math.max(0, auth.consumption_pct))}%`,
          }}
          data-testid="escrow-consumption-bar"
        />
      </div>
    </Shell>
  );
}

function SettlementCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="Settlement Receipts" testid="policy-settlement">
      <Table
        head={['Settled', 'Amount', 'Status', 'Tx', 'Receipt']}
        rows={data.settlement_receipts.map((r) => [
          fmtTs(r.settled_at),
          `${fmtUsdc(r.amount_usdc, 6)} USDC`,
          r.status,
          shortHash(r.tx_hash, 6, 4),
          shortHash(r.receipt_id, 6, 4),
        ])}
        emptyLabel="No settlements yet."
      />
    </Shell>
  );
}

function ClaimsCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="Claims" testid="policy-claims">
      <Table
        head={['Opened', 'Claim ID', 'Status', 'Amount', 'Summary']}
        rows={data.claims.map((c) => [
          fmtTs(c.opened_at),
          shortHash(c.claim_id, 6, 4),
          c.status,
          `${fmtUsdc(c.amount_usdc, 2)} USDC`,
          c.summary,
        ])}
        emptyLabel="No claims filed."
      />
    </Shell>
  );
}

function FsmLogCard({ data }: { data: PolicyInspectorData }) {
  return (
    <Shell title="FSM Transition Log" testid="policy-fsm">
      <Table
        head={['TS', 'From', 'To', 'Reason', 'Actor']}
        rows={data.fsm_log.map((t) => [
          fmtTs(t.ts),
          t.from,
          t.to,
          t.reason,
          t.actor,
        ])}
        emptyLabel="No transitions logged."
      />
    </Shell>
  );
}

function Table({
  head,
  rows,
  emptyLabel,
}: {
  head: string[];
  rows: string[][];
  emptyLabel: string;
}) {
  if (!rows.length) {
    return (
      <div className="text-xs text-[#555555] italic">{emptyLabel}</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-dm-mono">
        <thead>
          <tr className="text-[#666666] uppercase tracking-widest border-b border-[#1a1a1a]">
            {head.map((h) => (
              <th key={h} className="text-left py-2 pr-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[#141414] text-[#cccccc]"
            >
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionMessage({
  title,
  body,
  tone = 'muted',
}: {
  title: string;
  body: string;
  tone?: 'muted' | 'destructive';
}) {
  const toneClass =
    tone === 'destructive' ? 'text-[#e05656]' : 'text-[#888888]';
  return (
    <div className="bg-[#0e0e0e] border border-[#1a1a1a] p-6">
      <div className="font-bebas text-lg tracking-widest text-[#f0f0f0] mb-2">
        {title}
      </div>
      <div className={`text-sm ${toneClass}`}>{body}</div>
    </div>
  );
}
