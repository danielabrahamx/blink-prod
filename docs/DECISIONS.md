# Engineering Decisions Log

Decisions that deviate from a spec, or pick between multiple reasonable
options. Add an entry every time a judgement call shapes the codebase.

---

## 2026-04-21 — Risk Engine (Agent E)

### FeatureVector schema: categorical raw signals, not derived scalars

Two specs described the FeatureVector differently:

- **Design doc (Module 2)** proposed derived scalar fields (`wifi_trust_score`
  0-1, `at_desk_confidence` 0-1, `device_age_risk` 0-1, etc).
- **Agent E handoff** specified categorical raw signals (`wifi_trust:
  "home" | "unknown" | "untrusted"`, `charging_state: "charging" |
  "battery"`, bucketed `battery_health_pct`, etc).

**Decision: implemented the handoff schema.**

Reasoning:

1. The actuarial team wants to see raw categorical signals in the audit
   log so they can re-derive features under new extractors. Scalar
   derivations are a model concern; pushing them into the FV makes it
   harder to evolve the model without touching the schema.
2. Re-scoring historical data becomes a single function swap
   (`rulebookV1` → `glmV1`) rather than a dual re-extract + re-score.
3. The handoff is more recent than the design doc's FV snippet, and the
   doc's "illustrative" rulebook was explicitly flagged
   ("illustrative — actuarial will replace").
4. Category tables are inspectable by non-engineers (actuary, ops).

Trade-off: a lossy mapping from raw signals to categorical enums. E.g.
the envelope reports `wifi_trust: "home" | "known" | "public" | "unknown"
| "offline"` but the FV collapses this to three tiers. We preserve the
full envelope in `signal_envelope` (pg schema from Agent B) so the
mapping is recoverable; only the FV snapshot in `audit_score` is lossy.

See `backend/src/risk/types.ts` and `backend/src/risk/feature-vector.ts`.

### Factor-product rulebook with three-tier gates

The rulebook multiplies per-factor contributions, then applies gates in
priority order:

1. Hard bounds: `[MULTIPLIER_MIN=0.5, MULTIPLIER_MAX=3.0]`
2. Rate-of-change clamp: `prior_multiplier ± 40%` (anti-whiplash)
3. Calibrating hard-cap: `≤ 1.0x` while `calibration_done=false`

Gate #3 is the **highest priority** — it must override both clamps so
incomplete-calibration policies can never accidentally charge >1.0x even
when the rate-of-change clamp would allow it.

See `backend/src/risk/rulebook-v1.ts`.

### Rate-of-change clamp: 40% per envelope

Design doc doesn't pin a specific delta. `RATE_OF_CHANGE_MAX_DELTA = 0.4`
chosen so a single envelope can swing the multiplier by at most ±40% of
the prior value. Rationale: a user closing their lid shouldn't double
their premium rate in one second. Actuary will tune later. Documented as
an exported constant so the admin portal can display the current value.

### Jurisdiction: tiered factor, not a single boolean

Design doc originally used `jurisdiction_match: boolean`. Handoff
specified three tiers (home_match 1.0, within_jurisdiction 1.15,
international 1.5). Implemented as tiered with a `within_jurisdiction`
set threaded from policy context. Absent set ⇒ two-tier behaviour (the
middle bucket is never used).

### FSM: expanded claim lifecycle beyond design doc

Design doc Module 0.5 mentions `claim_waiting_period` as an **orthogonal
flag** on the policy row, not a first-class state. The Agent E handoff
expanded the claim lifecycle into distinct states:
`claim_submitted → claim_approved → terminated` and
`claim_submitted → claim_denied`.

Implemented the handoff's richer FSM because:

1. `state_log` becomes the single source of truth for audit — easier for
   carrier reporting.
2. Admin UI can render per-state actions (approve/deny buttons on
   `claim_submitted`, not on arbitrary states).
3. `claim_waiting_period` is still preserved as a flag (via
   `claim_waiting_cleared` on `TransitionContext`) — the flag gates the
   `claim_approved → terminated` transition.

### Backend deps: vendored install excludes Circle private registry

Agent E's scope is server-agnostic (risk engine + FSM — no x402 / Circle
dependencies). The worktree inherits a repo-root workspace config and a
`.npmrc` pointing at the Circle Cloudsmith private registry, which
requires `CLOUDSMITH_TOKEN`. On this hacking worktree the token isn't
set, so `npm install` fails resolving `@circlefin/x402-batching`.

Decision: temporarily removed Circle/x402 packages from
`backend/package.json` to unblock `bun install`. Agent A's Wave 3 merge
will land the richer `package.json` that includes those deps and a
restored `.npmrc`. My scope doesn't use them, so this is a pure
install-time concern.

Files:
- `backend/.npmrc.circle` — original `.npmrc` preserved (restore on merge).
- `backend/package.json` — trimmed to what Agent E consumes. Circle deps
  return when Agent A's richer config wins at merge.
