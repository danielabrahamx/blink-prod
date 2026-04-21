import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ingestEnvelope } from '../ingest/index.js';
import { extractFeatures } from '../features/index.js';
import { getRiskEngine } from '../risk/index.js';
import { BadRequestError, NotImplementedError } from '../lib/errors.js';
import { getContext } from '../lib/context.js';
import { observeMultiplier, observeSignalLatency } from '../admin/metrics.js';

export function signalsRouter(): Router {
  const r = Router();

  // POST /signals
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

      const policy = await ctx.store.policies.byId(
        ingested.envelope.policy_id,
      );
      if (!policy) throw new BadRequestError('policy not found');

      const features = extractFeatures({
        envelope: ingested.envelope,
        ip_country: ingested.ip_country,
        policy,
      });

      // Try to score; if risk engine is not installed yet (Agent E still
      // building), we still return an accepted-with-unscored response so
      // envelope ingest can be exercised end-to-end.
      try {
        const scored = getRiskEngine().score(features);
        observeMultiplier(scored.multiplier);
        observeSignalLatency(Date.now() - started);
        res.json({
          accepted: true,
          features,
          scored,
          ip_country: ingested.ip_country,
          received_at: ingested.received_at,
        });
      } catch (err) {
        if (err instanceof NotImplementedError) {
          observeSignalLatency(Date.now() - started);
          res.status(202).json({
            accepted: true,
            scored: null,
            features,
            ip_country: ingested.ip_country,
            received_at: ingested.received_at,
            note: 'risk engine not installed (Agent E pending)',
          });
          return;
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  });

  return r;
}
