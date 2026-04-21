/**
 * Circle webhook handler.
 *
 * Two classes of events:
 *   - `settlement.completed` / `settlement.failed`: Gateway has finalized a
 *     batch. We iterate `data.authorizations[]` and flip matching
 *     settlement_receipts rows to confirmed/failed. Also updates
 *     x402_authorizations.consumed_usdc for confirmed rows.
 *   - `transaction.confirmed` / `transaction.failed`: Circle DCW tx status.
 *     Used to replace the `setTimeout(3000)` race at server.js:184 — the
 *     admin deposit-reserve flow registers interest via GatewayFacade and
 *     awaits the webhook.
 *
 * Every event is de-duplicated on `event.id` by inserting into
 * circle_webhook_events with ON CONFLICT DO NOTHING. A second delivery of the
 * same id is a verified no-op and returns 200 with `{replayed: true}`.
 *
 * Signature verification uses HMAC-SHA256 over the raw body with the shared
 * secret in CIRCLE_WEBHOOK_SECRET. The header name Circle uses is
 * `Circle-Signature`; we accept both that and `X-Circle-Signature` (future-
 * proof). A mismatch returns 401 before any DB work.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type { QueryResult } from 'pg';
import { getPool, type Queryable } from '../db/pool';
import { consume } from './authorization';
import type { CircleWebhookEvent, CircleWebhookData } from './types';
import type { GatewayFacade } from './gateway-client';

export interface WebhookDeps {
  db?: Queryable;
  facade?: GatewayFacade;
  webhookSecret?: string;
  /** Clock injection for tests. */
  now?: () => Date;
}

export interface VerifySignatureInput {
  rawBody: Buffer | string;
  signature: string;
  secret: string;
}

export function verifySignature(input: VerifySignatureInput): boolean {
  const body = typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody;
  const expected = createHmac('sha256', input.secret).update(body).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  // Tolerate callers that pass the signature either hex-raw or `sha256=<hex>`.
  const raw = input.signature.startsWith('sha256=') ? input.signature.slice(7) : input.signature;
  let givenBuf: Buffer;
  try {
    givenBuf = Buffer.from(raw, 'hex');
  } catch {
    return false;
  }
  if (givenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/** Build an Express handler. Caller must mount express.raw() before this. */
export function buildWebhookHandler(deps: WebhookDeps = {}): (req: Request, res: Response) => Promise<void> {
  const webhookSecret = deps.webhookSecret ?? process.env['CIRCLE_WEBHOOK_SECRET'] ?? '';
  return async function handle(req: Request, res: Response): Promise<void> {
    const sigHeader =
      (req.headers['circle-signature'] as string | undefined) ??
      (req.headers['x-circle-signature'] as string | undefined);
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    if (!webhookSecret) {
      res.status(500).json({ error: 'CIRCLE_WEBHOOK_SECRET not configured' });
      return;
    }
    if (!sigHeader) {
      res.status(401).json({ error: 'missing signature' });
      return;
    }
    if (!verifySignature({ rawBody, signature: sigHeader, secret: webhookSecret })) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    let event: CircleWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as CircleWebhookEvent;
    } catch {
      res.status(400).json({ error: 'invalid JSON' });
      return;
    }
    if (!event.id || !event.type) {
      res.status(400).json({ error: 'missing id or type' });
      return;
    }

    const db = deps.db ?? getPool();
    const insert: QueryResult = await db.query(
      `INSERT INTO circle_webhook_events (webhook_id, event_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (webhook_id) DO NOTHING
       RETURNING webhook_id`,
      [event.id, event.type, JSON.stringify(event)],
    );
    if (insert.rowCount === 0) {
      res.status(200).json({ replayed: true });
      return;
    }

    try {
      const result = await applyWebhook(event, db);
      if (deps.facade) {
        // Wake anyone awaiting this receipt by nonce or txHash.
        for (const authz of event.data?.authorizations ?? []) {
          deps.facade.notify(event, authz.nonce);
        }
        if (event.data?.transactionHash) {
          deps.facade.notify(event, event.data.transactionHash);
        }
      }
      res.status(200).json({ ok: true, applied: result.applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
}

export async function applyWebhook(
  event: CircleWebhookEvent,
  db: Queryable,
): Promise<{ applied: number }> {
  const data: CircleWebhookData = event.data ?? {};
  let applied = 0;
  if (event.type === 'settlement.completed' || event.type === 'settlement.failed') {
    const status = event.type === 'settlement.completed' ? 'confirmed' : 'failed';
    for (const authz of data.authorizations ?? []) {
      const matched = await matchReceiptByNonce(authz.nonce, db);
      if (!matched) continue;
      await db.query(
        `UPDATE settlement_receipts
         SET status = $1, circle_batch_id = $2, circle_tx_hash = $3, error_message = $4, payment_response = $5
         WHERE receipt_id = $6`,
        [
          authz.status === 'confirmed' ? 'confirmed' : status,
          data.batchId ?? null,
          data.transactionHash ?? null,
          authz.errorMessage ?? null,
          JSON.stringify(event),
          matched.receiptId,
        ],
      );
      // If this represents a confirmed settlement, consume the auth so the
      // cap tracker reflects reality. consume() is idempotent at the SQL
      // level: the predicate guards against double-accounting.
      if (matched.authId && authz.status === 'confirmed') {
        try {
          await consume(matched.authId, matched.amountUsdc, db);
        } catch {
          // If consume throws (e.g., cap exceeded), mark the receipt failed.
          await db.query(
            `UPDATE settlement_receipts SET status = $1, error_message = $2 WHERE receipt_id = $3`,
            ['failed', 'cap exceeded at settlement', matched.receiptId],
          );
        }
      }
      applied++;
    }
  } else if (event.type === 'transaction.confirmed' || event.type === 'transaction.failed') {
    // DCW tx confirmations are tracked via the GatewayFacade notifier only —
    // they do not touch settlement_receipts (those are x402 batch events).
  }
  return { applied };
}

interface ReceiptRef {
  receiptId: string;
  authId: string | null;
  amountUsdc: string;
}

async function matchReceiptByNonce(nonce: string | undefined, db: Queryable): Promise<ReceiptRef | null> {
  if (!nonce) return null;
  // x402_payload is JSONB with authorization.nonce. We look up by nonce.
  const res: QueryResult = await db.query(
    `UPDATE settlement_receipts
       SET status = status
     WHERE x402_payload @> $1::jsonb
     RETURNING receipt_id, auth_id, amount_usdc`,
    [JSON.stringify({ authorization: { nonce } })],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    receiptId: row['receipt_id'] as string,
    authId: (row['auth_id'] as string | null) ?? null,
    amountUsdc: String(row['amount_usdc']),
  };
}

export const __testing = { matchReceiptByNonce };
