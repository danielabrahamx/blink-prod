/**
 * Typed Postgres Pool wrapper for the Blink backend.
 *
 * Reads the DATABASE_URL environment variable. Callers should prefer the
 * exported `pool`, `query`, and `withTransaction` helpers over constructing
 * their own clients so we get uniform pooling, timeouts, and logging.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export interface DbConfig {
    connectionString: string;
    maxPoolSize?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    statementTimeoutMillis?: number;
    applicationName?: string;
}

function readConfigFromEnv(): DbConfig {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }
    return {
        connectionString,
        maxPoolSize: parseIntOr(process.env.PGPOOL_MAX, 10),
        idleTimeoutMillis: parseIntOr(process.env.PGPOOL_IDLE_MS, 30_000),
        connectionTimeoutMillis: parseIntOr(process.env.PGPOOL_CONNECT_MS, 5_000),
        statementTimeoutMillis: parseIntOr(process.env.PG_STATEMENT_TIMEOUT_MS, 10_000),
        applicationName: process.env.PG_APPLICATION_NAME ?? "blink-backend",
    };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

export function createPool(config: DbConfig = readConfigFromEnv()): Pool {
    const pool = new Pool({
        connectionString: config.connectionString,
        max: config.maxPoolSize,
        idleTimeoutMillis: config.idleTimeoutMillis,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        application_name: config.applicationName,
    });

    // Set a safety statement_timeout on every new client so a stuck query does
    // not hang the pool forever.
    pool.on("connect", (client) => {
        if (config.statementTimeoutMillis && config.statementTimeoutMillis > 0) {
            client
                .query(`SET statement_timeout = ${config.statementTimeoutMillis}`)
                .catch(() => { /* best-effort; pool will retry on next checkout */ });
        }
    });

    pool.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("[db] idle client error", err);
    });

    return pool;
}

// Lazy singleton so importing this module does not force a connection at test
// collection time. Tests may call `setPool` to inject an isolated pool.
let _pool: Pool | null = null;

export function getPool(): Pool {
    if (!_pool) {
        _pool = createPool();
    }
    return _pool;
}

export function setPool(pool: Pool | null): void {
    _pool = pool;
}

export async function closePool(): Promise<void> {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
}

export async function query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
): Promise<QueryResult<R>> {
    return getPool().query<R>(text, params as unknown[]);
}

export async function withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw err;
    } finally {
        client.release();
    }
}

export type { Pool, PoolClient, QueryResult, QueryResultRow };
