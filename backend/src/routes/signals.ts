import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ingestEnvelope } from '../ingest/index.js';
import { BadRequestError } from '../lib/errors.js';
import { getContext } from '../lib/context.js';
import { observeSignalLatency } from '../admin/metrics.js';

export function signalsRouter(): Router {
  const r = Router();

  // POST /signals — ingest and acknowledge. Scoring + multiplier emission
  // happens downstream in the settlement accrual loop (feat/settlement-x402).
  r.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    try {
      const ctx = getContext(req.app);
      const ingested = await ingestEnvelope(
        req.body,
        (req.ip ?? req.socket.remoteAddress ?? '127.0.0.1').replace(/^::ffff:/, ''),
        {
          redis: ctx.redis,
          devices: { byId: (id) => ctx.store.devices.byId(id) },
        },
      );
      const policy = await ctx.store.policies.byId(ingested.envelope.policy_id);
      if (!policy) throw new BadRequestError('policy not found');
      observeSignalLatency(Date.now() - started);
      res.status(202).json({
        accepted: true,
        ip_country: ingested.ip_country,
        received_at: ingested.received_at,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
