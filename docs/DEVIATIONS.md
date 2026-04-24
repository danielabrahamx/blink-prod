# DEVIATIONS — v2 browser demo

Deviations from `BUILD-PLAN-V2-HANDOFF.md` (`.gstack/projects/
danielabrahamx-blink/BUILD-PLAN-V2-HANDOFF.md`). The handoff's own
instruction for this situation: "If you disagree, document in
docs/DEVIATIONS.md and keep shipping."

## 2026-04-21 — Battery state compounds onto the rate (handoff §Rulebook v2)

**Handoff rule:** battery/charging state is displayed in the UI but
does not change the multiplier. Rationale given was that battery and
location are ~70% correlated, so multiplying both double-counts risk.

**v2 shipped rule:** battery is a second rating factor. `charging ===
false` multiplies the band rate by exactly 2. Anything else (plugged
in, unknown, API unsupported, permissions-policy blocked) collapses to
factor 1, so users on Firefox/Safari are never penalised for a missing
API.

**Why the deviation:**

- The handoff's Definition of Done says "Unplugging the charger
  triggers a visible 'unplugged' state in the UI (no multiplier
  change)." In practice, at a live demo, showing the pill flip while
  the dial stays at 1.00× reads as *the app didn't notice*. The
  reactive pricing story loses its hook.
- The product is pitched as "per-second laptop insurance" where the
  risk of a laptop running on battery (out of sight of a socket,
  possibly about to die, possibly being carried) is real and
  measurable. A 2× factor when unplugged is a defensible
  approximation of that risk, especially at the home band where the
  baseline is 1.00×.
- The actuarial argument (battery ⊥ location) holds more weight in a
  real rating engine with thousands of devices and claims data. For a
  60-second demo at a hackathon, losing the reactive signal the user
  expects is worse than losing theoretical purity.
- Integer µ-USDC math is preserved: battery factor is exactly 1 or 2,
  so all rates × factor are still integers.

**Implementation:**

- `BATTERY_MULTIPLIER_UNPLUGGED = 2` in `frontend/src/lib/rulebookV2.ts`.
- `scoreV2` output now splits `locationMultiplier`,
  `batteryMultiplier`, and a compound `multiplier`.
- `microUsdcPerSec` on the output includes the battery factor, so the
  ticker accumulates the compound rate directly.
- `LiveDemo.tsx` derives the displayed compound multiplier from the
  live `battery.charging` ref, so unplugging updates the dial within
  the next render regardless of session tick cadence.
- `SessionSummary` computes average compound multiplier from
  `totalMicroUsdc / (totalSeconds × homeRate)` to correctly reflect
  both location and battery time.

**If a future real-money phase overrules this:**

- Flip `BATTERY_MULTIPLIER_UNPLUGGED` back to `1` (one line), or gate
  the compounding behind a `VITE_BATTERY_COMPOUNDS` flag. All tests
  would need to re-run; the rulebook API already separates
  `locationMultiplier` from `batteryMultiplier`, so call sites don't
  need to change.

## 2026-04-21 — Distance thresholds collapsed to demo scale

**Handoff rule:** `home` ≤ 200 m, `near` ≤ 50 km, hysteresis 50 m. At
those values the product story is realistic for actual laptop risk
(desks, cafés, airports, cross-country travel).

**v2 shipped rule:** `home` ≤ 2 m, `near` ≤ 5 m, hysteresis 1 m.

**Why the deviation:**

- Nobody attending a demo is going to walk 50 km to see the `away`
  band. The original thresholds made the 2× multiplier only
  observable through the dev-only spoof buttons, which is fake in a
  way the presenter just told us they don't want.
- At metres-scale thresholds, walking 5–6 paces from the desk
  physically triggers `away`, which is the promise of the product
  narrative ("your rate goes up the second you walk away").
- The band shape and compound battery semantics are unchanged — only
  the numeric boundaries moved.

**Trade-off:**

- Browser geolocation accuracy is typically 3–10 m outdoors and 20–50
  m indoors, so sitting at a desk on Wi-Fi may still flicker into
  `near` for a second or two despite hysteresis. For a live pitch on
  an outdoor balcony, this is usually fine. For an indoor presentation
  against a Wi-Fi-only fix, consider using the dev spoof buttons or
  demonstrating the charger unplug first (which is always reliable).
- A real-money phase should revert to the production thresholds. The
  constants are at the top of `rulebookV2.ts` and covered by
  band-boundary tests that reference the constants rather than
  literal distances, so the flip is mechanical.
