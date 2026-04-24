# v1 build notes (archived)

These two files are historical artifacts from the v1 real-mode founder-dogfood build
(branch `main`, commits around 2026-04-21). They were written during the parallel
8-branch orchestration that produced the v1 desktop/backend stack and were never
committed to the main tree — archived here on 2026-04-24 during v2 cleanup to preserve
the context.

- `LIMITATIONS.md` — honest snapshot of what v1 could and could not do at founder-dogfood
  time (unsigned installer, no Mac build, no KYC, no production monitoring, etc).
- `FUTURE-WORK.md` — explicitly deferred roadmap items: Mac build, actuarial GLM, ML
  risk model v2, Sentry/DataDog, electron-updater infrastructure.

Relevant to anyone flipping v2 back to real-mode or resurrecting the v1 desktop path
from tag `v0.1.0-founder-dogfood`.
