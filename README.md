# Blink — Per-Second Laptop Insurance

Per-second laptop insurance on **Arc Testnet** (chainId `5042002`).
Customer buys a policy, streams USDC per second while covered, and pays
premiums into a USYC-backed reserve — all settled on-chain.

**Stack:** React + Vite frontend, Node/Express backend, Circle
x402-batching for per-second streaming, Circle Developer-Controlled
Wallets for reserve management.

The repo has two run modes, toggled by `VITE_DEMO_MODE`:

- **Real mode** (unset, default) — what this README describes. The
  public Netlify site ships in this mode and talks to the Fly-hosted
  backend at `https://blink-prod-backend.fly.dev`. Locally you can
  run the same mode against a backend on `:3001`.
- **Simulation mode** (`VITE_DEMO_MODE=true`) — no backend, everything
  faked client-side in `frontend/src/lib/simulationClient.ts`. Useful
  for previewing without touching real wallets; flip on per-branch in
  the Netlify UI.

## Architecture at a glance

```
┌─────────────┐   per-second USDC        ┌──────────────┐
│  Customer   │ ───────────────────────▶ │   Seller     │
│  /live      │   via Circle Gateway     │  wallet      │
│             │   (x402 batching)        │   (= the     │
│             │                          │    pool)     │
│             │   policy premium (USDC)  │              │
│             │ ───────────────────────▶ │              │
└─────────────┘                          └──────────────┘
                                                │
                                                │ USYC reserve
                                                ▼
                                         ┌──────────────┐
                                         │ Blink        │
                                         │ contract     │
                                         │ (Arc)        │
                                         └──────────────┘
```

The **seller wallet is the pool** — one source of truth. Every policy
premium and every per-second streaming charge settles there. USYC
reserve backing is held by the Blink contract and funded from the
seller's DCV wallet.

## Run locally

Two terminals:

```bash
# terminal 1 — backend on :3001
cd backend
npm install
cp .env.example .env   # then fill in Circle creds + addresses
npm start

# terminal 2 — frontend (defaults to :5173)
cd frontend
bun install            # or: npm install
bun run dev
```

Visit http://localhost:5173:

- `/` — landing + email gate; "Try the Live Demo" jumps straight
  into `/live`, "Admin Portal" opens the inline reserve dashboard.
- `/live` — customer policy flow + 60-second session
- `/admin/gateway` — Circle wallet + on-chain seller-pool dashboard
- `/admin/metrics` — pilot metrics panel

## Env config

### `backend/.env`

```env
PORT=3001
ARC_RPC_URL=https://rpc.testnet.arc.network
BLINK_CONTRACT_ADDRESS=0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43
CIRCLE_API_KEY=...                    # Circle DCV API key
CIRCLE_ENTITY_SECRET=...              # Circle DCV entity secret
CIRCLE_WALLET_ID=...                  # DCV wallet ID for admin ops
CIRCLE_WALLET_ADDRESS=0x...           # Seller wallet address
```

### `frontend/.env`

```env
VITE_BACKEND_URL=http://localhost:3001
VITE_RPC_URL=https://rpc.testnet.arc.network
VITE_SELLER_ADDRESS=0x...             # seller wallet (= the pool)
VITE_BUYER_PRIVATE_KEY=0x...          # buyer key for demo policy buys
VITE_BLINK_CONTRACT_ADDRESS=0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43
```

## Customer flow (`/live`)

1. **Enter laptop value** in USD (e.g. $1,500). Used as metadata for
   the on-chain policy; no actuarial pricing is displayed.
2. **Pick policy length** — slider, 1 hour to 30 days.
3. Click **Activate cover**. One `buyInsurance` tx on the Blink contract
   moves a premium from the buyer's USDC wallet into the seller pool.
   First buy also does a one-time `approve(MaxUint256)` so every
   subsequent policy buy is a single tx.
4. During the session, each tick routes a µUSDC payment through Circle
   Gateway to the seller wallet via the rate-matched endpoint
   (`/api/insure/charging` when plugged in, `/api/insure/battery` when
   on battery).
5. At the end of the session, `/api/settle` posts a summary and
   surfaces the `txId` + plugged-vs-unplugged second breakdown.

## Rating model

One factor: **charging state**. Plugged in (At Desk) is the baseline;
on battery (On The Move) doubles the rate. In the live demo narration
plug/unplug stands in as a proxy for at-desk-vs-on-the-move so judges
who can't physically move during the pitch can still trigger a visible
rate change.

| State                      | Endpoint                  | Rate (µUSDC/sec) | Multiplier |
|----------------------------|---------------------------|------------------|------------|
| Plugged in (At Desk)       | `/api/insure/charging`    | 3                | 1.00×      |
| On battery (On The Move)   | `/api/insure/battery`     | 6                | 2.00×      |
| Unknown (Firefox/Safari)   | `/api/insure/charging`    | 3                | 1.00×      |

Browsers without the Battery Status API (Firefox, Safari) collapse to
the plugged-in baseline so they're never penalised.

All accrual is integer µUSDC (USDC's 6-decimal floor). USD values are
display only — nothing settles in fiat.

## Admin flow

Two admin surfaces:

- **Inline admin portal** (landing → "Admin Portal" button) renders
  `InsuracleDashboardAdmin`. Shows the seller / Circle DCV pool address,
  a **live `Collected premiums` counter** that polls
  `/api/health.totalPremiumsUsdc` every 3 s (so it ticks up on every
  accepted x402 payment, well before the on-chain balance settles), the
  USYC on-hand figure, the contract reserve, and a recent-receipts list
  (timestamp + endpoint + µUSDC + tx hash, last 20 visible).
  USYC top-up and claim-trigger forms live here too.
- **`/admin/gateway`** (footer link) — a deeper dashboard with the
  on-chain seller-wallet polling (every 10 s), Circle DCV wallet token
  breakdown, and the same `lastTxs` feed (every 5 s).

## Backend routes

| Method | Path                               | Billing   | Purpose                                |
|--------|------------------------------------|-----------|----------------------------------------|
| GET    | `/api/insure/charging`             | 3 µUSDC   | Per-sec charge, plugged in (At Desk)   |
| GET    | `/api/insure/battery`              | 6 µUSDC   | Per-sec charge, on battery (On The Move) |
| GET    | `/api/health`                      | free      | Uptime + `totalPremiumsUsdc` + `lastTxs` |
| GET    | `/api/status`                      | free      | Pool/contract state snapshot           |
| POST   | `/api/settle`                      | free      | Session settlement summary             |
| GET    | `/api/balance/:address`            | free      | USDC + USYC via Arc RPC (alias)        |
| GET    | `/api/admin/balance/:address`      | free      | USDC + USYC via Arc RPC                |
| GET    | `/api/admin/wallet-balance`        | free      | Circle DCV wallet balances             |
| POST   | `/api/admin/deposit-reserve`       | free      | Top up USYC reserve via DCV            |

## Tests

```bash
cd frontend
bun run test
```

Unit coverage in `frontend/src/lib/**/__tests__` (rulebook, battery)
and `frontend/src/pages/__tests__` (LiveDemo end-to-end with battery
mocks and the simulation gateway).

## Key files

- `frontend/src/pages/LiveDemo.tsx` — customer policy flow + live session
- `frontend/src/pages/Admin.tsx` — seller pool dashboard at `/admin/gateway`
- `frontend/src/InsuracleDashboardAdmin.tsx` — inline admin portal with
  the live premium feed
- `frontend/src/lib/blinkContract.ts` — `buyInsurance` / `hasActivePolicy`
  against the Blink contract
- `frontend/src/lib/gatewayClient.ts` — chooses real Circle Gateway vs
  simulation
- `frontend/src/lib/simulationClient.ts` — demo-mode fake gateway
- `frontend/src/lib/rulebookV2.ts` — charging-state scorer
- `frontend/src/lib/battery.ts` — Battery Status API hook
- `backend/server.js` — Express + x402-batching middleware + admin routes
- `backend/blink-contract-abi.json` — compiled ABI for the Blink contract
- `scripts/demo-real-txs.mjs` — round-robins the two priced endpoints
  for 60 real x402 testnet payments
- `netlify.toml` — flips `VITE_DEMO_MODE=true` in production

## Tokens & contracts (Arc Testnet)

| Thing                  | Address                                      |
|------------------------|----------------------------------------------|
| USDC                   | `0x3600000000000000000000000000000000000000` |
| USYC                   | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| Blink contract         | `0xFC1EfCE3D25E7eE5535E7E6D6731D9Ba131bDC43` |

The current contract address + ABI are live on Arc Testnet and valid
as-is. A clean redeploy under a new name would require a new deployment
and address update; not needed for the current build.

## Deployment topology

The public site is **real-mode**:

- **Frontend** — Netlify auto-builds `frontend/` on pushes to `main`
  / `v2-browser-demo`. `netlify.toml` pins `VITE_BACKEND_URL` to the
  Fly URL and `VITE_RPC_URL` to the public Arc testnet RPC for the
  `production`, `deploy-preview`, and `branch-deploy` contexts.
  `VITE_BUYER_PRIVATE_KEY` is set in the Netlify UI (Site settings →
  Environment variables); only top up that wallet with a small float,
  it ships in the bundle.
- **Backend** — Fly app `blink-prod-backend` in region `lhr`, exposed
  at `https://blink-prod-backend.fly.dev`. Deployed via
  `backend/Dockerfile` + `backend/fly.toml`. Circle creds and the
  contract address live as Fly secrets (`flyctl secrets list -a
  blink-prod-backend`); none are committed.

### Redeploying

```bash
# backend → Fly
cd backend
flyctl deploy -a blink-prod-backend

# frontend → Netlify
git push origin v2-browser-demo   # (or main) — Netlify CI builds
```

Whenever the backend's billed-route table changes (e.g. the
`/api/insure/*` collapse), the Fly image must be redeployed — the
frontend will get 404s otherwise.

### Demo mode for offline previews

Flip `VITE_DEMO_MODE=true` in the Netlify UI for any branch you want
served from the in-tab simulation client. Useful when the Fly backend
is being upgraded or for offline pitches.
