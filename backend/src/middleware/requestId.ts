import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Middleware that attaches a stable request id to every request.
 *
 * Respects an incoming `x-request-id` header (so callers behind a gateway
 * can propagate their trace) and falls back to a UUID v4.
 *
 * The id is echoed back in the response for client-side log stitching.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    // Populated by requestId middleware; route handlers can assume non-null.
    request_id: string;
  }
}

export function requestId() {
  return function requestIdMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const existing = req.header(REQUEST_ID_HEADER);
    const id = existing && existing.length > 0 ? existing : randomUUID();
    req.request_id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
