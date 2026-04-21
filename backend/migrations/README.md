# Blink backend migrations

Numbered SQL migrations owned by Agent B (db-schema). Every migration ships as a pair of files:

```
NNN_<snake_case_name>.up.sql
NNN_<snake_case_name>.down.sql
```

The runner in `backend/src/migrate.ts` discovers both files by pattern, tracks applied versions in the `_blink_migrations` table, and applies each file inside a single transaction. There is no separate DSL: migrations are plain SQL.

## Tables

| # | Table | Owner module |
|---|-------|--------------|
| 001 | `users` | onboarding |
| 002 | `devices` | onboarding |
| 003 | `policies` | policy lifecycle |
| 004 | `state_log` | FSM audit log |
| 005 | `signal_envelopes` | signal ingest |
| 006 | `features` | feature extractor |
| 007 | `audit_score` | risk engine |
| 008 | `x402_authorizations` | settlement (x402 auto-signer) |
| 009 | `settlement_receipts` | settlement (Circle batching) |
| 010 | `claims` | claims v1 |

## Running migrations locally

1. Start Postgres. The fastest path on Windows without Docker is:

   ```bash
   # If you have docker-compose available:
   docker compose up -d db

   # Otherwise install Postgres 16 locally and create a blink database.
   ```

   Either way the expected connection string is:

   ```
   DATABASE_URL=postgres://postgres:postgres@localhost:5433/blink
   ```

   (The repo's `docker-compose.yml` binds Postgres to `5433` so it doesn't collide with a system Postgres already running on `5432`.)

2. Apply pending migrations:

   ```bash
   cd backend
   bun install
   bun run migrate:up
   ```

3. Load deterministic fixtures:

   ```bash
   bun run db:seed
   ```

4. Inspect status:

   ```bash
   bun run scripts/migrate.ts status
   ```

5. Rollback when needed (the test suite does this automatically):

   ```bash
   bun run migrate:down
   ```

## Creating a new migration

```bash
bun run migrate:create add_premium_overrides
```

The scaffolder writes a pair of numbered files and leaves you to fill them in. Every migration **must** include a working `DOWN` that is symmetric with the `UP` — the migration test enforces this.

## Running the migration test suite

Point the runner at any reachable Postgres and run the bun test:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/blink \
  bun test backend/migrations/migrations.test.ts
```

When `@testcontainers/postgresql` can reach a local Docker daemon (Docker Desktop on Windows or Linux), the test spins up a throwaway Postgres 16 container and uses that. On a Docker-free machine the test falls back to `TEST_DATABASE_URL`. If neither is available the test prints a clear skip reason rather than passing silently.

## CI conventions

- Migrations are forwards-only in production. Never edit a migration that has been applied on staging / prod — author a new one that reshapes the data.
- Every PR that touches `backend/migrations/` must keep the up/down test green.
- Seed data (`seed.sql`) is for dev + tests only. Do not load it into staging / prod.
- The `_blink_migrations` tracking table belongs to the `public` schema in prod (the test suite creates it inside a temp schema for isolation).

## Useful references

- Design doc: `C:\Users\danie\.gstack\projects\danielabrahamx-blink\danie-master-design-20260421-134454.md` — Modules 1-5 carry the schema motivation.
- Deviations: `docs/DEVIATIONS.md` — differences between the Agent B prompt and what actually shipped, with rationale.
