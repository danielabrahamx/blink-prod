-- Settlement layer tables for Blink x402 auto-signer flow.
-- Idempotent — co-exists with Agent B's wider schema migration.
-- Created by Agent F (feat/settlement-x402) for Module 3 of the master design doc.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Stores user-signed EIP-3009 pre-authorizations that bound the session-key
-- auto-signer's spending authority. One active row per policy.
CREATE TABLE IF NOT EXISTS x402_authorizations (
    auth_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id          TEXT NOT NULL,
    user_wallet        TEXT NOT NULL,
    session_pubkey     TEXT NOT NULL,
    cap_usdc           NUMERIC(20, 6) NOT NULL CHECK (cap_usdc > 0),
    consumed_usdc      NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (consumed_usdc >= 0),
    valid_from         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until        TIMESTAMPTZ NOT NULL,
    signature          TEXT NOT NULL,
    nonce              TEXT NOT NULL,
    chain_id           INTEGER NOT NULL DEFAULT 5042002,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT x402_auth_consumed_le_cap CHECK (consumed_usdc <= cap_usdc),
    CONSTRAINT x402_auth_validity_sane    CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_x402_auth_policy_active
    ON x402_authorizations (policy_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_x402_auth_user_wallet
    ON x402_authorizations (user_wallet);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_x402_auth_policy_nonce
    ON x402_authorizations (policy_id, nonce);

-- Written every time the accrual loop issues a 402 challenge.
-- Submitted -> Confirmed transitions land via the Circle settlement webhook.
CREATE TABLE IF NOT EXISTS settlement_receipts (
    receipt_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id          TEXT NOT NULL,
    auth_id            UUID REFERENCES x402_authorizations(auth_id) ON DELETE RESTRICT,
    window_start       TIMESTAMPTZ NOT NULL,
    window_end         TIMESTAMPTZ NOT NULL,
    amount_usdc        NUMERIC(20, 6) NOT NULL CHECK (amount_usdc >= 0),
    multiplier         NUMERIC(10, 4) NOT NULL,
    elapsed_seconds    INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
    base_rate_usdc_per_sec NUMERIC(20, 10) NOT NULL,
    status             TEXT NOT NULL
        CHECK (status IN ('pending','submitted','confirmed','failed','skipped')),
    x402_payload       JSONB,
    payment_response   JSONB,
    circle_tx_hash     TEXT,
    circle_batch_id    TEXT,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT settlement_receipts_window_sane CHECK (window_end >= window_start)
);

-- Idempotency guard: one receipt per (policy, window_end).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_settlement_policy_window
    ON settlement_receipts (policy_id, window_end);

CREATE INDEX IF NOT EXISTS idx_settlement_status
    ON settlement_receipts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_settlement_batch_id
    ON settlement_receipts (circle_batch_id)
    WHERE circle_batch_id IS NOT NULL;

-- Audit log of accrual computations per signal tick.
-- Not every tick produces a settlement receipt (for sub-cent deltas we may
-- fold into the next window), so this is the canonical "true ledger".
CREATE TABLE IF NOT EXISTS accrual_ledger (
    entry_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id          TEXT NOT NULL,
    window_start       TIMESTAMPTZ NOT NULL,
    window_end         TIMESTAMPTZ NOT NULL,
    multiplier         NUMERIC(10, 4) NOT NULL,
    elapsed_seconds    INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
    base_rate_usdc_per_sec NUMERIC(20, 10) NOT NULL,
    delta_usdc         NUMERIC(20, 6) NOT NULL,
    cumulative_usdc    NUMERIC(20, 6) NOT NULL,
    receipt_id         UUID REFERENCES settlement_receipts(receipt_id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_accrual_policy_window
    ON accrual_ledger (policy_id, window_end);

CREATE INDEX IF NOT EXISTS idx_accrual_policy_time
    ON accrual_ledger (policy_id, window_end DESC);

-- Ensures the webhook handler never double-applies the same Circle event.
CREATE TABLE IF NOT EXISTS circle_webhook_events (
    webhook_id         TEXT PRIMARY KEY,
    event_type         TEXT NOT NULL,
    payload            JSONB NOT NULL,
    processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Updated-at trigger for settlement_receipts.
CREATE OR REPLACE FUNCTION settlement_receipts_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settlement_receipts_updated_at ON settlement_receipts;
CREATE TRIGGER trg_settlement_receipts_updated_at
    BEFORE UPDATE ON settlement_receipts
    FOR EACH ROW EXECUTE FUNCTION settlement_receipts_touch_updated_at();
