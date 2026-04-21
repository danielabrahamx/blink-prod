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

---

# DEVIATIONS.md - Signal Agent (Agent D)

Deviations from the Agent D handoff spec, with rationale.

## 1. Ed25519 library: `tweetnacl` instead of `@noble/ed25519` + `@noble/hashes`

Handoff spec said: "Sign with device key via `@noble/ed25519`".

Implementation uses: `tweetnacl@^1.0.3`.

### Rationale

- `@noble/ed25519@2.x` is pure sync on modern Node (18+) since the removal
  of the top-level async bootstrap, but earlier minor versions still had the
  `etc.sha512Sync` wiring requirement, which is awkward to thread through a
  synchronous signing path inside an Electron main process.
- `tweetnacl` ships a pre-compiled pure-JS Ed25519 implementation, no native
  binding, no async init, identical wire-format output (64-byte signatures,
  32-byte pubkeys). It has been audited and is the de facto standard in the
  Electron ecosystem.
- Swap cost if we change our mind later is trivial: `envelope.ts` exposes
  `signEnvelope` / `verifyEnvelope` / `generateDeviceKey`, everything else
  treats the signature as an opaque base64 blob.

If the server (Agent A) validates with `@noble/ed25519`, round-tripping is
still correct because both libs produce RFC-8032 compliant detached
signatures. Cross-library verification is covered implicitly by the shape
contract; a direct cross-lib round-trip test should be added when the
backend signature-verification route lands.

## 2. `pino` logger not installed

Handoff spec listed `pino` in the dependency bullet. The signal collector
itself emits zero log output - it hands envelopes to the `Transport`
interface and errors bubble to the caller. Logging belongs to the
orchestrator in the Electron main process, not to this library. Skipping
`pino` keeps the bundle lean and avoids a transitive dep inside the
signal-collector surface area.

If the main process needs structured logging, add `pino` at the main-process
level and have it subscribe to collector state transitions via the
orchestrator's event hooks.

## 3. `zod` not used for the whitelist schema

Handoff spec said: "Define the whitelist in a shared module ... exporting a
zod schema."

Implementation uses a pure-TS validator in
`electron/src/shared/signal-whitelist.ts` - `validateEnvelopeShape(...)`
returns `string | null` (reason on failure, null on success). Reason for
going schema-free here:

- The whitelist is a single flat allow-list, not a rich object graph. A zod
  schema would add ~6kb of runtime code and an extra dep for a 20-line
  function.
- The validator can be imported by the backend (Agent A) without that
  Node-land pulling in zod as well. Both ends just run `if (
  validateEnvelopeShape(body) !== null) reject(...)`.
- Type definitions in `types.ts` give the static side of the contract; the
  runtime validator enforces the dynamic side against unknown input.

If Agent A prefers zod at ingest (common for request-body parsing with
`zod`-based routers), they can wrap our validator or define their own zod
schema against the same whitelist constant - both paths stay in sync because
they import from the same constant.

## 4. Build isolation: `npm install` inside `electron/` instead of `bun install`

Handoff spec said: "bun add ...".

Implementation installed with `npm install --no-workspaces --prefix .`
inside `electron/`.

### Rationale

The repository root has:

1. A `package.json` with `workspaces: ["frontend", "backend", "electron"]`.
2. A `.npmrc` pointing `@circlefin/*` at a Cloudsmith private registry
   that requires `CLOUDSMITH_TOKEN`.
3. `frontend/package.json` and `backend/package.json` both depend on
   `@circlefin/x402-batching` via the private registry.

Running `bun install` from `electron/` walks up to the root and tries to
resolve the whole workspace, which 401s on the Circle private registry
(we have no token in this worktree). `npm install --no-workspaces --prefix .`
pins install to the electron package only, sidestepping the private
registry entirely.

The postinstall story at release time is different (CI has a token), but
for this worktree's local dev + CI-in-isolation, `npm --no-workspaces`
is the correct escape hatch.

## 5. `electron-rebuild` postinstall hook not added

Handoff spec said: "better-sqlite3 + keytar may need electron-rebuild.
Include postinstall hook."

Reason deferred:

- `keytar` is not installed in this package yet (device key storage lives
  in a separate module to be built by another agent - see `electron/src/
  device-key/` placeholder noted in the handoff).
- `better-sqlite3` currently runs under plain Node (vitest environment) for
  unit tests, where the native binary is compiled against Node's ABI and
  works fine.
- When the Electron main process actually bundles this module, the
  electron-builder/electron-packager pipeline runs `electron-rebuild`
  automatically for native deps. Adding a `postinstall` hook at this stage
  would break `npm install --no-workspaces` (it would rebuild against plain
  Node in CI and then re-rebuild against Electron at package time, which is
  what electron-builder is designed to do once).

Action item for the Electron main-process integration PR: add
`electron-rebuild` there, not here.

---

# Settlement-x402 Deviations

This file tracks departures from the Agent F prompt in `feat/settlement-x402`
and the rationale for each. Keep additions chronological and justify every
deviation — "it worked" is not a rationale.

## 2026-04-21

### 1. x402 flow is the documented Gateway flow, not a custom-escrow workaround.

The Agent F prompt warned that a pivot to Workaround 3 (custom escrow on Arc
testnet) might be required if `@circlefin/x402-batching` did not support
server-triggered debits against a pre-authorized channel.

Research (Circle docs + our existing `backend/server.js:60-86` wiring) confirms
x402 batching works exactly as designed:

- Server uses `createGatewayMiddleware({sellerAddress,networks})` and
  `gateway.require('$amount')` per endpoint.
- Client uses `GatewayClient` (one-time USDC deposit) + `BatchEvmScheme` /
  EIP-3009 `TransferWithAuthorization` per 402 response.

The "session key + cap" layer the design doc calls for is an *application-layer
policy* we enforce ourselves (in `backend/src/settlement/authorization.ts`),
not something Circle owns. The session private key lives in Electron OS
keychain (Agent C wires `keytar`); our `consume()` SQL predicate is the atomic
gate that enforces cap + validity + revocation.

**No pivot required.** The whole settlement package ships against the real
Circle pattern.

### 2. Circle does not publish a per-policy "totals" API for reconcile.

`backend/src/settlement/reconcile.ts` accepts an injected
`CircleTotalsAdapter`. In tests we use `StaticTotalsAdapter`. Prod wiring will
plug in an adapter that calls `GatewayClient.getBatchHistory()` (or the
equivalent documented endpoint) and sums per-policy. This does not change
behavior — the reconciler still flags deltas > $0.01 into
`backend/logs/reconcile.jsonl`.

### 3. BlinkReserve constructor signature.

The Agent F prompt's reference deploy script called `BlinkReserve.deploy(USDC,
USYC)`. The actual contract (`contracts/BlinkReserve.sol` constructor at
line 46) takes `(address _priceFeedAddress, address _usdc, address _usyc)`.
We preserved the real signature — reserving the clean-name change for a
separate "drop the oracle" PR since removing the Chainlink dependency would
change the flood-payout logic.

`scripts/deploy-blink-reserve.js` auto-deploys a `MockAggregatorSettlement` for
local / hardhat networks and requires `MOCK_ORACLE_ADDRESS` for Arc testnet so
the redeploy reuses the existing oracle.

### 4. Arc testnet deploy is parked pending funded DEPLOYER_PRIVATE_KEY.

The prompt calls for a live deploy + address write to
`deployments/arc-testnet.json`. The configured `DEPLOYER_PRIVATE_KEY` in this
worktree is unknown (it's blank in `.env.example`, intentionally). The deploy
script is fully runnable — it will emit `deployments/arc_testnet.json` and
`deployments/BlinkReserve.abi.json` the moment the key is funded. Until then:

- Local deploy tests pass against the Hardhat in-process network.
- `frontend/src/lib/contract.ts` still points at the legacy address pending
  the Arc testnet deploy, with a `TODO(feat/settlement-x402)` comment marking
  the swap point.

Running the deploy:

```
# local dry-run (spins an ephemeral chain):
npm run deploy:blink-reserve:local

# Arc testnet (requires funded DEPLOYER_PRIVATE_KEY + MOCK_ORACLE_ADDRESS):
npm run deploy:blink-reserve
```

### 5. Settlement tables land in this branch as an idempotent migration.

Agent B owns the wider Postgres schema (`backend/migrations/*.sql`). That work
is on a separate branch. To avoid blocking Agent F on an unmerged dependency,
we ship `backend/migrations/0001_settlement_tables.sql` which is:

- Additive (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- Scoped to the four tables the settlement layer writes to:
  `x402_authorizations`, `settlement_receipts`, `accrual_ledger`,
  `circle_webhook_events`.
- Safe to re-run — the Agent B migration can overwrite definitions without
  data loss because our columns are a subset of the final schema shape.

### 6. `backend/server.js` is untouched in this branch.

Agent A is converting the backend to TypeScript and will mount the settlement
router in the TS Express app. We provide the router as `buildSettlementRouter`
rather than patching the existing JS server, so the merge is a one-line
`app.use('/settlement', buildSettlementRouter(...))` rather than a rewrite.

The `setTimeout(3000)` race at `backend/server.js:184` is documented as the
target for `GatewayFacade.awaitConfirmation(txId)` — replacement happens in
Agent A's TS conversion, not here, because editing the existing JS file to
use the new TS helper would be the wrong integration seam.

### 7. In-memory FakePool for backend tests, not a Postgres container.

The test suite ships with `backend/src/db/fake.ts`, a hand-written
`Queryable` implementation that understands exactly the SQL the settlement
modules emit. Benefits: tests run in <2s, no Docker, no shared state between
suites. Trade-off: any new SQL pattern needs a corresponding FakePool
extension — this is the forcing function we want (if a test can't model the
SQL clearly, the SQL is probably too clever).

A real-Postgres smoke test belongs in Agent A's TS conversion branch
(Testcontainers) — out of scope for Agent F.

---

# Claims v1 deviations

## Sanctions screening

The design doc requires OFAC + UK list screening via Circle's tooling. As of
2026-04-21 the Circle Compliance Engine is gated on plan entitlement; we have
not yet confirmed the hackathon Circle account has access to
`/v1/w3s/compliance/screening/addresses`.

**Current behaviour:**
- `backend/src/claims/sanctions.ts` calls the live Circle endpoint when
  `CIRCLE_COMPLIANCE_API_KEY` is set in env.
- When the key is absent it falls back to `makeBlocklistScreener()` which
  loads from `SANCTIONS_BLOCKLIST_PATH` (optional JSON file) plus a baseline
  of two well-known test addresses.

**Follow-up (production blocker):**
- Confirm Circle Compliance plan entitlement before launching real money flows.
- Replace or augment the blocklist with a live OFAC + HMT feed if the Circle
  endpoint is unavailable in our plan.

## BlinkReserve payout ABI

`backend/src/claims/payout.ts` calls `BlinkReserve.payoutClaim(bytes32, address, uint256)`,
matching `contracts/mocks/MockBlinkReserve.sol`. The live `BlinkReserve.sol`
must expose the same function signature before real-mode claim payouts can run.

## Runtime TypeScript

`backend/server.js` (CommonJS) now imports from `./src/claims` which resolves
to TypeScript via the `tsx` loader (`node --import tsx/esm server.js`). Tests
run under `bun test` using `bun:test`.
