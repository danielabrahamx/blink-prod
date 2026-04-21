import pino from 'pino';
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';

/**
 * Structured logger factory. One root logger per process; request-scoped
 * child loggers are created in middleware/requestLogger.ts.
 *
 * Secret redaction is enforced here so no downstream caller can accidentally
 * log a raw authorization header, Circle API key, or private key even in a
 * `logger.info({ req }, ...)` dump.
 */

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // Common environment / payload leaks.
  '*.CIRCLE_API_KEY',
  '*.CLOUDSMITH_TOKEN',
  '*.PRIVATE_KEY',
  '*.private_key',
  '*.session_private_key',
  '*.VITE_BUYER_PRIVATE_KEY',
  '*.password',
];

export function createLogger(config: AppConfig): Logger {
  const isProd = config.NODE_ENV === 'production';
  const transport = isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'blink-backend' },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
      remove: false,
    },
    transport,
  });
}

export type { Logger };
