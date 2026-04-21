-- 010 claims
-- One row per claim submission. evidence_urls is a JSONB array of storage
-- object URIs (photos, police reports, receipts). fraud_flags holds any
-- triggered heuristics (e.g. "incident_before_waiting_period",
-- "device_offline_at_incident"). payout_tx_hash is filled when the manual
-- reviewer approves and the Arc payout lands. denial_reason is populated
-- when the claim is denied so the user sees a coherent rejection message.
-- incident_date is a plain DATE because we ask the user "when did this
-- happen" with day-level resolution; the signed envelopes carry the finer
-- timestamps required for fraud correlation.

CREATE TABLE IF NOT EXISTS claims (
    claim_id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id              TEXT           NOT NULL REFERENCES policies (policy_id) ON DELETE RESTRICT,
    submitted_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    incident_date          DATE           NOT NULL,
    description            TEXT           NOT NULL,
    evidence_urls          JSONB          NOT NULL DEFAULT '[]'::jsonb,
    amount_claimed_usdc    NUMERIC(18,6)  NOT NULL,
    status                 TEXT           NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'under_review', 'approved', 'denied', 'paid')),
    reviewed_by            TEXT,
    reviewed_at            TIMESTAMPTZ,
    payout_tx_hash         TEXT,
    fraud_flags            JSONB          NOT NULL DEFAULT '[]'::jsonb,
    denial_reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_claims_policy_id ON claims (policy_id);
CREATE INDEX IF NOT EXISTS idx_claims_pending
    ON claims (submitted_at)
    WHERE status IN ('submitted', 'under_review');
CREATE INDEX IF NOT EXISTS idx_claims_policy_submitted
    ON claims (policy_id, submitted_at DESC);
