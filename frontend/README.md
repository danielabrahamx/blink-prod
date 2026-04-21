# Blink Frontend

React + Vite + TypeScript + Tailwind. Deployed to Netlify.

## Two run modes

The frontend has two build modes controlled by `VITE_DEMO_MODE`.

### Demo mode (public Netlify deploy)

`VITE_DEMO_MODE=true`. All x402 payments, Circle API balance reads, and admin actions are simulated client-side. No backend required. Capped at `60s` per tab so the UI can't run forever. Used for the always-live public URL on Netlify (env var set in `netlify.toml` for the production / deploy-preview / branch-deploy contexts).

Zero network calls fire to any backend, Circle API, or RPC endpoint when this flag is on — only the Formspree email gate and Netlify static assets.

### Real integration (local development)

`VITE_DEMO_MODE` unset (or `false`). Connects to the local Express backend that gates per-second x402 payments via `@circlefin/x402-batching` and manages USDC/USYC reserves through Circle Developer-Controlled Wallets.

To run the real thing end-to-end:

```bash
# terminal 1 — backend
cd backend
npm install
npm start                          # listens on :3001

# terminal 2 — frontend, no demo flag
cd frontend
npm install
npm run dev                        # Vite dev server
```

Needs `backend/.env` populated with `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`, `CIRCLE_WALLET_ADDRESS`, `ARC_RPC_URL`, `BLINKRESERVE_ADDRESS` — see `backend/.env.example`. Frontend needs `VITE_BUYER_PRIVATE_KEY` and optionally `VITE_RPC_URL`.

## Switching modes

- **Local demo-mode sanity check:** `echo VITE_DEMO_MODE=true > .env.local && npm run dev`. Tear down by deleting `.env.local`.
- **Flip the production Netlify deploy back to real mode:** edit the `[context.production.environment]` block in `netlify.toml` at the repo root. This also requires a deployed backend, which does not currently exist.

## Preserving the real integration

The simulation is additive: real-mode code paths in `src/lib/gatewayClient.ts`, `src/InsuracleDashboard.tsx`, and `src/InsuracleDashboardAdmin.tsx` remain intact and compile unchanged. The `DEMO_MODE` flag routes *around* them when `true`. Pre-demo-mode snapshot is tagged as `snapshot/real-integration-2026-04-21` for rollback.
