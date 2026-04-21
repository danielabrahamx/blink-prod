-- 009 settlement_receipts
-- One row per batched premium window. window_start / window_end define the
-- accrual interval. amount_usdc is the batched premium. circle_tx_hash is
-- populated once Circle's x402-batching service confirms the Arc testnet
-- transfer into BlinkReserve. status tracks the async lifecycle via a CHECK
-- constraint per the Agent B spec. submitted_at + confirmed_at record the
-- transition timestamps for reconciliation. UNIQUE(policy_id, window_end)
-- prevents double-billing the same window.

CREATE TABLE IF NOT EXISTS settlement_receipts (
    receipt_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id        TEXT          NOT NULL REFERENCES policies (policy_id) ON DELETE CASCADE,
    window_start     TIMESTAMPTZ   NOT NULL,
    window_end       TIMESTAMPTZ   NOT NULL,
    amount_usdc      NUMERIC(18,6) NOT NULL,
    circle_tx_hash   TEXT,
    status           TEXT          NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
    submitted_at     TIMESTAMPTZ,
    confirmed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uniq_settlement_policy_window UNIQUE (policy_id, window_end)
);

CREATE INDEX IF NOT EXISTS idx_settlement_policy_id ON settlement_receipts (policy_id);
CREATE INDEX IF NOT EXISTS idx_settlement_receipts_status
    ON settlement_receipts (status)
    WHERE status IN ('pending', 'submitted');
CREATE INDEX IF NOT EXISTS idx_settlement_policy_window
    ON settlement_receipts (policy_id, window_end DESC);
