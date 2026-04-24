# Known limitations

What the founder dogfood build cannot yet do. Prioritized by user impact.

## Build / distribution

- Installer is unsigned (no EV code-signing cert). Windows SmartScreen warns on install; user must click "Run anyway".
- Mac build not available (Phase 6).

## Product

- One device per user (multi-device pilot deferred).
- No Mac signal collector.

## Compliance

- Sanctions screen uses Circle Compliance API (OFAC + UK). No additional jurisdictions.
- No KYC required for pilot; founder-only dogfood.

## Infrastructure

- No production monitoring (Sentry-ready, not connected).
- No automated backups of Postgres (dev only).
