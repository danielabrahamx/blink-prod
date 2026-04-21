/**
 * Lightweight SQL migration runner.
 *
 * Discovers `NNN_*.up.sql` and `NNN_*.down.sql` files in `backend/migrations`,
 * tracks applied versions in a `_blink_migrations` table, and applies/rolls
 * back in order. Each migration runs inside a single transaction.
 *
 * Usage:
 *   import { runMigrations, rollbackAll } from "./migrate";
 *   await runMigrations(pool);
 *   await rollbackAll(pool);
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Pool } from "pg";

export interface MigrationFile {
    version: number;
    name: string;
    upPath: string;
    downPath: string;
}

export const MIGRATIONS_TABLE = "_blink_migrations";

export function defaultMigrationsDir(): string {
    return resolve(__dirname, "..", "migrations");
}

const UP_FILE_PATTERN = /^(\d+)_(.+)\.up\.sql$/;

export function discoverMigrations(dir: string = defaultMigrationsDir()): MigrationFile[] {
    const files = readdirSync(dir);
    const pairs = new Map<number, MigrationFile>();

    for (const up of files) {
        const match = UP_FILE_PATTERN.exec(up);
        if (!match) continue;
        const rawVersion = match[1];
        const name = match[2];
        if (!rawVersion || !name) continue;
        const version = Number.parseInt(rawVersion, 10);
        if (!Number.isFinite(version)) continue;
        const downName = `${rawVersion}_${name}.down.sql`;
        if (!files.includes(downName)) {
            throw new Error(`Missing down migration for ${up}: expected ${downName}`);
        }
        if (pairs.has(version)) {
            throw new Error(`Duplicate migration version ${version}`);
        }
        pairs.set(version, {
            version,
            name,
            upPath: join(dir, up),
            downPath: join(dir, downName),
        });
    }

    return [...pairs.values()].sort((a, b) => a.version - b.version);
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            version     INTEGER     PRIMARY KEY,
            name        TEXT        NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function getAppliedVersions(pool: Pool): Promise<Set<number>> {
    const { rows } = await pool.query<{ version: number }>(
        `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`,
    );
    return new Set(rows.map((r) => r.version));
}

export async function runMigrations(
    pool: Pool,
    dir: string = defaultMigrationsDir(),
): Promise<MigrationFile[]> {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedVersions(pool);
    const pending = discoverMigrations(dir).filter((m) => !applied.has(m.version));

    const executed: MigrationFile[] = [];
    for (const m of pending) {
        const sql = readFileSync(m.upPath, "utf8");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(
                `INSERT INTO ${MIGRATIONS_TABLE} (version, name) VALUES ($1, $2)`,
                [m.version, m.name],
            );
            await client.query("COMMIT");
            executed.push(m);
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* ignore */
            }
            throw new Error(
                `Failed to apply migration ${m.version}_${m.name}: ${(err as Error).message}`,
            );
        } finally {
            client.release();
        }
    }
    return executed;
}

export async function rollbackAll(
    pool: Pool,
    dir: string = defaultMigrationsDir(),
): Promise<MigrationFile[]> {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedVersions(pool);
    const toRollback = discoverMigrations(dir)
        .filter((m) => applied.has(m.version))
        .sort((a, b) => b.version - a.version);

    const executed: MigrationFile[] = [];
    for (const m of toRollback) {
        const sql = readFileSync(m.downPath, "utf8");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [m.version]);
            await client.query("COMMIT");
            executed.push(m);
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* ignore */
            }
            throw new Error(
                `Failed to roll back migration ${m.version}_${m.name}: ${(err as Error).message}`,
            );
        } finally {
            client.release();
        }
    }
    return executed;
}

export async function applySeed(
    pool: Pool,
    dir: string = defaultMigrationsDir(),
): Promise<void> {
    const sql = readFileSync(join(dir, "seed.sql"), "utf8");
    await pool.query(sql);
}
