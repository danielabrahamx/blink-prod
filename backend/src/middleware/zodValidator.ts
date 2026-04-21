import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { BadRequestError } from '../lib/errors.js';

/**
 * Zod body validator middleware factory. Rejects with a BadRequestError
 * carrying a flattened field map when parsing fails, otherwise replaces
 * `req.body` with the parsed (and coerced) payload.
 *
 * Route handlers downstream can treat `req.body` as the schema's inferred
 * type without re-parsing.
 */

export function validateBody<S extends ZodTypeAny>(schema: S) {
  return function zodBodyValidator(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new BadRequestError('invalid request body', parsed.error.flatten()),
      );
      return;
    }
    req.body = parsed.data as ZodInfer<S>;
    next();
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return function zodQueryValidator(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(
        new BadRequestError('invalid query params', parsed.error.flatten()),
      );
      return;
    }
    // Query is `unknown` in express 5+; keep as-is for runtime compat with 4.x.
    (req as { query: unknown }).query = parsed.data;
    next();
  };
}
