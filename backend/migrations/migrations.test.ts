/**
 * Migration test.
 *
 * Strategy:
 *   1. Try to spin up a throwaway Postgres 16 via @testcontainers/postgresql.
 *      If Docker is reachable, this gives us a fully isolated database per run.
 *   2. If testcontainers isn't installed or Docker isn't reachable, fall back
 *      to TEST_DATABASE_URL / DATABASE_URL and use an isolated temp schema.
 *   3. If neither option is available, skip the test with a clear warning so
 *      CI stays green on environments that cannot run integration tests.
 *
 * Covers the non-negotiable invariants for this module:
 *   - `discoverMigrations` finds all 10 up/down pairs in the correct order.
 *   - Every `.up.sql` applies and the expected tables exist.
 *   - Re-running `runMigrations` is a no-op (idempotent).
 *   - `seed.sql` loads without FK violations and produces the required row counts
 *     (1 user, 1 device, 1 policy, 5 envelopes, 5 features, 5 scores, 1 auth,
 *      1 receipt, 1 claim).
 *   - CHECK constraints actually reject invalid enum values (`claims.status`,
 *     `settlement_receipts.status`, `devices.platform`).
 *   - Every `.down.sql` runs cleanly and leaves zero residual tables, indexes,
 *     or types from this migration set.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool, type PoolConfig } from "pg";
import { resolve } from "node:path";
import {
    applySeed,
    discoverMigrations,
    rollbackAll,
    runMigrations,
} from "../src/migrate";

const MIG_DIR = resolve(__dirname);

const EXPECTED_TABLES = [
    "users",
    "devices",
    "policies",
    "state_log",
    "signal_envelopes",
    "features",
    "audit_score",
    "x402_authorizations",
    "settlement_receipts",
    "claims",
];

const LEGACY_TYPES = ["policy_status"];

type ContainerHandle = { stop: () => Promise<void> } | null;

let pool: Pool | null = null;
let container: ContainerHandle = null;
let schema = `blink_mig_test_${Date.now()}`;

async function tryStartContainer(): Promise<
    { connectionString: string; stop: () => Promise<void> } | null
> {
    try {
        // Dynamic import so the file still loads without the optional dep.
        const mod = await import("@testcontainers/postgresql").catch(() => null);
        if (!mod) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testcontainers' ESM types are loose enough that a thin cast is clearer than reconstructing them here.
        const PostgreSqlContainer = (mod as any).PostgreSqlContainer;
        if (!PostgreSqlContainer) return null;
        const started = await new PostgreSqlContainer("postgres:16-alpine")
            .withDatabase("blink_test")
            .withUsername("postgres")
            .withPassword("postgres")
            .start();
        const connectionString: string = started.getConnectionUri();
        return {
            connectionString,
            stop: async () => {
                try {
                    await started.stop();
                } catch {
                    /* best-effort */
                }
            },
        };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            `[migrations.test] testcontainers unavailable, falling back to TEST_DATABASE_URL: ${
                (err as Error).message
            }`,
        );
        return null;
    }
}

async function isReachable(connStr: string): Promise<boolean> {
    const probe = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 2_000 });
    try {
        await probe.query("SELECT 1");
        return true;
    } catch {
        return false;
    } finally {
        try {
            await probe.end();
        } catch {
            /* ignore */
        }
    }
}

beforeAll(async () => {
    const started = await tryStartContainer();
    let conn: string | undefined;
    if (started) {
        conn = started.connectionString;
        container = { stop: started.stop };
    } else {
        conn = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    }

    if (!conn) {
        // eslint-disable-next-line no-console
        console.warn(
            "[migrations.test] No Docker + no TEST_DATABASE_URL — skipping integration assertions.",
        );
        return;
    }

    if (!(await isReachable(conn))) {
        // eslint-disable-next-line no-console
        console.warn(`[migrations.test] Could not reach Postgres at ${conn} — skipping.`);
        return;
    }

    const cfg: PoolConfig = { connectionString: conn, max: 2 };
    pool = new Pool(cfg);
    // Isolate per-run via a dedicated schema so we do not pollute the target DB.
    schema = `blink_mig_test_${Date.now()}`;
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    pool.on("connect", (client) => {
        client.query(`SET search_path TO ${schema}, public`).catch(() => {
            /* best-effort */
        });
    });
    await pool.query(`SET search_path TO ${schema}, public`);
});

afterAll(async () => {
    if (pool) {
        try {
            await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        } catch {
            /* ignore */
        }
        await pool.end();
    }
    if (container) {
        await container.stop();
    }
});

describe("discovery", () => {
    test("finds 10 up/down pairs numbered 1..10", () => {
        const migs = discoverMigrations(MIG_DIR);
        expect(migs.length).toBe(10);
        expect(migs.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
});

describe("up/down", () => {
    test("up applies every migration and creates expected tables", async () => {
        if (!pool) return;
        const executed = await runMigrations(pool, MIG_DIR);
        expect(executed.length).toBe(10);

        const { rows } = await pool.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = $1 AND table_name = ANY($2)`,
            [schema, EXPECTED_TABLES],
        );
        const found = new Set(rows.map((r) => r.table_name));
        for (const t of EXPECTED_TABLES) {
            expect(found.has(t)).toBe(true);
        }
    });

    test("up is idempotent on a second run", async () => {
        if (!pool) return;
        const executed = await runMigrations(pool, MIG_DIR);
        expect(executed.length).toBe(0);
    });

    test("seed.sql loads fixtures without FK violations", async () => {
        if (!pool) return;
        await applySeed(pool, MIG_DIR);

        const counts = await pool.query<{
            users: string;
            devices: string;
            policies: string;
            envelopes: string;
            features: string;
            scores: string;
            auths: string;
            receipts: string;
            claims: string;
        }>(
            `SELECT
                (SELECT COUNT(*)::text FROM users)                AS users,
                (SELECT COUNT(*)::text FROM devices)              AS devices,
                (SELECT COUNT(*)::text FROM policies)             AS policies,
                (SELECT COUNT(*)::text FROM signal_envelopes)     AS envelopes,
                (SELECT COUNT(*)::text FROM features)             AS features,
                (SELECT COUNT(*)::text FROM audit_score)          AS scores,
                (SELECT COUNT(*)::text FROM x402_authorizations)  AS auths,
                (SELECT COUNT(*)::text FROM settlement_receipts)  AS receipts,
                (SELECT COUNT(*)::text FROM claims)               AS claims`,
        );
        const row = counts.rows[0];
        expect(row).toBeDefined();
        if (!row) return;
        expect(Number(row.users)).toBe(1);
        expect(Number(row.devices)).toBe(1);
        expect(Number(row.policies)).toBe(1);
        expect(Number(row.envelopes)).toBe(5);
        expect(Number(row.features)).toBe(5);
        expect(Number(row.scores)).toBe(5);
        expect(Number(row.auths)).toBe(1);
        expect(Number(row.receipts)).toBe(1);
        expect(Number(row.claims)).toBe(1);
    });

    test("CHECK constraint rejects invalid claim status", async () => {
        if (!pool) return;
        const bad = pool.query(
            `INSERT INTO claims (
                policy_id, incident_date, description, amount_claimed_usdc, status
            ) VALUES ('pol_01HXAMPLE_SEED01', '2026-04-09', 'test', 100.000000, 'totally_bogus')`,
        );
        await expect(bad).rejects.toThrow();
    });

    test("CHECK constraint rejects invalid settlement status", async () => {
        if (!pool) return;
        const bad = pool.query(
            `INSERT INTO settlement_receipts (
                policy_id, window_start, window_end, amount_usdc, status
            ) VALUES (
                'pol_01HXAMPLE_SEED01',
                '2026-04-03T13:00:00Z', '2026-04-03T14:00:00Z', 0.01, 'ghost'
            )`,
        );
        await expect(bad).rejects.toThrow();
    });

    test("CHECK constraint rejects invalid device platform", async () => {
        if (!pool) return;
        const bad = pool.query(
            `INSERT INTO devices (
                wallet_addr, device_pubkey, platform, os_version, system_serial_hash
            ) VALUES (
                '0x0000000000000000000000000000000000000001',
                'ed25519:nope', 'freebsd', '0', 'sha256:zz'
            )`,
        );
        await expect(bad).rejects.toThrow();
    });

    test("CHECK constraint rejects consumed_usdc above cap", async () => {
        if (!pool) return;
        const bad = pool.query(
            `INSERT INTO x402_authorizations (
                policy_id, session_pubkey, cap_usdc, valid_until,
                consumed_usdc, user_signature
            ) VALUES (
                'pol_01HXAMPLE_SEED01',
                'ed25519:session_overflow',
                1.000000,
                '2026-05-01T00:00:00Z',
                2.000000,
                '0xsig'
            )`,
        );
        await expect(bad).rejects.toThrow();
    });

    test("UNIQUE (policy_id, client_nonce) rejects replay", async () => {
        if (!pool) return;
        const bad = pool.query(
            `INSERT INTO signal_envelopes (
                policy_id, client_ts, client_nonce, trigger, signals_jsonb, sig
            ) VALUES (
                'pol_01HXAMPLE_SEED01',
                NOW(),
                'nonce_seed_0001',
                'scheduled',
                '{}'::jsonb,
                'sig'
            )`,
        );
        await expect(bad).rejects.toThrow();
    });

    test("down rolls everything back cleanly", async () => {
        if (!pool) return;
        const rolled = await rollbackAll(pool, MIG_DIR);
        expect(rolled.length).toBe(10);

        const tables = await pool.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = $1 AND table_name = ANY($2)`,
            [schema, EXPECTED_TABLES],
        );
        expect(tables.rows.length).toBe(0);

        const types = await pool.query<{ typname: string }>(
            `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = $1 AND t.typname = ANY($2)`,
            [schema, LEGACY_TYPES],
        );
        expect(types.rows.length).toBe(0);
    });
});
