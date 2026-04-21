import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '../logger.js';

/**
 * Per-request child logger + access log. Emits one structured log line per
 * request with method, path, status, latency_ms, request_id.
 *
 * Downstream handlers can read `req.log` to emit additional events that
 * inherit the same bindings (request_id + any wallet / policy context added
 * via `req.log = req.log.child({ policy_id })`).
 */

declare module 'express-serve-static-core' {
  interface Request {
    log: Logger;
  }
}

export function requestLogger(root: Logger) {
  return function requestLoggerMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const start = process.hrtime.bigint();
    req.log = root.child({
      request_id: req.request_id,
      method: req.method,
      path: req.originalUrl,
    });
    res.on('finish', () => {
      const end = process.hrtime.bigint();
      const latency_ms = Number(end - start) / 1e6;
      const bindings = {
        status: res.statusCode,
        latency_ms: Math.round(latency_ms * 1000) / 1000,
      };
      const level = res.statusCode >= 500 ? 'error' : 'info';
      req.log[level](bindings, 'request completed');
    });
    next();
  };
}
