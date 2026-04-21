-- 004 state_log
-- Append-only log of every FSM transition. from_state may be NULL for the
-- initial draft insert. event is the human-readable trigger (e.g.
-- "calibration_complete", "offline_timeout", "user_paused"). metadata
-- optionally carries structured context (incident_id, ingest nonce, etc.).
-- This is the authoritative audit trail referenced by the admin surface.

CREATE TABLE IF NOT EXISTS state_log (
    id          BIGSERIAL      PRIMARY KEY,
    policy_id   TEXT           NOT NULL REFERENCES policies (policy_id) ON DELETE CASCADE,
    from_state  TEXT,
    to_state    TEXT           NOT NULL,
    event       TEXT           NOT NULL,
    metadata    JSONB,
    ts          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_log_policy_id ON state_log (policy_id);
CREATE INDEX IF NOT EXISTS idx_state_log_policy_ts ON state_log (policy_id, ts DESC);
