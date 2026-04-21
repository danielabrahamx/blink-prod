import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { snapshot as metricsSnapshot } from '../admin/metrics.js';
import { NotImplementedError } from '../lib/errors.js';
import { getContext } from '../lib/context.js';

/**
 * Admin API:
 *   GET  /admin/metrics                 -> JSON snapshot
 *   GET  /admin/policy/:id              -> inspector payload
 *   POST /admin/replay                  -> (deferred, needs envelope store)
 *
 * The inspector implementation depends on Postgres queries from Agent B;
 * until the `Store` gains `loadEnvelopes/loadScores/loadAccrual`, this
 * surfaces what it can from the in-memory policy store.
 */

export function adminRouter(): Router {
  const r = Router();

  r.get('/metrics', (_req, res) => {
    res.json(metricsSnapshot());
  });

  r.get('/policy/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { store } = getContext(req.app);
      const policy = await store.policies.byId(req.params.id);
      if (!policy) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'policy not found' } });
        return;
      }
      // Envelopes / scores / accrual come from Agent B+F once DB lands.
      res.json({
        policy,
        envelopes: [],
        scores: [],
        accrual: [],
        fsm_log: [],
        current_multiplier: null,
        note: 'time-series unavailable until Agent B (DB) + Agent F (accrual) land',
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/replay', (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new NotImplementedError(
        'replay requires stored envelope + accrual history (Agent B + F)',
      ),
    );
  });

  return r;
}
