/**
 * Accrual loop.
 *
 * Module 3 of the design doc specifies:
 *   delta_usdc = base_rate × multiplier × elapsed_seconds
 *
 * Driven by two triggers:
 *   1. A 60-second scheduler (runAccrualTick).
 *   2. Each POST /signals call (runForPolicy), so the current multiplier is
 *      reflected within the same settlement window rather than waiting.
 *
 * We compute over the closed-open window [lastWindowEnd, now). If a policy is
 * paused (offline / cancelled) the multiplier is zero and delta is zero — we
 * still write the audit row so the reconciler has evidence the tick ran.
 *
 * Receipt creation is idempotent on (policy_id, window_end): a retry with the
 * same window emits no new row and returns the existing one. Callers MUST
 * quantize window_end to a deterministic boundary (the scheduler uses 60-s
 * floors; signal-triggered calls use the signal's server_ts).
 */
import type { QueryResult } from 'pg';
import { getPool, type Queryable } from '../db/pool';
import { computeAccrualUnits, fromUnits, toUnits, ZERO } from './money';
import type { DeltaResult, SettlementReceipt } from './types';

export interface PolicyAccrualState {
  policyId: string;
  authId: string | null;
  baseRateUsdcPerSec: number;
  multiplier: number;
  paused: boolean;
  lastWindowEnd: Date;
  now: Date;
}

/**
 * Pure computation — no database side effects. Given the prior window end
 * and the current tick state, returns the delta for the current window.
 * Extracted for unit-testability; the database writer builds on it.
 */
export async function computeDelta(
  state: PolicyAccrualState,
  db: Queryable = getPool(),
): Promise<DeltaResult> {
  const elapsedSeconds = Math.max(0, Math.floor((state.now.valueOf() - state.lastWindowEnd.valueOf()) / 1000));
  if (state.paused || state.multiplier === 0) {
    return {
      policyId: state.policyId,
      windowStart: state.lastWindowEnd,
      windowEnd: state.now,
      elapsedSeconds,
      multiplier: state.multiplier,
      baseRateUsdcPerSec: state.baseRateUsdcPerSec,
      deltaUsdc: ZERO,
      cumulativeUsdc: await fetchCumulative(state.policyId, db),
      paused: true,
      reason: state.paused ? 'policy_paused' : 'zero_multiplier',
    };
  }
  const deltaUnits = computeAccrualUnits(state.baseRateUsdcPerSec, state.multiplier, elapsedSeconds);
  const previousCumulative = toUnits(await fetchCumulative(state.policyId, db));
  const nextCumulative = previousCumulative + deltaUnits;
  return {
    policyId: state.policyId,
    windowStart: state.lastWindowEnd,
    windowEnd: state.now,
    elapsedSeconds,
    multiplier: state.multiplier,
    baseRateUsdcPerSec: state.baseRateUsdcPerSec,
    deltaUsdc: fromUnits(deltaUnits),
    cumulativeUsdc: fromUnits(nextCumulative),
    paused: false,
  };
}

async function fetchCumulative(policyId: string, db: Queryable): Promise<string> {
  const res: QueryResult = await db.query(
    `SELECT cumulative_usdc FROM accrual_ledger
     WHERE policy_id = $1
     ORDER BY window_end DESC LIMIT 1`,
    [policyId],
  );
  const row = res.rows[0];
  return row ? String(row['cumulative_usdc']) : ZERO;
}

/** Configuration knobs supplied per-policy by the caller. */
export interface RunForPolicyInput {
  policyId: string;
  authId: string | null;
  baseRateUsdcPerSec: number;
  multiplier: number;
  paused: boolean;
  lastWindowEnd: Date;
  now: Date;
  /** Minimum delta in USDC units the scheduler will actually settle for.
   *  Smaller accruals are written to the ledger but skip receipt creation
   *  so we don't spam the Gateway with sub-micro-cent 402s. */
  minReceiptUnits?: bigint;
}

/**
 * Writes an accrual ledger entry. If the delta is material (>= minReceiptUnits,
 * default 1 base unit) a `pending` settlement_receipts row is also created
 * under the idempotency key (policy_id, window_end). Returns the delta, the
 * receipt (if any), and whether this call was idempotent-noop.
 */
export async function runForPolicy(
  input: RunForPolicyInput,
  db: Queryable = getPool(),
): Promise<{ delta: DeltaResult; receipt: SettlementReceipt | null; noop: boolean }> {
  const delta = await computeDelta(
    {
      policyId: input.policyId,
      authId: input.authId,
      baseRateUsdcPerSec: input.baseRateUsdcPerSec,
      multiplier: input.multiplier,
      paused: input.paused,
      lastWindowEnd: input.lastWindowEnd,
      now: input.now,
    },
    db,
  );

  const deltaUnits = toUnits(delta.deltaUsdc);
  const minUnits = input.minReceiptUnits ?? 1n;

  let ledgerNoop = false;
  try {
    await db.query(
      `INSERT INTO accrual_ledger
        (policy_id, window_start, window_end, multiplier, elapsed_seconds,
         base_rate_usdc_per_sec, delta_usdc, cumulative_usdc, receipt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        delta.policyId,
        delta.windowStart,
        delta.windowEnd,
        delta.multiplier,
        delta.elapsedSeconds,
        delta.baseRateUsdcPerSec,
        delta.deltaUsdc,
        delta.cumulativeUsdc,
        null,
      ],
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      ledgerNoop = true;
    } else {
      throw err;
    }
  }

  if (delta.paused || deltaUnits < minUnits) {
    return { delta, receipt: null, noop: ledgerNoop };
  }

  // Create the pending receipt. If the window was already settled we simply
  // look the existing row up — this keeps runForPolicy() safe to re-invoke.
  const existing = await db.query(
    `SELECT * FROM settlement_receipts
     WHERE policy_id = $1 AND window_end = $2`,
    [delta.policyId, delta.windowEnd],
  );
  if (existing.rows[0]) {
    return { delta, receipt: rowToReceipt(existing.rows[0]), noop: true };
  }

  const insert: QueryResult = await db.query(
    `INSERT INTO settlement_receipts
       (policy_id, auth_id, window_start, window_end, amount_usdc, multiplier,
        elapsed_seconds, base_rate_usdc_per_sec, status, x402_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
     RETURNING *`,
    [
      delta.policyId,
      input.authId,
      delta.windowStart,
      delta.windowEnd,
      delta.deltaUsdc,
      delta.multiplier,
      delta.elapsedSeconds,
      delta.baseRateUsdcPerSec,
      null,
    ],
  );
  const row = insert.rows[0];
  if (!row) throw new Error('INSERT settlement_receipts returned no rows');
  return { delta, receipt: rowToReceipt(row), noop: false };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

function rowToReceipt(row: Record<string, unknown>): SettlementReceipt {
  return {
    receiptId: row['receipt_id'] as string,
    policyId: row['policy_id'] as string,
    authId: (row['auth_id'] as string | null) ?? null,
    windowStart: new Date(row['window_start'] as string | Date),
    windowEnd: new Date(row['window_end'] as string | Date),
    amountUsdc: String(row['amount_usdc']),
    multiplier: Number(row['multiplier']),
    elapsedSeconds: Number(row['elapsed_seconds']),
    baseRateUsdcPerSec: Number(row['base_rate_usdc_per_sec']),
    status: row['status'] as SettlementReceipt['status'],
    x402Payload: (row['x402_payload'] as Record<string, unknown> | null) ?? null,
    paymentResponse: (row['payment_response'] as Record<string, unknown> | null) ?? null,
    circleTxHash: (row['circle_tx_hash'] as string | null) ?? null,
    circleBatchId: (row['circle_batch_id'] as string | null) ?? null,
    errorMessage: (row['error_message'] as string | null) ?? null,
    createdAt: new Date(row['created_at'] as string | Date),
    updatedAt: new Date(row['updated_at'] as string | Date),
  };
}

export const __testing = { rowToReceipt, fetchCumulative, isUniqueViolation };
