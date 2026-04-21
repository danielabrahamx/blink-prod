/**
 * Thin postgres pool wrapper. All settlement code depends on the `Queryable`
 * interface so tests can inject an in-memory fake without pulling `pg` in.
 *
 * Prod callers use `getPool()` which returns a singleton `pg.Pool` bound to
 * DATABASE_URL. Tests construct their own `Queryable` (see db/fake.ts).
 */
import { Pool, type QueryResult } from 'pg';

export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<R>>;
}

let singleton: Pool | null = null;

export function getPool(): Pool {
  if (singleton) return singleton;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }
  singleton = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  return singleton;
}

/** Lets tests swap the shared pool for a fake. */
export function setPoolForTesting(pool: Queryable | null): void {
  singleton = pool as unknown as Pool | null;
}

export async function closePool(): Promise<void> {
  if (singleton && typeof (singleton as Pool).end === 'function') {
    await (singleton as Pool).end();
  }
  singleton = null;
}
