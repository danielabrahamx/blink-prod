# Blink — Per-Second Laptop Insurance

Per-second laptop insurance on **Arc Testnet** (chainId `5042002`).
Customer buys a policy, streams USDC per second while covered, and pays
premiums into a USYC-backed reserve — all settled on-chain.

**Stack:** React + Vite frontend, Node/Express backend, Circle
x402-batching for per-second streaming, Circle Developer-Controlled
Wallets for reserve management.

The repo has two run modes, toggled by `VITE_DEMO_MODE`:

- **Real mode** (unset) — what this README describes. Runs locally
  against the live Arc Testnet contract with a local backend on
  `:3001`.
- **Simulation mode** (`VITE_DEMO_MODE=true`) — no backend, everything
  faked client-side in `frontend/src/lib/simulationClient.ts`. This is
  what Netlify builds and what the public demo URL serves.

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

# terminal 2 — frontend (defaults to :8080, falls back to :8081)
cd frontend
bun install            # or: npm install
bun run dev
```

Visit http://localhost:8080:

- `/` — landing + email gate
- `/set-home` — set your home base (lat/lng)
- `/live` — customer policy flow
- `/admin` — seller pool dashboard

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
   (`/api/insure/home-charging`, `…/away-battery`, etc).
5. At the end of the session, `/api/settle` posts a summary and
   surfaces the `txId` + per-band breakdown.

## Rating model

Two compounding factors:

**Location band** (haversine distance to home, with international-IP
override):

| Band   | Trigger                              | Rate (µUSDC/sec) |
|--------|--------------------------------------|------------------|
| `home` | within 2 m of home                   | 3                |
| `near` | 2 m – 5 m                            | 4                |
| `away` | > 5 m, or IP country ≠ home country  | 6                |

Demo-scale thresholds (metres) so the away band is reachable by walking
a few paces. 1 m hysteresis prevents flicker; outdoor GPS is typically
3–10 m accurate.

**Charging state** (multiplies the band rate):

| State       | Factor |
|-------------|--------|
| Plugged in  | 1.00×  |
| On battery  | 2.00×  |
| Unknown     | 1.00×  |

Compounding: `home + on battery` = 6 µUSDC/sec, `away + on battery`
= 12 µUSDC/sec.

All accrual is integer µUSDC (USDC's 6-decimal floor). USD values are
display only — nothing settles in fiat.

## Admin flow (`/admin`)

- **Seller wallet** card — the pool address + DCV wallet ID
- **Seller pool · on-chain** — live Arc RPC reads of the seller's USDC
  and USYC balances (polled every 10s)
- **Circle Gateway / DCV balances** — server-side Circle API view
  (reserved / spendable)
- **Top up USYC reserve** — approves the Blink contract, then calls
  `depositReserve(amount)` signed by the Circle DCV wallet
- **Recent x402 receipts** — last N per-second charges from
  `/api/health` (refreshed every 5s), with total premiums in USDC

## Backend routes

| Method | Path                               | Billing   | Purpose                          |
|--------|------------------------------------|-----------|----------------------------------|
| GET    | `/api/insure/home-charging`        | 3 µUSDC   | Per-sec charge, home, plugged    |
| GET    | `/api/insure/home-battery`         | 6 µUSDC   | Per-sec charge, home, unplugged  |
| GET    | `/api/insure/near-charging`        | 4 µUSDC   | Per-sec charge, near, plugged    |
| GET    | `/api/insure/near-battery`         | 8 µUSDC   | Per-sec charge, near, unplugged  |
| GET    | `/api/insure/away-charging`        | 6 µUSDC   | Per-sec charge, away, plugged    |
| GET    | `/api/insure/away-battery`         | 12 µUSDC  | Per-sec charge, away, unplugged  |
| GET    | `/api/insure/idle`                 | 1 µUSDC   | Idle fallback                    |
| GET    | `/api/health`                      | free      | Uptime + recent tx receipts      |
| GET    | `/api/status`                      | free      | Pool/contract state snapshot     |
| POST   | `/api/settle`                      | free      | Session settlement summary       |
| GET    | `/api/admin/balance/{address}`     | free      | USDC + USYC via Arc RPC          |
| GET    | `/api/admin/wallet-balance`        | free      | Circle DCV wallet balances       |
| POST   | `/api/admin/deposit-reserve`       | free      | Top up USYC reserve via DCV      |

## Tests

```bash
cd frontend
bun run test
```

Unit coverage lives in `frontend/src/lib/**/__tests__` (rulebook,
battery, geolocation, homeSpawn) and `frontend/src/pages/__tests__`
(LiveDemo).

## Key files

- `frontend/src/pages/LiveDemo.tsx` — customer policy flow + live session
- `frontend/src/pages/Admin.tsx` — seller pool dashboard
- `frontend/src/lib/blinkContract.ts` — `buyInsurance` / `hasActivePolicy`
  against the Blink contract
- `frontend/src/lib/gatewayClient.ts` — chooses real Circle Gateway vs
  simulation
- `frontend/src/lib/simulationClient.ts` — demo-mode fake gateway
- `frontend/src/lib/rulebookV2.ts` — location band + charging scorer
- `backend/server.js` — Express + x402-batching middleware + admin routes
- `backend/blink-contract-abi.json` — compiled ABI for the Blink contract
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

## Deploying the simulation build

Netlify auto-builds `frontend/` on pushes. `netlify.toml` sets
`VITE_DEMO_MODE=true` for production, deploy-preview, and branch-deploy
contexts, so every preview URL ships the simulation experience. No
backend is deployed; the public demo never transacts for real.

Promoting real-mode to a public URL is a non-trivial checklist — host
the backend, move `VITE_BUYER_PRIVATE_KEY` off the bundle, add
per-session spend caps, and flip `VITE_DEMO_MODE=false`. See
`CLAUDE.md` for the full checklist.
