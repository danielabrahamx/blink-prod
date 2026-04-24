# v2 browser-demo — session log

Branch: `v2-browser-demo`. Started 2026-04-21 from `main` at `c0c7a90`.
Target tag after merge: `v0.2.0-browser-demo`. Preserves v1 at tag
`v0.1.0-founder-dogfood`.

## Scope

Rebuild Blink as a browser-only live demo:

- `/` landing (email gate retained) → new CTA `TRY THE LIVE DEMO`
- `/set-home` — geolocation + IP country → localStorage
- `/live` — 60-second session with real-time premium accrual driven by
  Battery Status API + Geolocation API
- Simulation-only settlement (no x402, no Circle, no backend).

Handoff doc the session was built against:
`C:\Users\danie\.gstack\projects\danielabrahamx-blink\BUILD-PLAN-V2-HANDOFF.md`.

## Commit trail on v2-browser-demo

| Hash | Subject |
|------|---------|
| `c393d57` | chore(v2): delete electron, backend, e2e, v1 docs for browser-only rebuild |
| `5149882` | feat(rulebook): rulebookV2 scoring with integer micro-USDC accrual |
| `dd814cc` | feat(lib): browser signal hooks + home spawn persistence |
| `5d7b6e5` | feat(live): SetHome + LiveDemo flow with 60s session accrual |
| `a2b0c03` | docs(v2): rewrite README + STATUS for browser-only demo |
| `220ee5d` | fix(live): read signals through refs + show live-signal strip |
| `cdb4e57` | feat(rulebook): battery compounds × 2 when on battery |
| `1bf0dac` | feat(live): four-way location override for demo choreography |
| `7ec4e96` | feat(rulebook): collapse distance thresholds to metres for demo reachability |
| `00a4a4e` | fix(rulebook): snap inward to the tighter band at the nominal boundary |

## Architecture as shipped

- Frontend only. React 18 + Vite + Tailwind + shadcn. No backend.
- Deploy target: Netlify. `netlify.toml` already sets
  `VITE_DEMO_MODE=true` in production, preview, and branch-deploy.
- Signals:
  - `frontend/src/lib/battery.ts` → `useBattery()` (Chromium-only,
    Firefox/Safari fall back to `supported:false`).
  - `frontend/src/lib/geolocation.ts` → `useGeolocation()` +
    `haversineMeters()`.
  - `frontend/src/lib/ipCountry.ts` → best-effort one-shot
    `fetch('https://ipapi.co/json/')`.
  - `frontend/src/lib/homeSpawn.ts` → localStorage persistence with
    validation, returns `null` on corruption.
- Rulebook: `frontend/src/lib/rulebookV2.ts`.
  - Compound: `multiplier = locationMultiplier × batteryMultiplier`.
  - Location bands via haversine + asymmetric hysteresis.
  - `charging === false` → battery factor 2; plugged / unknown /
    unsupported → factor 1.
  - All accrual in integer µ-USDC.
- UI: `MultiplierDial`, `LiveTicker`, `SessionSummary` +
  `LiveSignalStrip` (inline in `LiveDemo.tsx`, always visible so the
  hooks' liveness is obvious).
- Simulation settlement: `simulateLiveSettlement(totalMicroUsdc)` in
  `frontend/src/lib/simulationClient.ts`. Returns a fake tx id.
- Dev-only spoof control: `Real / Near (4 m) / Away (10 m) /
  International`. Visible when `import.meta.env.DEV` or URL has
  `?demo=1`.

## Deviations from the handoff

All recorded in `docs/DEVIATIONS.md`:

1. **Battery compounds.** Handoff said "display only". Demo required
   reactive rate when unplug happens, so `BATTERY_MULTIPLIER_UNPLUGGED
   = 2`. One-line revert for real-money.
2. **Demo-scale distance thresholds.** Handoff spec'd 200 m / 50 km;
   v2 ships 2 m / 5 m so the 2× band is reachable by walking 5 paces.
   Tests reference the exported constants, so flipping back to
   production values is mechanical.
3. **Asymmetric hysteresis.** Symmetric hysteresis at metres-scale
   left users stuck in `near` when they walked back to their desk
   (indoor GPS rarely hits ±1 m of the spawn point). Outward
   transitions still have the HYSTERESIS margin; inward transitions
   use the nominal boundary.

## Verified

- `bun run test` → 141/141 green (18 files).
- `bun run build` → 494 kB JS / 157 kB gzip. No warnings.
- `bun run typecheck` → no errors from v2 code. Pre-existing jest-dom
  `toBeInTheDocument` type-augmentation gaps in `admin/**` are
  untouched.

## Not verified — human-smoke gates

- Walk-in-the-real-world test (distance + charger + IP simultaneously).
  The dev server is up on http://localhost:8080 during session;
  reload with Ctrl+Shift+R after each commit.
- Netlify preview. Branch has not been pushed yet.
- Firefox/Safari fallback paths. Chromium only so far.

## Decisions that rolled back

- **Old "Spoof away" single toggle (commit `5d7b6e5`).** Replaced by
  four-way segmented control in `1bf0dac`. Test id `spoof-away` is
  preserved on the Away button so the LiveDemo test still targets it.
- **Symmetric hysteresis (commits `5149882` through `7ec4e96`).**
  Flipped to asymmetric in `00a4a4e` after the user reported the
  multiplier wouldn't return to `1.00×` on walking back.

## What future-Claude should read first

1. `BUILD-PLAN-V2-HANDOFF.md` — original spec.
2. `docs/DEVIATIONS.md` — where v2 departed from that spec and why.
3. `docs/STATUS.md` — what's shipped, verified, and pending.
4. `tasks/lessons.md` — reusable patterns from this session (stale
   closure trap, email-gate key format, hysteresis semantics, Battery
   API pitfalls).
5. This file for chronology.

## Next step (pending user nod)

1. `git push -u origin v2-browser-demo` → Netlify opens a preview URL.
2. Walk the preview end-to-end on a real laptop.
3. Merge to `main`, tag `v0.2.0-browser-demo`, push tag.

## Things I considered but did not do

- Remove `@circlefin/x402-batching` and `@x402/*` from
  `frontend/package.json`. They're referenced as type-only imports
  by the retired `InsuracleDashboard` code path and by
  `gatewayClient.ts` (only runtime-used when `VITE_DEMO_MODE=false`).
  The build prunes them as dead code. Dropping them would require
  stripping both files, which touches surface area the new /live
  flow doesn't need. Deferred.
- Update `~/SibroxVault/claude-context/blink.md` — describes v1
  architecture. Left alone because the vault is outside this repo;
  noted in `CLAUDE.md` v2 section that the vault doc is stale.
- Wire a `SetHome.test.tsx`. The handoff's testing targets list
  doesn't include it and the page is straightforward rendering +
  single side effect (`writeHomeSpawn`).
