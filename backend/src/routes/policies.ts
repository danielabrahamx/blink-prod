import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  createPolicySchema,
  fundPolicySchema,
  topupPolicySchema,
  cancelPolicySchema,
} from '../ingest/schema.js';
import { BadRequestError } from '../lib/errors.js';
import { getContext } from '../lib/context.js';
import { incActivePolicies } from '../admin/metrics.js';

export function policiesRouter(): Router {
  const r = Router();

  r.post('/create', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('invalid create body', parsed.error.flatten());
      }
      const { store } = getContext(req.app);
      const policy = await store.policies.create({
        wallet_addr: parsed.data.wallet_addr,
        home_country: parsed.data.home_country,
      });
      // Policy starts in draft; calibration begins on fund.
      res.status(201).json({
        policy,
        authorization: {
          session_key_pubkey: parsed.data.session_key_pubkey,
          cap_usdc: parsed.data.cap_usdc,
          validity_days: parsed.data.validity_days,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/fund', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = fundPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('invalid fund body', parsed.error.flatten());
      }
      const { store } = getContext(req.app);
      const p = await store.policies.byId(parsed.data.policy_id);
      if (!p) throw new BadRequestError('policy not found');
      const next = await store.policies.setStatus(p.policy_id, 'calibrating');
      if (next?.status === 'calibrating') incActivePolicies(1);
      res.json({ policy: next, funded_usdc: parsed.data.amount_usdc });
    } catch (e) {
      next(e);
    }
  });

  r.post('/topup', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = topupPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('invalid topup body', parsed.error.flatten());
      }
      const { store } = getContext(req.app);
      const p = await store.policies.byId(parsed.data.policy_id);
      if (!p) throw new BadRequestError('policy not found');
      res.json({ policy: p, topup_usdc: parsed.data.amount_usdc });
    } catch (e) {
      next(e);
    }
  });

  r.post('/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = cancelPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError('invalid cancel body', parsed.error.flatten());
      }
      const { store } = getContext(req.app);
      const p = await store.policies.byId(parsed.data.policy_id);
      if (!p) throw new BadRequestError('policy not found');
      const next = await store.policies.setStatus(
        p.policy_id,
        'cancelled_by_user',
      );
      if (next?.status === 'cancelled_by_user') incActivePolicies(-1);
      res.json({ policy: next });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
