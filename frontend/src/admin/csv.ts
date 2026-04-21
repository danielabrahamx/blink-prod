// Minimal CSV builder used by PolicyExport so we can render a client-side
// preview before the server returns the canonical export. The backend is the
// source of truth for the actual carrier-formatted export.

import type { PolicyInspectorData } from './types';

export const POLICY_CSV_COLUMNS = [
  'policy_id',
  'wallet_addr',
  'state',
  'minute_index',
  'ts',
  'multiplier',
  'rate_usdc',
  'accrued_usdc',
  'rulebook_version',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function policyToCsv(policy: PolicyInspectorData): string {
  const header = POLICY_CSV_COLUMNS.join(',');
  const rows = policy.accrual_ledger.map((entry) =>
    [
      policy.policy_id,
      policy.wallet_addr,
      entry.state,
      entry.minute_index,
      entry.ts,
      entry.multiplier,
      entry.rate_usdc,
      entry.accrued_usdc,
      policy.breakdown.rulebook_version,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...rows].join('\n');
}
