import type { RedisLike } from './redis.js';
import type { Store } from './store.js';
import type { Logger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Per-app runtime context. Created by the app factory and attached to the
 * Express app via {@link installContext}, read back by route handlers via
 * {@link getContext}. Keeping it off the module-global namespace lets tests
 * spin up isolated apps.
 */

export interface AppContext {
  redis: RedisLike;
  store: Store;
  baseRates: {
    active_per_second_usdc: number;
    idle_per_second_usdc: number;
  };
  logger: Logger;
  config: AppConfig;
}

const SYMBOL_KEY = '__blink_app_context__';

export function installContext(app: unknown, ctx: AppContext): void {
  (app as Record<string, unknown>)[SYMBOL_KEY] = ctx;
}

export function getContext(app: unknown): AppContext {
  const ctx = (app as Record<string, unknown>)[SYMBOL_KEY];
  if (!ctx) throw new Error('AppContext not installed');
  return ctx as AppContext;
}
