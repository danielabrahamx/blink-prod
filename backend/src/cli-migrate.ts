/**
 * Thin CLI shim kept for backward compatibility with the `src/cli-migrate.ts`
 * path. Forwards to `scripts/migrate.ts` which is the canonical entrypoint.
 */

import { applySeed, rollbackAll, runMigrations } from "./migrate";
import { closePool, getPool } from "./db";

type LegacyCommand = "up" | "down" | "seed";

function isLegacy(cmd: string | undefined): cmd is LegacyCommand {
    return cmd === "up" || cmd === "down" || cmd === "seed";
}

async function main(): Promise<void> {
    const cmd = process.argv[2];
    if (!isLegacy(cmd)) {
        console.error("usage: cli-migrate.ts <up|down|seed>");
        process.exit(2);
    }

    const pool = getPool();
    try {
        if (cmd === "up") {
            const executed = await runMigrations(pool);
            console.log(`applied ${executed.length} migration(s):`);
            for (const m of executed) console.log(`  - ${m.version}_${m.name}`);
        } else if (cmd === "down") {
            const executed = await rollbackAll(pool);
            console.log(`rolled back ${executed.length} migration(s):`);
            for (const m of executed) console.log(`  - ${m.version}_${m.name}`);
        } else {
            await applySeed(pool);
            console.log("seed applied");
        }
    } finally {
        await closePool();
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
