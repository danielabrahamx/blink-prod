import pg from 'pg';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Postgres pool + typed query helper.
 *
 * The real schema + migrations ship from Agent B's `feat/db-schema` branch.
 * Agent A keeps this file ready so downstream modules can import a stable
 * `query<T>()` surface and swap the in-memory `Store` for a pg-backed one
 * once the schemas land.
 *
 * The pool is created lazily on first access so tests + non-DB workflows
 * never require a live server. `setPool` lets tests inject a mock.
 */

let singleton: Pool | null = null;

export interface QueryableConfig {
  DATABASE_URL?: string;
}

export function setPool(p: Pool | null): void {
  singleton = p;
}

export function getPool(config: QueryableConfig = { DATABASE_URL: process.env.DATABASE_URL }): Pool {
  if (singleton) return singleton;
  const connectionString = config.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set and no pool has been injected. Call setPool() in tests.',
    );
  }
  singleton = new pg.Pool({ connectionString });
  return singleton;
}

/**
 * Typed query helper. `T` is the row shape the caller expects; runtime
 * validation remains the caller's responsibility (pair with zod when the
 * row shape is user-facing).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  config?: QueryableConfig,
): Promise<QueryResult<T>> {
  const pool = getPool(config);
  return pool.query<T>(sql, params as unknown[]);
}

/**
 * Run a callback inside a transaction. Commits on success, rolls back on
 * any thrown error, and releases the client either way.
 */
export async function withTransaction<R>(
  fn: (client: PoolClient) => Promise<R>,
  config?: QueryableConfig,
): Promise<R> {
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Deliberate: the original error is the one we want to surface.
    }
    throw err;
  } finally {
    client.release();
  }
}
