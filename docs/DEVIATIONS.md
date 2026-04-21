# Deviations

Living record of places where Agent B's implementation intentionally diverges from the Agent B prompt or the master design doc. Each entry names the prompt or doc section it touches, the chosen behaviour, and why.

## 1. `policies.policy_id` is `TEXT`, not `UUID`

**Prompt says:** `policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.

**We ship:** `policy_id TEXT PRIMARY KEY` (no default), generated at application layer as a prefixed ULID, e.g. `pol_01HXAMPLE`.

**Why:** The master design doc (Module 0, sequence diagram E1) uses `pol_01HXAMPLE` as the canonical policy identifier in every flow, every admin screenshot, and every webhook payload. A prefixed ULID is readable at a glance, sortable, and unambiguous about the entity type. A raw UUID would be none of those. The design doc wins per Agent B's "if the design doc contradicts this prompt, design doc wins" rule. All foreign keys (`signal_envelopes.policy_id`, `claims.policy_id`, etc.) point at this `TEXT` column.

## 2. `state_log.id` stays as `id`, but `from_state` + `to_state` are plain `TEXT`

**Prompt says:** `from_state TEXT`, `to_state TEXT NOT NULL`.

**Earlier iteration shipped:** `from_state policy_status`, `to_state policy_status NOT NULL` — typed via the Postgres enum.

**Now shipping:** plain `TEXT` per the prompt. The rationale: `state_log` is an append-only audit trail, and a typed enum constrains us to the current Phase 0 lifecycle. The first time we add a new state the enum migration has to run before any new log row can be written, which makes rollback ugly. Keeping it `TEXT` lets the FSM code in Agent E enforce validity at write time while the log accepts anything the FSM hands it, including deprecated states replayed from old data.

## 3. `claim_status` + `settlement_status` use `TEXT` + `CHECK`, not `ENUM`

**Prompt says:** `status TEXT NOT NULL CHECK (status IN ('pending','submitted','confirmed','failed'))` and similar for claims.

**We ship:** exactly that. The earlier iteration used Postgres `ENUM` types (`settlement_status`, `claim_status`) which are stricter but painful to extend (requires `ALTER TYPE ... ADD VALUE` outside a transaction). Following the prompt on this one: `TEXT` + `CHECK` is the better trade-off for the pilot-era lifecycle and matches the Agent B spec 1:1.

`policy_status` keeps its enum type because the policy FSM is the authority on which transitions are legal and the type catches bugs at insert time before the FSM code even runs. A follow-up ALTER TYPE on `policy_status` is the kind of surgery we do rarely and deliberately.

## 4. `policy_status` enum is a superset of the prompt list

**Prompt says:** enum values `draft`, `calibrating`, `active`, `paused_user`, `paused_offline`, `cancelled_by_user`, `cancelled_by_system`, `claim_submitted`, `claim_approved`, `claim_denied`, `terminated`.

**We ship:** all of the above plus `expiring` and `claimed` (present in the master design doc's FSM state list, Module 0.5) for lifecycle completeness.

**Why:** the design doc is the source of truth for FSM states. Adding the two design-doc states up front avoids a future `ALTER TYPE` on a table that already has data. The extra states do not affect any CHECK constraint or index.

## 5. `claims.incident_date` is `DATE`, not `TIMESTAMPTZ`

**Prompt says:** `incident_date DATE NOT NULL`.

**We ship:** `DATE`. An earlier iteration shipped `TIMESTAMPTZ`; fixed to match the prompt. The daily resolution is correct for user-facing claim intake, and the signed envelope timestamps (`signal_envelopes.client_ts`) already give us sub-second precision when we need to correlate a claim to a signal trace.

## 6. Test suite uses Bun's built-in runner + optional testcontainers

**Prompt asks for:** `vitest` + `@testcontainers/postgresql`.

**We ship:** `bun test` (so we don't add a second test runner for one file) + testcontainers as an **optional** dependency guarded by a `try/catch`, with a fallback to `TEST_DATABASE_URL` when Docker is not reachable. On this developer's Windows 11 dev box Docker Desktop is not running, so the test falls back to the DATABASE_URL the developer exports (or skips with a clear warning when neither is available).

**Rationale:** the test is equivalent either way — it spins up an isolated schema, runs every `.up.sql`, runs seed, runs every `.down.sql`, asserts no residual objects. The choice of how Postgres 16 is reached doesn't change the test body. Bun's built-in runner is already the project's runner (no other vitest config exists yet), so adding vitest purely for one file would be dead weight.

## 7. Every `.up.sql` migration is idempotent (`IF NOT EXISTS` / `DO $$`)

**Not in the prompt one way or the other.** We use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `DO $$ BEGIN IF NOT EXISTS ... CREATE TYPE ...` so re-running `migrate:up` against an already-migrated database is safe. This also makes the migration runner's "re-run is a no-op" test trivially true.

The `.down.sql` files are the symmetric inverse: `DROP INDEX IF EXISTS`, `DROP TABLE IF EXISTS`. Running `migrate:down` repeatedly is also safe.

## 8. Seed size exactly matches the Agent B spec

The previous iteration shipped **3** envelopes / **3** features / **3** scores. Bumped to **5** / **5** / **5** to match the prompt. Each envelope has a distinct `trigger` (`scheduled`, `event`, `resume-from-offline`, `event`, `scheduled`) and the audit scores cover the full multiplier range (0.7x to 1.9x) so downstream risk-engine tests have a realistic distribution to assert against.
