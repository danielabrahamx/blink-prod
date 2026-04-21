import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

/**
 * Central error middleware. Maps known error classes to HTTP status codes
 * + structured JSON bodies. Everything else becomes 500 with the raw
 * message but no stack in production.
 *
 * This file is the source of truth for the error contract; `lib/errorMiddleware.ts`
 * is kept as a thin re-export for legacy imports in routes.
 */

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'not found',
      path: req.originalUrl,
    },
  });
}

export function errorHandler() {
  return function errorHandlerMw(
    err: unknown,
    req: Request,
    res: Response,
    // Express mandates 4 args for error middleware even if unused.
    _next: NextFunction,
  ): void {
    // Zod errors bubble up as 400s with a flat field map.
    if (err instanceof ZodError) {
      req.log?.warn({ issues: err.issues }, 'zod validation failed');
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'validation failed',
          details: err.flatten(),
        },
      });
      return;
    }

    if (err instanceof HttpError) {
      const logLevel = err.status >= 500 ? 'error' : 'warn';
      req.log?.[logLevel](
        { err, status: err.status, code: err.code },
        err.message,
      );
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'internal error';
    req.log?.error({ err }, 'unhandled error');
    res
      .status(500)
      .json({ error: { code: 'INTERNAL', message } });
  };
}
