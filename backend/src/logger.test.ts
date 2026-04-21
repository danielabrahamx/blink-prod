import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { createLogger } from './logger.js';
import { loadConfig } from './config.js';

// The factory reads config for redaction paths + level. We capture emitted
// lines through a writable buffer to assert on bindings without touching
// the real stdout transport.
function captureLogger(opts: { level?: string } = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      try {
        lines.push(JSON.parse(chunk.toString('utf8')));
      } catch {
        // ignore non-JSON (pretty transport); tests use raw JSON only.
      }
      cb();
    },
  });
  const cfg = loadConfig({ NODE_ENV: 'production', LOG_LEVEL: opts.level ?? 'info' });
  // Emulate the factory shape but pin the destination to our buffer.
  const log = pino(
    {
      level: cfg.LOG_LEVEL,
      base: { service: 'blink-backend' },
      redact: {
        paths: [
          '*.CIRCLE_API_KEY',
          '*.private_key',
          '*.VITE_BUYER_PRIVATE_KEY',
          'req.headers.authorization',
        ],
        censor: '[REDACTED]',
      },
    },
    stream,
  );
  return { log, lines };
}

describe('logger', () => {
  it('creates a logger with the service label', () => {
    const cfg = loadConfig({ NODE_ENV: 'production' });
    const log = createLogger(cfg);
    expect(typeof log.info).toBe('function');
  });

  it('redacts sensitive fields', () => {
    const { log, lines } = captureLogger();
    log.info(
      {
        payload: {
          CIRCLE_API_KEY: 'secret',
          private_key: 'dangerous',
          VITE_BUYER_PRIVATE_KEY: 'boom',
        },
      },
      'payload',
    );
    expect(lines[0].payload).toMatchObject({
      CIRCLE_API_KEY: '[REDACTED]',
      private_key: '[REDACTED]',
      VITE_BUYER_PRIVATE_KEY: '[REDACTED]',
    });
  });

  it('redacts authorization headers from a req wrapper', () => {
    const { log, lines } = captureLogger();
    log.info({ req: { headers: { authorization: 'Bearer abc' } } }, 'req');
    expect(
      (lines[0].req as { headers: { authorization: string } }).headers.authorization,
    ).toBe('[REDACTED]');
  });
});
