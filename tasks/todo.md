# TODO — v2 browser demo

Branch: `v2-browser-demo`. 10 commits ahead of `main`.

## Pending (needs user approval before action)

- [ ] `git push -u origin v2-browser-demo` to trigger Netlify preview.
- [ ] Walk the Netlify preview end-to-end on a real laptop:
  - email gate → `/set-home` → `/live`
  - start session, confirm ticker accrues at 3 µUSDC/sec
  - unplug charger → dial snaps to 2.00×, rate doubles to 6 µUSDC/sec
  - walk 5+ paces → AWAY band; walk back → HOME snaps
  - 60-second timeout → summary card with fake tx id
- [ ] Merge to `main`. Tag `v0.2.0-browser-demo`. Push tag.

## Deferred (won't block v0.2.0 ship)

- [ ] Strip `@circlefin/x402-batching` and `@x402/*` from
  `frontend/package.json`. Requires also stripping
  `gatewayClient.ts` and the retired `InsuracleDashboard` path.
  Current bundle already tree-shakes them (494 kB JS).
- [ ] Update `~/SibroxVault/claude-context/blink.md` to reflect v2
  architecture. Outside this repo; needs a separate pass in
  SibroxVault.
- [ ] Write `SetHome.test.tsx` if integration coverage is needed.
  Not on the handoff's test list.
- [ ] Consider Firefox/Safari pass. v2 targets Chromium only per
  handoff; useBattery already falls back to `supported:false`.

## Known carry-overs

- `frontend/src/InsuracleDashboardAdmin.tsx` still wired behind the
  landing "ADMIN PORTAL" card. Untouched in v2. If it ever breaks on
  the build, it's safe to hide behind a dev-only route.
- Old `InsuracleDashboard.tsx` is unreachable from v2 routing but
  still compiles. Dead code from v1; remove when bundle cleanup
  lands.
