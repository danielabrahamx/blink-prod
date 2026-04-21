# Blink Backend (TypeScript)

Express + TypeScript backend for Blink, a per-second laptop micro-insurance product on Arc testnet.
This directory replaces the hackathon-era `server.js` with a modular TypeScript build that
still preserves the pre-existing `/api/insure/active` and `/api/insure/idle` x402-gated
contracts verbatim so the existing demo-mode frontend keeps working.

## Quick start

Runtime uses `bun` for installs (`bun add`) but the `package.json` scripts call `tsx`
and `vitest` directly so they also run under Node 20.11+.

```powershell
# one-time install (from the backend/ directory)
bun install

# dev loop (hot reload, no build step)
bun run dev

# run tests once
bun test

# run tests with v8 coverage (writes coverage/ + html report)
bun run test:coverage
```

Set the usual environment:

```
PORT=3001
REDIS_URL=redis://localhost:6379
GEOIP_DB_PATH=./geoip/GeoLite2-Country.mmdb
CIRCLE_WALLET_ADDRESS=0x...
BLINKRESERVE_ADDRESS=0x...
ARC_RPC_URL=https://rpc.testnet.arc.network
```

If `REDIS_URL` is unset the app falls back to an in-process rate-limit / nonce store
(suitable for local dev but **not** suitable for production because state is not
shared across workers).

If `GEOIP_DB_PATH` is unset the country resolver returns `null` for non-local IPs.

## Layout

```
src/
  app.ts              # Express factory: middleware, routes, error handlers
  server.ts           # `dotenv/config` + createApp + listen (production entrypoint)

  types/              # Shared types (SignalEnvelope, FeatureVector, Policy, ...)

  ingest/             # Signal envelope ingest
    schema.ts           zod schemas for envelope + registration bodies
    signature.ts        Ed25519 verify over JCS(envelope)
    rateLimit.ts        Redis sliding-window: 1/20s hard, 3/min sustained
    nonceStore.ts       `SET NX EX` dedup, 409 on replay
    geoip.ts            MaxMind GeoLite2-Country lookup
    index.ts            end-to-end ingest pipeline (schema -> sig -> rl -> nonce -> geoip)

  features/           # Feature extractor -> FeatureVector (Module 2 contract)

  risk/               # Risk engine interface (body deferred to Agent E)
    index.ts            score(FeatureVector): ScoredMultiplier + setRiskEngine

  accrual/            # Accrual ledger + engine interfaces (body deferred to Agent F)

  admin/              # Admin API helpers
    metrics.ts          counters + rolling latency histogram
    inspector.ts        per-policy bundle (policy + envelopes + scores + fsm log)
    replay.ts           re-score historical envelopes with new model

  routes/
    devices.ts          POST /devices/register
    policies.ts         /policies/create, /fund, /topup, /cancel
    signals.ts          POST /signals
    claims.ts           claims stubs (body deferred to Agent H)
    admin.ts            /admin/metrics, /admin/policy/:id, /admin/replay

  legacy/
    insure.ts           preserved /api/insure/active + /api/insure/idle handlers

  lib/
    errors.ts           HttpError subclasses
    errorMiddleware.ts  express error + 404 handlers
    jcs.ts              RFC 8785 JSON canonicalization
    redis.ts            RedisLike interface + ioredis factory
    memoryRedis.ts      in-process RedisLike for tests + local dev
    store.ts            device + policy store (in-memory until Agent B lands)
    context.ts          per-app runtime context
```

## Legacy compatibility

`/api/insure/active` and `/api/insure/idle` are preserved exactly so the pre-hackathon
Netlify frontend (demo mode) and any live real-mode integrations keep working. Their
handlers live in `src/legacy/insure.ts`; when `createApp` is given an
`x402GatewayRequire` factory, it wires the exact same `@circlefin/x402-batching`
gateway the old `server.js` used. When no gateway is wired (tests, local dev), the
endpoints are reachable unauthenticated but still return the identical JSON shape.

## What other Wave 2 agents plug in

| Agent | Fills | File the route handler calls |
|-------|-------|------------------------------|
| B (db-schema) | Real `Store` impl | `lib/store.ts` -> Postgres |
| E (risk-engine) | `rulebook_v1.0.0` | `setRiskEngine(...)` in `risk/index.ts` |
| F (settlement-x402) | Accrual ledger + x402 auto-signer | `setAccrualLedger`, `setAccrualEngine` in `accrual/index.ts` |
| H (claims-v1) | claim intake / payout / fraud | swap `routes/claims.ts` stubs for real handlers |

All four have stable interfaces in this branch, so their worktrees can code against
them without merging. Wave 3 merges.

## Testing

`vitest` with V8 coverage. Target is >= 80% branch coverage. Run:

```
bun run test:coverage
```

Key tests:

- `src/lib/jcs.test.ts` -- RFC 8785 serializer round-trip
- `src/ingest/signature.test.ts` -- Ed25519 verify happy-path + tamper + bad-key
- `src/ingest/rateLimit.test.ts` -- 20s short window + 60s long window
- `src/ingest/nonceStore.test.ts` -- dedup + per-policy isolation
- `src/ingest/index.test.ts` -- end-to-end ingest pipeline
- `src/features/index.test.ts` -- every factor in the extractor
- `src/app.test.ts` -- full HTTP integration via supertest

## Deploy

Target is Fly.io (keeps Node warm so in-flight x402 batch state survives; Render free
tier sleeps and kills mid-stream state). A Fly.toml will land with the settlement
worktree (Agent F). Until then, `bun run build && node dist/server.js` produces a
deployable bundle.

## Notes

- `server.js` at the repo root is preserved as the hackathon-era entrypoint. The
  `legacy:start` script still runs it if you ever need to bisect. Delete it once
  the TypeScript server has been running in prod for a cycle.
- Redis is optional for local dev but required in production. In-memory fallback is
  clearly labeled in `app.ts`.
