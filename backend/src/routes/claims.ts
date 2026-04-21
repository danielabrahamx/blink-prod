import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { NotImplementedError } from '../lib/errors.js';

/**
 * Claims router stub. Full intake, fraud flagging, and payout trigger are
 * owned by Agent H on `feat/claims-v1`. We ship the route surface now so
 * the frontend and admin portal can wire against fixed paths.
 */
export function claimsRouter(): Router {
  const r = Router();

  r.post('/submit', async (_req: Request, _res: Response, next: NextFunction) => {
    next(new NotImplementedError('claims intake not implemented (Agent H)'));
  });

  r.post('/approve', async (_req: Request, _res: Response, next: NextFunction) => {
    next(new NotImplementedError('claim approval not implemented (Agent H)'));
  });

  return r;
}
