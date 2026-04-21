import { describe, it, expect } from 'vitest';
import { POLICY_CSV_COLUMNS, policyToCsv } from '../csv';
import { fixturePolicy } from './fixtures';

describe('policyToCsv', () => {
  it('emits the canonical column header in order', () => {
    const csv = policyToCsv(fixturePolicy);
    const header = csv.split('\n')[0];
    expect(header).toBe(POLICY_CSV_COLUMNS.join(','));
  });

  it('contains every expected column name', () => {
    const csv = policyToCsv(fixturePolicy);
    const header = csv.split('\n')[0];
    for (const col of POLICY_CSV_COLUMNS) {
      expect(header).toContain(col);
    }
  });

  it('emits one row per accrual ledger entry', () => {
    const csv = policyToCsv(fixturePolicy);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1 + fixturePolicy.accrual_ledger.length);
  });

  it('includes the policy id and rulebook version in every row', () => {
    const csv = policyToCsv(fixturePolicy);
    const rows = csv.split('\n').slice(1);
    for (const row of rows) {
      expect(row).toContain(fixturePolicy.policy_id);
      expect(row).toContain(fixturePolicy.breakdown.rulebook_version);
    }
  });

  it('quotes cells that contain commas', () => {
    const policy = {
      ...fixturePolicy,
      wallet_addr: '0x1,with,commas',
    };
    const csv = policyToCsv(policy);
    expect(csv).toContain('"0x1,with,commas"');
  });
});
