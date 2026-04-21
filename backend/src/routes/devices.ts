import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { registerDeviceSchema } from '../ingest/schema.js';
import { BadRequestError } from '../lib/errors.js';
import { getContext } from '../lib/context.js';

export function devicesRouter(): Router {
  const r = Router();

  // POST /devices/register
  r.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          'invalid register body',
          parsed.error.flatten(),
        );
      }
      const { store } = getContext(req.app);
      const device = await store.devices.register(parsed.data);
      res.status(201).json({ device });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
