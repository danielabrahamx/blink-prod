/* Lightweight SQL migration runner for the settlement layer.
 * Applies every .sql file in backend/migrations in lexical order.
 * Idempotent: relies on CREATE ... IF NOT EXISTS inside each migration.
 * Real migration orchestration lives in Agent B; this runner is here so the
 * settlement branch is self-sufficient for tests and local dev.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set; skipping migration.');
    process.exit(0);
  }
  const pool = new Pool({ connectionString });
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      process.stdout.write(`Applying ${file}... `);
      await pool.query(sql);
      process.stdout.write('ok\n');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
