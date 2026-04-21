import 'dotenv/config';
import type { RequestHandler } from 'express';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

/**
 * Production entrypoint. In real mode (Circle creds + x402 middleware
 * installed), we wire `createGatewayMiddleware` from
 * `@circlefin/x402-batching`. In local dev or tests, that package may not
 * be installed (Cloudsmith token absent) so the import is guarded; the
 * server still boots and exposes the rest of the API.
 */

type GatewayRequire = (price: string) => RequestHandler;

async function createGatewayRequireOrNull(
  sellerAddress: string | undefined,
): Promise<GatewayRequire | null> {
  if (!sellerAddress) return null;
  try {
    // Dynamic import so the app still boots when the optional Cloudsmith
    // package is unavailable (e.g. CI without a CLOUDSMITH_TOKEN).
    const mod = await import('@circlefin/x402-batching/server' as string);
    const factory = (mod as unknown as {
      createGatewayMiddleware: (opts: {
        sellerAddress: string;
        networks: string[];
      }) => { require: (price: string) => RequestHandler };
    }).createGatewayMiddleware;
    const gateway = factory({
      sellerAddress,
      networks: ['eip155:5042002'],
    });
    return (price: string) => gateway.require(price);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const gatewayRequire = await createGatewayRequireOrNull(
    config.CIRCLE_WALLET_ADDRESS,
  );

  const app = createApp({
    x402GatewayRequire: gatewayRequire ?? undefined,
    logger,
    config,
  });

  const port = config.PORT;
  const server = app.listen(port, () => {
    const routes = [
      'GET  /api/health',
      `GET  /api/insure/active  ${gatewayRequire ? '(x402 gated)' : '(ungated)'}`,
      `GET  /api/insure/idle    ${gatewayRequire ? '(x402 gated)' : '(ungated)'}`,
      'POST /devices/register',
      'POST /policies/create',
      'POST /policies/fund',
      'POST /policies/topup',
      'POST /policies/cancel',
      'POST /signals',
      'POST /claims/submit',
      'POST /claims/approve',
      'GET  /admin/metrics',
      'GET  /admin/policy/:id',
      'GET  /admin/export/:id',
      'POST /admin/replay',
    ];
    logger.info({ port, routes }, 'Blink backend listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutdown requested');
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'server close failed');
        process.exit(1);
      }
      logger.info('server closed');
      process.exit(0);
    });
    // Fail-safe: bail if graceful close is slow.
    setTimeout(() => {
      logger.warn('forced exit after 10s graceful window');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal startup error:', err);
  process.exit(1);
});
