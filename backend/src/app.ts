import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Express } from 'express';
import type { Logger } from './logger.js';
import type { AppConfig } from './config.js';
import type { RedisLike } from './lib/redis.js';
import { getRedisClient } from './lib/redis.js';
import { MemoryRedis } from './lib/memoryRedis.js';
import type { Store } from './lib/store.js';
import { createMemoryStore } from './lib/store.js';
import { installContext } from './lib/context.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import {
  insureActiveHandler,
  insureIdleHandler,
} from './legacy/insure.js';
import { devicesRouter } from './routes/devices.js';
import { policiesRouter } from './routes/policies.js';
import { signalsRouter } from './routes/signals.js';
import { claimsRouter } from './routes/claims.js';
import { adminRouter } from './routes/admin.js';
import { createLogger } from './logger.js';
import { loadConfig } from './config.js';

export interface CreateAppOptions {
  redis?: RedisLike;
  store?: Store;
  /**
   * Optional x402 gateway middleware factory. When present, /api/insure/*
   * routes are gated behind it exactly as in the legacy server.js. When
   * absent (tests, local dev without Circle creds), the routes are
   * reachable unauthenticated.
   */
  x402GatewayRequire?: (price: string) => express.RequestHandler;
  /**
   * Pre-built config / logger. Mostly used from server.ts and tests.
   * When absent we parse the environment and create a defaults-driven
   * logger so `createApp()` is one-liner callable.
   */
  config?: AppConfig;
  logger?: Logger;
  /**
   * Optional pricing override. Falls back to config-derived defaults.
   */
  baseRates?: {
    active_per_second_usdc: number;
    idle_per_second_usdc: number;
  };
}

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const redis =
    options.redis ??
    (config.REDIS_URL ? getRedisClient() : new MemoryRedis());
  const store = options.store ?? createMemoryStore();
  installContext(app, {
    redis,
    store,
    baseRates: options.baseRates ?? {
      active_per_second_usdc: config.ACTIVE_PER_SECOND_USDC,
      idle_per_second_usdc: config.IDLE_PER_SECOND_USDC,
    },
    logger,
    config,
  });

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      exposedHeaders: [
        'PAYMENT-REQUIRED',
        'PAYMENT-RESPONSE',
        'x-request-id',
      ],
    }),
  );
  app.use(express.json({ limit: config.BODY_LIMIT }));

  // Legacy x402 endpoints. Contract preserved identically to server.js.
  const gatewayRequire = options.x402GatewayRequire;
  if (gatewayRequire) {
    const activePrice = `$${config.ACTIVE_PER_SECOND_USDC}`;
    const idlePrice = `$${config.IDLE_PER_SECOND_USDC}`;
    app.get(
      '/api/insure/active',
      gatewayRequire(activePrice),
      insureActiveHandler,
    );
    app.get(
      '/api/insure/idle',
      gatewayRequire(idlePrice),
      insureIdleHandler,
    );
  } else {
    // Ungated fallback (tests + local dev). Still returns the same body.
    app.get('/api/insure/active', insureActiveHandler);
    app.get('/api/insure/idle', insureIdleHandler);
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'Blink backend service is running',
      timestamp: new Date().toISOString(),
    });
  });

  // New v1 surface.
  app.use('/devices', devicesRouter());
  app.use('/policies', policiesRouter());
  app.use('/signals', signalsRouter());
  app.use('/claims', claimsRouter());
  app.use('/admin', adminRouter());

  app.use(notFoundHandler);
  app.use(errorHandler());
  return app;
}
