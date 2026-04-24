# STATUS — v2 browser demo

**Branch:** `v2-browser-demo`
**Target tag:** `v0.2.0-browser-demo`
**Previous release preserved at:** `v0.1.0-founder-dogfood`

## What shipped in v2

- `/` — landing, email gate, waitlist CTA. Retained from v1.
- `/set-home` — geolocation prompt, IP-country inference, home spawn
  persisted to localStorage under `blink_home_spawn_v2`.
- `/live` — 60-second session driven by `useGeolocation` +
  `useBattery`, rated by `rulebookV2.scoreV2`, accruing integer
  µ-USDC per tick.
- Session summary card with total paid, average multiplier, seconds
  per band, and a simulated settlement tx id.
- Dev-only **Spoof away** affordance (shown in dev or with `?demo=1`).

## What was removed from `main`

- `electron/` — entire tree (62 files). Desktop MVP lives at the v1 tag.
- `backend/` — Express server, Postgres migrations, TypeScript src.
- `docker-compose.yml` — Postgres + Redis compose file.
- `tests/e2e/` and `playwright.config.ts` — e2e tests pointed at the
  now-deleted backend on `:3001`.
- `docs/DEVIATIONS.md`, `docs/STATUS.md` — archived under
  `docs/archive/v1/` for reference.

## Verified

- `bun run test` — 153 / 153 green (18 files). Includes 48 cases on
  `rulebookV2`, 12 on `battery`, 13 on `geolocation`, 11 on
  `homeSpawn`, 4 on `LiveDemo`.
- `bun run build` — succeeds; 491 kB JS (156 kB gzip). Warning about
  Tailwind arbitrary-value class resolved.
- `bun run typecheck` — no errors in new v2 code. (Pre-existing
  jest-dom type-augmentation warnings in `admin/**` unchanged.)

## Not verified / human-smoke gates

- Netlify preview build (pending push of `v2-browser-demo` to origin).
- Manual walk of the /live journey in Chromium on a laptop (grant
  geolocation, unplug charger, confirm multiplier unchanged, press
  Spoof away, confirm ticker doubles). This is the acceptance test
  per the handoff.

## Known carry-overs

- `@circlefin/x402-batching` and `@x402/*` are still installed. They
  are only referenced by the retired `InsuracleDashboard` code path
  (unreachable from v2 routing) and by `gatewayClient.ts` (only hit
  when `VITE_DEMO_MODE=false`, which we never ship). The build prunes
  them as dead code; removing from `package.json` is a future cleanup.
- The `InsuracleDashboardAdmin` view is still wired behind the "Admin
  Portal" landing card, untouched in v2. The new /live flow is the
  primary experience.
