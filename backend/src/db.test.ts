import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { query, withTransaction, setPool, getPool } from './db.js';

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

function buildPoolMock() {
  const client: FakeClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

describe('db', () => {
  beforeEach(() => {
    setPool(null);
  });

  afterEach(() => {
    setPool(null);
  });

  it('routes query() through the injected pool', async () => {
    const { pool } = buildPoolMock();
    setPool(pool);
    const res = await query<{ a: number }>('SELECT $1::int AS a', [1]);
    expect(res.rows).toEqual([{ a: 1 }]);
    expect(
      (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe('SELECT $1::int AS a');
  });

  it('throws when no DATABASE_URL and no injected pool', async () => {
    await expect(
      query('SELECT 1', [], { DATABASE_URL: undefined }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it('commits transactions on success', async () => {
    const { pool, client } = buildPoolMock();
    setPool(pool);
    const out = await withTransaction(async (c) => {
      await c.query('SELECT 1');
      return 42;
    });
    expect(out).toBe(42);
    const calls = client.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back on thrown error and re-throws', async () => {
    const { pool, client } = buildPoolMock();
    setPool(pool);
    await expect(
      withTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const calls = client.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('getPool returns the injected pool reference', () => {
    const { pool } = buildPoolMock();
    setPool(pool);
    expect(getPool()).toBe(pool);
  });
});
