/**
 * Express routes for the settlement layer.
 *
 * Public surface:
 *   POST /settlement/webhook         — Circle delivers settlement events here.
 *   POST /settlement/authorize       — User signs an EIP-3009 pre-authorization.
 *   GET  /settlement/status/:id      — Admin/electron poll of auth + receipts.
 *   POST /settlement/revoke/:authId  — User-initiated revocation of a session.
 *
 * The router is a pure function of its dependencies so the integration tests
 * can wire up a FakePool and no real Circle client.
 */
import { Router, json, raw, type Request, type Response } from 'express';
import type { Queryable } from '../db/pool';
import {
  storeAuthorization,
  getActive,
  getById,
  revoke,
} from './authorization';
import { buildWebhookHandler } from './webhook';
import type { GatewayFacade } from './gateway-client';
import type { AuthorizationInput, PolicyAuthStatus } from './types';
import { toUnits } from './money';

export interface BuildRouterDeps {
  db: Queryable;
  facade?: GatewayFacade;
  webhookSecret?: string;
}

export function buildSettlementRouter(deps: BuildRouterDeps): Router {
  const router = Router();

  // Circle webhook must verify the signature against the raw body. Wrap the
  // handler with a raw body parser for this route only.
  router.post(
    '/webhook',
    raw({ type: 'application/json', limit: '1mb' }),
    buildWebhookHandler({ db: deps.db, facade: deps.facade, webhookSecret: deps.webhookSecret }),
  );

  router.use(json());

  router.post('/authorize', async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<AuthorizationInput>;
      if (!body.policyId || !body.userWallet || !body.sessionPubkey || !body.capUsdc || !body.validUntil || !body.signature || !body.nonce) {
        res.status(400).json({ error: 'missing required fields' });
        return;
      }
      const input: AuthorizationInput = {
        policyId: body.policyId,
        userWallet: body.userWallet,
        sessionPubkey: body.sessionPubkey,
        capUsdc: body.capUsdc,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: new Date(body.validUntil),
        signature: body.signature,
        nonce: body.nonce,
        chainId: body.chainId,
      };
      const stored = await storeAuthorization(input, deps.db);
      res.status(201).json({
        authId: stored.authId,
        policyId: stored.policyId,
        capUsdc: stored.capUsdc,
        consumedUsdc: stored.consumedUsdc,
        validUntil: stored.validUntil.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  router.get('/status/:policyId', async (req: Request, res: Response) => {
    try {
      const policyId = req.params['policyId'];
      if (!policyId) {
        res.status(400).json({ error: 'policyId required' });
        return;
      }
      const auth = await getActive(policyId, deps.db);
      if (!auth) {
        res.status(404).json({ error: 'no active authorization' });
        return;
      }
      const [pending, confirmed] = await Promise.all([
        deps.db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM settlement_receipts WHERE policy_id = $1 AND status = $2`,
          [policyId, 'submitted'],
        ),
        deps.db.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM settlement_receipts WHERE policy_id = $1 AND status = $2`,
          [policyId, 'confirmed'],
        ),
      ]);
      const consumedUnits = toUnits(auth.consumedUsdc);
      const capUnits = toUnits(auth.capUsdc);
      const ratio = capUnits === 0n ? 0 : Number(consumedUnits) / Number(capUnits);
      const payload: PolicyAuthStatus = {
        policyId: auth.policyId,
        authId: auth.authId,
        capUsdc: auth.capUsdc,
        consumedUsdc: auth.consumedUsdc,
        ratio,
        validUntil: auth.validUntil.toISOString(),
        revoked: auth.revokedAt !== null,
        receiptsPending: Number(pending.rows[0]?.n ?? '0'),
        receiptsConfirmed: Number(confirmed.rows[0]?.n ?? '0'),
      };
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/revoke/:authId', async (req: Request, res: Response) => {
    try {
      const authId = req.params['authId'];
      if (!authId) {
        res.status(400).json({ error: 'authId required' });
        return;
      }
      const existing = await getById(authId, deps.db);
      if (!existing) {
        res.status(404).json({ error: 'authorization not found' });
        return;
      }
      const revoked = await revoke(authId, deps.db);
      if (!revoked) {
        res.json({ authId, alreadyRevoked: true });
        return;
      }
      res.json({ authId, revokedAt: revoked.revokedAt?.toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
