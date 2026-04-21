/**
 * Daily reconcile job.
 *
 * For the previous 24h, sum settlement_receipts.amount_usdc per policy.
 * Fetch Circle's reported settlement totals (via the provided adapter) and
 * compare. Any delta > $0.01 is logged as JSONL at backend/logs/reconcile.jsonl
 * for admin review.
 *
 * Circle's API surface for per-policy settlement totals isn't public on the
 * nanopayments docs we have access to, so the adapter is injected. In dev/
 * test this is a stubbed `StaticTotalsAdapter`; a prod implementation will
 * call `GatewayClient.getBatchHistory()` or equivalent.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { QueryResult } from 'pg';
import { getPool, type Queryable } from '../db/pool';

export const DELTA_THRESHOLD_USDC = 0.01;

export interface CircleTotalsAdapter {
  /** Returns sum of USDC settled to us per policy for [from, to). */
  sumByPolicy(from: Date, to: Date): Promise<Record<string, number>>;
}

export class StaticTotalsAdapter implements CircleTotalsAdapter {
  constructor(private readonly totals: Record<string, number>) {}
  async sumByPolicy(): Promise<Record<string, number>> {
    return { ...this.totals };
  }
}

export interface ReconcileIssue {
  policyId: string;
  internalUsdc: number;
  circleUsdc: number;
  deltaUsdc: number;
  windowFrom: string;
  windowTo: string;
  recordedAt: string;
}

export interface RunOptions {
  db?: Queryable;
  now?: () => Date;
  logPath?: string;
  adapter: CircleTotalsAdapter;
}

export async function runReconcile(opts: RunOptions): Promise<{
  issues: ReconcileIssue[];
  internalTotals: Record<string, number>;
  circleTotals: Record<string, number>;
}> {
  const db = opts.db ?? getPool();
  const now = opts.now?.() ?? new Date();
  const windowTo = now;
  const windowFrom = new Date(now.valueOf() - 24 * 3600 * 1000);

  const res: QueryResult = await db.query(
    `SELECT policy_id, SUM(amount_usdc)::text AS total
       FROM settlement_receipts
      WHERE status IN ('confirmed', 'submitted')
        AND created_at >= $1 AND created_at < $2
      GROUP BY policy_id`,
    [windowFrom, windowTo],
  );
  const internal: Record<string, number> = {};
  for (const row of res.rows) {
    internal[row['policy_id'] as string] = Number(row['total']);
  }

  const circle = await opts.adapter.sumByPolicy(windowFrom, windowTo);

  const issues: ReconcileIssue[] = [];
  const policies = new Set<string>([...Object.keys(internal), ...Object.keys(circle)]);
  for (const policyId of policies) {
    const i = internal[policyId] ?? 0;
    const c = circle[policyId] ?? 0;
    // Round the delta to 6 dp BEFORE the threshold compare so 1.01 - 1.00 is
    // exactly 0.01 rather than 0.010000000000000009 due to IEEE-754 drift.
    const delta = Number((Math.abs(i - c)).toFixed(6));
    if (delta > DELTA_THRESHOLD_USDC) {
      issues.push({
        policyId,
        internalUsdc: i,
        circleUsdc: c,
        deltaUsdc: delta,
        windowFrom: windowFrom.toISOString(),
        windowTo: windowTo.toISOString(),
        recordedAt: now.toISOString(),
      });
    }
  }

  if (issues.length > 0) {
    const logPath = opts.logPath ?? path.join(process.cwd(), 'logs', 'reconcile.jsonl');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const chunk = issues.map((i) => JSON.stringify(i)).join('\n') + '\n';
    await fs.appendFile(logPath, chunk, 'utf8');
  }

  return { issues, internalTotals: internal, circleTotals: circle };
}
