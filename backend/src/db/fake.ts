/**
 * In-memory Queryable implementation for unit tests. Implements a small
 * subset of Postgres SQL — exactly what the settlement modules issue. Keeps
 * the test suite hermetic (no Postgres container, no network, no disk).
 *
 * The implementation is a hand-written lookalike. It knows just enough to
 * answer the INSERT/UPDATE/SELECT patterns used by the code under test, and
 * uses a coarse table-per-statement routing. If a future feature needs a
 * broader SQL surface, extend this file rather than switching to an external
 * pg-mock.
 */
import type { QueryResult } from 'pg';
import { Queryable } from './pool';

type Row = Record<string, unknown>;

interface Tables {
  x402_authorizations: Row[];
  settlement_receipts: Row[];
  accrual_ledger: Row[];
  circle_webhook_events: Row[];
}

function emptyTables(): Tables {
  return {
    x402_authorizations: [],
    settlement_receipts: [],
    accrual_ledger: [],
    circle_webhook_events: [],
  };
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (typeof v === 'bigint') return Number(v);
  return NaN;
}

function fmt(n: number, dp: number): string {
  return n.toFixed(dp);
}

function uuid(): string {
  // Not cryptographically secure; fine for tests.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Deterministic uuid factory for snapshot tests. */
export function fakeUuidFactory(seed: string): () => string {
  let n = 0;
  return () => `${seed}-${String(++n).padStart(8, '0')}`;
}

function wrap<R extends Row>(rows: R[]): QueryResult<R> {
  return {
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  } as unknown as QueryResult<R>;
}

export class FakePool implements Queryable {
  public readonly tables: Tables = emptyTables();
  public readonly log: Array<{ text: string; params: unknown[] }> = [];
  private idFactory: () => string = uuid;

  setIdFactory(f: () => string): void {
    this.idFactory = f;
  }

  async query<R extends Row = Row>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<R>> {
    const p = [...(params ?? [])];
    this.log.push({ text, params: p });
    const trimmed = text.replace(/\s+/g, ' ').trim();

    // INSERT INTO x402_authorizations ...
    if (/^INSERT INTO x402_authorizations/i.test(trimmed)) {
      const now = new Date();
      const row: Row = {
        auth_id: this.idFactory(),
        policy_id: p[0],
        user_wallet: p[1],
        session_pubkey: p[2],
        cap_usdc: String(p[3]),
        consumed_usdc: '0.000000',
        valid_from: p[4] ?? now,
        valid_until: p[5],
        signature: p[6],
        nonce: p[7],
        chain_id: p[8],
        revoked_at: null,
        created_at: now,
      };
      // enforce uniq (policy_id, nonce)
      const dupe = this.tables.x402_authorizations.find(
        (r) => r['policy_id'] === row['policy_id'] && r['nonce'] === row['nonce'],
      );
      if (dupe) {
        const e = new Error('duplicate key value violates unique constraint "uniq_x402_auth_policy_nonce"') as Error & { code?: string };
        e.code = '23505';
        throw e;
      }
      this.tables.x402_authorizations.push(row);
      return wrap([row as unknown as R]);
    }

    // SELECT ... FROM x402_authorizations WHERE auth_id = $1
    if (/^SELECT .* FROM x402_authorizations WHERE auth_id = \$1/i.test(trimmed)) {
      const hit = this.tables.x402_authorizations.find((r) => r['auth_id'] === p[0]);
      return wrap(hit ? [hit as unknown as R] : []);
    }

    // SELECT ... FROM x402_authorizations WHERE policy_id = $1 AND revoked_at IS NULL ...
    if (/^SELECT .* FROM x402_authorizations WHERE policy_id = \$1 AND revoked_at IS NULL/i.test(trimmed)) {
      const hit = this.tables.x402_authorizations
        .filter((r) => r['policy_id'] === p[0] && r['revoked_at'] == null)
        .sort((a, b) => (a['created_at'] as Date).valueOf() - (b['created_at'] as Date).valueOf())
        .pop();
      return wrap(hit ? [hit as unknown as R] : []);
    }

    // UPDATE x402_authorizations SET consumed_usdc = consumed_usdc + $1 WHERE auth_id = $2 AND consumed_usdc + $1 <= cap_usdc AND revoked_at IS NULL AND valid_until > NOW() RETURNING *
    if (/^UPDATE x402_authorizations SET consumed_usdc = consumed_usdc \+ \$1/i.test(trimmed)) {
      const delta = toNum(p[0]);
      const authId = p[1];
      const row = this.tables.x402_authorizations.find((r) => r['auth_id'] === authId);
      if (!row) return wrap<R>([]);
      if (row['revoked_at']) return wrap<R>([]);
      if ((row['valid_until'] as Date).valueOf() <= Date.now()) return wrap<R>([]);
      const current = toNum(row['consumed_usdc']);
      const cap = toNum(row['cap_usdc']);
      if (current + delta > cap + 1e-9) return wrap<R>([]);
      row['consumed_usdc'] = fmt(current + delta, 6);
      return wrap([{ ...row } as unknown as R]);
    }

    // UPDATE x402_authorizations SET revoked_at = NOW() WHERE auth_id = $1 AND revoked_at IS NULL RETURNING *
    if (/^UPDATE x402_authorizations SET revoked_at = NOW\(\) WHERE auth_id = \$1/i.test(trimmed)) {
      const row = this.tables.x402_authorizations.find((r) => r['auth_id'] === p[0] && r['revoked_at'] == null);
      if (!row) return wrap<R>([]);
      row['revoked_at'] = new Date();
      return wrap([{ ...row } as unknown as R]);
    }

    // INSERT INTO settlement_receipts. Status may be a SQL literal ('pending')
    // or a parameter; detect by scanning for VALUES clause literals.
    if (/^INSERT INTO settlement_receipts/i.test(trimmed)) {
      const now = new Date();
      // Detect the literal 'pending' in the VALUES clause — the production
      // accrual-loop emits exactly that literal.
      const statusFromLiteral = /'pending'/.test(trimmed) ? 'pending' : null;
      // When status is a literal, x402_payload is $9; when a parameter, status is $9 and x402_payload is $10.
      const status = statusFromLiteral ?? String(p[8]);
      const x402Payload = statusFromLiteral ? (p[8] ?? null) : (p[9] ?? null);
      const row: Row = {
        receipt_id: this.idFactory(),
        policy_id: p[0],
        auth_id: p[1],
        window_start: p[2],
        window_end: p[3],
        amount_usdc: String(p[4]),
        multiplier: Number(p[5]),
        elapsed_seconds: Number(p[6]),
        base_rate_usdc_per_sec: Number(p[7]),
        status,
        x402_payload: x402Payload,
        payment_response: null,
        circle_tx_hash: null,
        circle_batch_id: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      };
      const dupe = this.tables.settlement_receipts.find(
        (r) => r['policy_id'] === row['policy_id'] && (r['window_end'] as Date).valueOf() === (row['window_end'] as Date).valueOf(),
      );
      if (dupe) {
        const e = new Error('duplicate key value violates unique constraint "uniq_settlement_policy_window"') as Error & { code?: string };
        e.code = '23505';
        throw e;
      }
      this.tables.settlement_receipts.push(row);
      return wrap([row as unknown as R]);
    }

    // UPDATE settlement_receipts SET status = $1, ... WHERE receipt_id = $2
    if (/^UPDATE settlement_receipts/i.test(trimmed)) {
      // Very permissive — supports the 2 update shapes used in webhook.ts.
      const assignments = /SET (.*?) WHERE/i.exec(trimmed)?.[1] ?? '';
      const predicateMatch = /WHERE (.+?)(?: RETURNING|$)/i.exec(trimmed);
      const predicate = predicateMatch?.[1] ?? '';
      // crude param counting: $1..$N in order of appearance
      const paramOrder = [...assignments.matchAll(/\$(\d+)/g), ...predicate.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      const found = this.tables.settlement_receipts.filter((r) => {
        return Array.from(predicate.matchAll(/(\w+)\s*=\s*\$(\d+)/g)).every(([, col, idx]) => r[col as string] === p[Number(idx) - 1]);
      });
      for (const row of found) {
        for (const match of assignments.matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
          const col = match[1] as string;
          const idx = Number(match[2]) - 1;
          row[col] = p[idx];
        }
        row['updated_at'] = new Date();
      }
      void paramOrder;
      return wrap(found as unknown as R[]);
    }

    // SELECT * FROM settlement_receipts WHERE receipt_id = $1
    if (/^SELECT \* FROM settlement_receipts WHERE receipt_id = \$1/i.test(trimmed)) {
      const hit = this.tables.settlement_receipts.find((r) => r['receipt_id'] === p[0]);
      return wrap(hit ? [hit as unknown as R] : []);
    }

    // SELECT * FROM settlement_receipts WHERE policy_id = $1 AND window_end = $2
    if (/^SELECT \* FROM settlement_receipts WHERE policy_id = \$1 AND window_end = \$2/i.test(trimmed)) {
      const hit = this.tables.settlement_receipts.find(
        (r) => r['policy_id'] === p[0] && (r['window_end'] as Date).valueOf() === (p[1] as Date).valueOf(),
      );
      return wrap(hit ? [hit as unknown as R] : []);
    }

    // SELECT aggregate counts for status endpoint.
    if (/^SELECT .* FROM settlement_receipts WHERE policy_id = \$1 AND status = \$2/i.test(trimmed)) {
      const count = this.tables.settlement_receipts.filter((r) => r['policy_id'] === p[0] && r['status'] === p[1]).length;
      return wrap([{ n: String(count) } as unknown as R]);
    }

    if (/^SELECT .* FROM settlement_receipts WHERE policy_id = \$1 AND created_at >= \$2 AND created_at < \$3/i.test(trimmed)) {
      const hits = this.tables.settlement_receipts.filter(
        (r) =>
          r['policy_id'] === p[0] &&
          (r['created_at'] as Date).valueOf() >= (p[1] as Date).valueOf() &&
          (r['created_at'] as Date).valueOf() < (p[2] as Date).valueOf(),
      );
      return wrap(hits as unknown as R[]);
    }

    // SELECT policy_id, SUM(amount_usdc)::text AS total FROM settlement_receipts WHERE status IN ('confirmed','submitted') AND created_at >= $1 AND created_at < $2 GROUP BY policy_id
    if (/^SELECT policy_id, SUM\(amount_usdc\)::text AS total FROM settlement_receipts/i.test(trimmed)) {
      const from = p[0] as Date;
      const to = p[1] as Date;
      const buckets = new Map<string, number>();
      for (const row of this.tables.settlement_receipts) {
        if (!['confirmed', 'submitted'].includes(String(row['status']))) continue;
        const createdAt = row['created_at'] as Date;
        if (createdAt.valueOf() < from.valueOf() || createdAt.valueOf() >= to.valueOf()) continue;
        const pid = row['policy_id'] as string;
        buckets.set(pid, (buckets.get(pid) ?? 0) + Number(row['amount_usdc']));
      }
      const rows: Array<{ policy_id: string; total: string }> = Array.from(buckets.entries()).map(
        ([policy_id, total]) => ({ policy_id, total: total.toFixed(6) }),
      );
      return wrap(rows as unknown as R[]);
    }

    // INSERT INTO accrual_ledger
    if (/^INSERT INTO accrual_ledger/i.test(trimmed)) {
      const now = new Date();
      const row: Row = {
        entry_id: this.idFactory(),
        policy_id: p[0],
        window_start: p[1],
        window_end: p[2],
        multiplier: Number(p[3]),
        elapsed_seconds: Number(p[4]),
        base_rate_usdc_per_sec: Number(p[5]),
        delta_usdc: String(p[6]),
        cumulative_usdc: String(p[7]),
        receipt_id: p[8] ?? null,
        created_at: now,
      };
      const dupe = this.tables.accrual_ledger.find(
        (r) => r['policy_id'] === row['policy_id'] && (r['window_end'] as Date).valueOf() === (row['window_end'] as Date).valueOf(),
      );
      if (dupe) {
        const e = new Error('duplicate key value violates unique constraint "uniq_accrual_policy_window"') as Error & { code?: string };
        e.code = '23505';
        throw e;
      }
      this.tables.accrual_ledger.push(row);
      return wrap([row as unknown as R]);
    }

    // SELECT cumulative_usdc FROM accrual_ledger WHERE policy_id = $1 ORDER BY window_end DESC LIMIT 1
    if (/^SELECT cumulative_usdc FROM accrual_ledger WHERE policy_id = \$1 ORDER BY window_end DESC LIMIT 1/i.test(trimmed)) {
      const rows = this.tables.accrual_ledger
        .filter((r) => r['policy_id'] === p[0])
        .sort((a, b) => (b['window_end'] as Date).valueOf() - (a['window_end'] as Date).valueOf());
      return wrap(rows.slice(0, 1) as unknown as R[]);
    }

    // INSERT INTO circle_webhook_events (webhook_id ...) ON CONFLICT (webhook_id) DO NOTHING RETURNING *
    if (/^INSERT INTO circle_webhook_events/i.test(trimmed)) {
      if (this.tables.circle_webhook_events.find((r) => r['webhook_id'] === p[0])) {
        return wrap<R>([]); // replay
      }
      const row: Row = {
        webhook_id: p[0],
        event_type: p[1],
        payload: p[2],
        processed_at: new Date(),
      };
      this.tables.circle_webhook_events.push(row);
      return wrap([row as unknown as R]);
    }

    throw new Error(`FakePool: unsupported query: ${trimmed.slice(0, 120)}`);
  }
}
