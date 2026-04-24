# Lessons — Blink

Patterns and corrections to apply on future sessions. Additive — append
new entries with a date, never rewrite old ones.

## 2026-04-21 — React interval stale-closure (v2 LiveDemo)

**Incident.** The `/live` session interval captured `geo.position`,
`battery.charging`, and `ipCountry` at `startSession` time. Mid-session
charger flips and position updates never fed the rulebook, so "unplug
the charger" appeared broken.

**Fix.** Mirror each live signal into a `useRef`, updated from a
`useEffect([signal])`. The interval reads `ref.current` on every tick
so it always sees the current value. Keep the React state for render,
keep the ref for the loop.

**Rule.** Any `setInterval` / `setTimeout` that depends on data that
updates after it's scheduled must read through a ref, not through a
closed-over variable. `useCallback` with the signal in its deps
doesn't fix it — the callback re-creates, but the interval is still
the old one.

## 2026-04-21 — Hysteresis at metres-scale

**Incident.** User walked to the `away` band, then returned to their
desk, and the dial stayed stuck. Symmetric hysteresis meant returning
required being within `HOME_RADIUS - HYSTERESIS` (1 m) of the saved
spawn — indoor GPS accuracy is 5–20 m, so that almost never happens.

**Fix.** Asymmetric hysteresis: outward transitions still need
`boundary + HYSTERESIS`, but inward transitions return at the nominal
boundary.

**Rule.** Hysteresis is for suppressing flicker when the signal is
stationary near a boundary. It should never prevent a genuinely-moved
signal from settling. If a signal has noise comparable to the band
size, hysteresis cannot be symmetric without trapping the user.

## 2026-04-21 — Email-gate storage shape (tests)

**Incident.** LiveDemo tests stubbed localStorage with
`{ email: 'test@example.com' }` to bypass the gate. The gate reads
`blink_email_signup_v1` and expects `{ status: 'signed_up', at: <iso> }`;
any other shape fails `hasPassedGate()`, so the tests redirected to `/`.

**Rule.** When stubbing the email gate in tests:
```ts
localStorage.setItem(
  'blink_email_signup_v1',
  JSON.stringify({ status: 'signed_up', at: new Date().toISOString() }),
);
```
Or use `sessionStorage.setItem('blink_email_skipped_session', '1')` for
the skip path. Source of truth: `frontend/src/lib/emailGate.ts`.

## 2026-04-21 — Test-cleanup ordering with jsdom + RTL

**Incident.** `useGeolocation` unmount called `navigator.geolocation
.clearWatch`. The test's `afterEach` restored `navigator.geolocation`
to whatever jsdom had (absent), BEFORE `@testing-library`'s global
`cleanup()` unmounted the component. So unmount threw on
`.clearWatch is undefined`.

**Fix.** On restore, if there was no original, leave a no-op stub in
place instead of `delete`-ing the property:
```ts
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: { watchPosition: () => 0, clearWatch: () => undefined },
});
```

**Rule.** When stubbing globals that React effects' cleanups call,
restore to a tolerant stub, not `undefined`. The global `afterEach
cleanup` in `src/test/setup.ts` runs AFTER your test-local afterEach,
and it unmounts everything — your stub needs to outlive your own
teardown.

## 2026-04-21 — Commit attribution

**Rule.** No AI attribution in any artefact. No `Co-Authored-By:
Claude`, no "Generated with Claude Code", no `// AI-generated`
comments. Write as the developer. This applies to commit messages,
PR descriptions, doc frontmatter, and inline code comments.

## 2026-04-21 — Setinterval updater functions race (React)

**Incident.** Inside a `setInterval` callback, calling
`setTotalMicroUsdc(t => { newTotal = t + rate; return newTotal })` and
then reading `newTotal` synchronously on the next line gave 0. React
schedules the updater asynchronously; the variable captured inside
closes over the initial value.

**Fix.** Maintain the running total in a `useRef`. Mutate the ref
synchronously; mirror to state purely for render. End-of-session
handoff reads `totalRef.current` directly.

**Rule.** Don't try to read state inside the same tick you set it.
For running accumulators, the ref is the truth; state is the mirror.
