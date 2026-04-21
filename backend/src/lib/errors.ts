/**
 * Typed errors surfaced from modules, translated to HTTP codes by middleware.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'BAD_REQUEST', details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(401, message, 'UNAUTHORIZED', details);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, message, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends HttpError {
  constructor(message = 'Too many requests', details?: unknown) {
    super(429, message, 'RATE_LIMITED', details);
    this.name = 'RateLimitError';
  }
}

export class NotImplementedError extends HttpError {
  constructor(message = 'Not implemented', details?: unknown) {
    super(501, message, 'NOT_IMPLEMENTED', details);
    this.name = 'NotImplementedError';
  }
}
