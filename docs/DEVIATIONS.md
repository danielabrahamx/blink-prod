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
