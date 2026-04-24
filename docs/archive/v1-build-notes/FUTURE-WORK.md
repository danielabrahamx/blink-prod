# Future work

Explicitly deferred scope. Tracked so nothing silently becomes tech debt.

## Phase 6 — Mac build
- electron-builder Mac config, Apple Developer cert, notarization.
- signal-collector for macOS: replace `get-windows`, `node-wifi` macOS Location Services permission flow, lid heuristic for macOS.

## Actuarial GLM
- Replace `rulebook-v1` with GLM coefficients from live dogfood data.
- `model_version` on `audit_score` already supports version swap; replay engine already supports re-scoring.

## ML risk model (v2)
- Ingest audit_score history; train XGBoost or GBM; A/B test vs rulebook on replay.

## Admin observability
- Wire Sentry + DataDog for production.
- Synthetic probes on /signals, /settlement endpoints.

## Auto-update
- Electron-updater already wired; infrastructure pending (S3 bucket + signed manifests).
