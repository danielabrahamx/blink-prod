# Status — v0.1.0-founder-dogfood

**Date:** 2026-04-21.

## What's shipped

- 8 parallel feature branches merged into `main`:
  - `feat/backend-ts` — TypeScript Express, Zod ingress, pino, Redis rate-limit, MaxMind GeoIP.
  - `feat/db-schema` — Postgres migrations (10 tables), typed pg Pool, testcontainers integration test.
  - `feat/electron-shell` — Windows-first Electron with keytar-backed session + device keys, IPC, CSP.
  - `feat/signal-agent` — 7-signal collector, JCS envelope canonicalization, Ed25519 signing, SQLite offline queue.
  - `feat/risk-engine` — Rulebook v1.0.0 factor-product scorer + policy FSM with claim lifecycle.
  - `feat/settlement-x402` — x402 client-side auto-signer, Circle Gateway integration, BlinkReserve parity tests.
  - `feat/admin-portal` — Policy inspector, replay, metrics, CSV export.
  - `feat/claims-v1` — Eligibility, fraud flags, admin review, sanctions screening, BlinkReserve payout.
- Post-merge factory bridge in `electron/src/signal-collector/factory.ts` reconciles Agent C's IPC contract with Agent D's orchestrator.
- Unsigned NSIS installer at `electron/dist-installer/Blink-0.1.0-dev-x64.exe` (88 MB).

## Verification

| Workspace | Tests | Typecheck | Notes |
|---|---|---|---|
| Backend | 314/314 pass | clean | vitest, 36 files |
| Frontend | 70/70 pass | clean | vitest + jsdom + jest-dom matchers via `expect.extend` |
| Electron | 44/44 pass | clean | vitest, native deps rebuilt via electron-rebuild |
| Contracts | 8/8 pass | — | hardhat + chai |
| Backend boot | `/api/health` 200, `/admin/metrics` 200 | — | Postgres on :5434, Redis on :6380 |

## What requires a human operator

The end-to-end user journey is driven by UI interaction and cannot be executed headlessly in this session:

- Launch installer → approve Windows SmartScreen warning (unsigned build).
- Onboarding flow → enter email / name.
- Connect wallet → sign EIP-3009 authorization.
- Deposit USDC on Arc testnet (deployer wallet `0x4286a70ED45D7e3ccA8d174D9590414c984B3C39`, 13.93 ETH + 13.93 USDC confirmed funded).
- Either wait 48h or force via admin for calibration completion.
- Exercise multipliers by unplugging charger, closing lid, switching Wi-Fi.
- Submit claim via UI.
- Admin approve → verify payout tx lands on Arc.

Per the handoff doc, `v0.1.0-founder-dogfood` is tagged at the last known green integration state; the founder runs the installer and performs the live UI smoke as the first user.

## Known limitations and deferred work

### Limitations
- Installer is unsigned; Windows SmartScreen prompts on first launch.
- MaxMind GeoLite2 DB path is configured but the `.mmdb` file is not bundled (license restricts redistribution); ingest falls back to `GEOIP_LOCAL_COUNTRY` when set or null when absent.
- Circle Compliance API entitlement unverified — sanctions screening falls back to local blocklist.
- BlinkReserve contract retains Chainlink oracle dependency from the hackathon-era Paramify; the "remove the oracle" PR is a follow-up to simplify the reserve to a pure payout pool.

### Deferred
- Phase 6 Mac build.
- Actuarial GLM to replace rulebook v1.
- Live Arc testnet deploy of BlinkReserve (deploy script is runnable once deployer key is pinned; hardhat dry-run succeeds).

## How to run locally

```bash
# backend
export CLOUDSMITH_TOKEN=<token>
docker run -d --name blink-postgres -p 5434:5432 \
  -e POSTGRES_USER=blink -e POSTGRES_PASSWORD=blink_dev -e POSTGRES_DB=blink postgres:16-alpine
docker run -d --name blink-redis -p 6380:6379 redis:7-alpine
cd backend && bun install && bun run migrate:up && bun run dev

# electron
cd electron && bun install && bun run dev
```

## Known technical debt

- Backend `routes/signals.ts` currently drops scoring on the ingest path; the accrual loop scores asynchronously. Re-connecting synchronous scoring is a follow-up.
- Several stub files from Agent A were superseded at merge time (`backend/src/features/`, `backend/src/admin/replay.ts`, Agent A's `app.test.ts`, Agent A's `risk/index.test.ts`). These were removed with explanation in the merge commit messages.
- Two FeatureVector shapes exist: Agent A's design-doc-derived scalars on `backend/src/types/index.ts` (retained for admin/inspector tooling) and Agent E's categorical schema on `backend/src/risk/types.ts` (authoritative for scoring). Inspector-side consumers read Agent A's shape; scoring reads Agent E's. They coexist without conflict because no code path flows data from one into the other unchecked.
