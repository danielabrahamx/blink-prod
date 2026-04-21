import { z } from 'zod';

/**
 * Runtime configuration. Parsed from `process.env` at boot. Any missing or
 * malformed variable crashes fast so we never ship a partially configured
 * process. Most knobs have safe defaults so local dev can boot with an
 * empty `.env`; only `DATABASE_URL` is strictly required when
 * `REQUIRE_POSTGRES=true` (pilot production).
 */

const booleanFromEnv = z
  .union([z.string(), z.boolean()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  });

const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Required if REQUIRE_POSTGRES is true, otherwise optional for local dev.
  DATABASE_URL: z.string().optional(),
  REQUIRE_POSTGRES: booleanFromEnv.optional(),

  REDIS_URL: z.string().optional(),
  GEOIP_DB_PATH: z.string().optional(),
  GEOIP_LOCAL_COUNTRY: z.string().length(2).optional(),

  // Circle / Arc chain. Optional because the non-legacy API surface does
  // not need them; they only matter for the x402 gateway on /api/insure/*.
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_WALLET_ADDRESS: z.string().optional(),
  ARC_RPC_URL: z
    .string()
    .url()
    .default('https://rpc.testnet.arc.network'),
  BLINKRESERVE_ADDRESS: z.string().optional(),

  // Pricing knobs (USDC per second). Match the contract in server.js.
  ACTIVE_PER_SECOND_USDC: z.coerce.number().positive().default(0.000005),
  IDLE_PER_SECOND_USDC: z.coerce.number().positive().default(0.00001),

  // Structured-log level.
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Body parser size limit. Large signals envelope batches (offline flush)
  // occasionally hit the default Express 100kb cap.
  BODY_LIMIT: z.string().default('1mb'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid config: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.REQUIRE_POSTGRES && !cfg.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required when REQUIRE_POSTGRES=true',
    );
  }
  return cfg;
}
