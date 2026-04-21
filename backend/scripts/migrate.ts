/**
 * CLI entrypoint for Blink database migrations.
 *
 * Wraps `backend/src/migrate.ts` with env-var validation and a subcommand
 * surface that plays nicely with node-pg-migrate conventions.
 *
 * Usage:
 *     bun run scripts/migrate.ts up             # apply all pending migrations
 *     bun run scripts/migrate.ts down           # roll every migration back
 *     bun run scripts/migrate.ts seed           # apply migrations/seed.sql
 *     bun run scripts/migrate.ts status         # show applied versions
 *     bun run scripts/migrate.ts create <name>  # scaffold a new NNN_<name>.up|down.sql pair
 *
 * DATABASE_URL must be set for up / down / seed / status. Exits non-zero on
 * failure.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool } from "../src/db";
import {
    MIGRATIONS_TABLE,
    applySeed,
    defaultMigrationsDir,
    discoverMigrations,
    rollbackAll,
    runMigrations,
} from "../src/migrate";

type Subcommand = "up" | "down" | "seed" | "status" | "create";

interface ParsedArgs {
    cmd: Subcommand;
    rest: string[];
}

const KNOWN_COMMANDS: readonly Subcommand[] = ["up", "down", "seed", "status", "create"] as const;

function isSubcommand(raw: string | undefined): raw is Subcommand {
    return raw !== undefined && (KNOWN_COMMANDS as readonly string[]).includes(raw);
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
    const cmd = argv[2];
    if (!isSubcommand(cmd)) return null;
    return { cmd, rest: argv.slice(3) };
}

function usage(): void {
    console.error("usage: migrate.ts <up|down|seed|status|create <name>>");
}

function ensureDatabaseUrl(): void {
    if (!process.env.DATABASE_URL) {
        console.error(
            "[migrate] DATABASE_URL is not set. Set it in backend/.env or export it in the shell.\n" +
                "          Example: postgres://postgres:postgres@localhost:5433/blink",
        );
        process.exit(2);
    }
}

function nextMigrationVersion(dir: string): number {
    const migs = discoverMigrations(dir);
    if (migs.length === 0) return 1;
    const last = migs[migs.length - 1];
    return last ? last.version + 1 : 1;
}

function padVersion(n: number): string {
    return n.toString().padStart(3, "0");
}

function sanitizeName(raw: string): string {
    const name = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!name) {
        throw new Error(`Invalid migration name: ${JSON.stringify(raw)}`);
    }
    return name;
}

function scaffold(
    dir: string,
    rawName: string,
): { upPath: string; downPath: string; version: number } {
    const name = sanitizeName(rawName);
    const version = nextMigrationVersion(dir);
    const upPath = join(dir, `${padVersion(version)}_${name}.up.sql`);
    const downPath = join(dir, `${padVersion(version)}_${name}.down.sql`);
    if (existsSync(upPath) || existsSync(downPath)) {
        throw new Error(`Refusing to overwrite existing migration files at ${upPath}`);
    }
    writeFileSync(upPath, `-- ${padVersion(version)} ${name}\n-- UP migration\n\n`, "utf8");
    writeFileSync(downPath, `-- ${padVersion(version)} ${name}\n-- DOWN migration\n\n`, "utf8");
    return { upPath, downPath, version };
}

async function showStatus(): Promise<void> {
    const pool = getPool();
    const migs = discoverMigrations();
    const tableExists = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
        ) AS exists`,
        [MIGRATIONS_TABLE],
    );
    const applied = new Set<number>();
    const firstRow = tableExists.rows[0];
    if (firstRow?.exists) {
        const { rows } = await pool.query<{ version: number }>(
            `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version ASC`,
        );
        for (const r of rows) applied.add(r.version);
    }
    console.log("migration status:");
    if (migs.length === 0) {
        console.log("  (no migrations found)");
        return;
    }
    for (const m of migs) {
        const mark = applied.has(m.version) ? "up  " : "down";
        console.log(`  [${mark}] ${padVersion(m.version)}_${m.name}`);
    }
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);
    if (!parsed) {
        usage();
        process.exit(2);
    }

    if (parsed.cmd === "create") {
        const name = parsed.rest[0];
        if (!name) {
            console.error("usage: migrate.ts create <name>");
            process.exit(2);
        }
        const dir = defaultMigrationsDir();
        const { upPath, downPath, version } = scaffold(dir, name);
        console.log(`created migration v${version}:`);
        console.log(`  ${upPath}`);
        console.log(`  ${downPath}`);
        return;
    }

    ensureDatabaseUrl();

    const pool = getPool();
    try {
        switch (parsed.cmd) {
            case "up": {
                const executed = await runMigrations(pool);
                console.log(`applied ${executed.length} migration(s):`);
                for (const m of executed) console.log(`  - ${padVersion(m.version)}_${m.name}`);
                break;
            }
            case "down": {
                const executed = await rollbackAll(pool);
                console.log(`rolled back ${executed.length} migration(s):`);
                for (const m of executed) console.log(`  - ${padVersion(m.version)}_${m.name}`);
                break;
            }
            case "seed": {
                await applySeed(pool);
                console.log("seed applied");
                break;
            }
            case "status": {
                await showStatus();
                break;
            }
        }
    } finally {
        await closePool();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
