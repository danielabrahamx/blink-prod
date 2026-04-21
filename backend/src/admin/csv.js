// Carrier-facing CSV export for a single policy. Column list is the canonical
// order shared with the frontend tests.

'use strict';

const COLUMNS = [
  'policy_id',
  'wallet_addr',
  'state',
  'minute_index',
  'ts',
  'multiplier',
  'rate_usdc',
  'accrued_usdc',
  'rulebook_version',
];

function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function policyToCsv(policy) {
  const header = COLUMNS.join(',');
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
      .map(cell)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

module.exports = { COLUMNS, policyToCsv };
