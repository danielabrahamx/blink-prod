-- 008 x402_authorizations
-- EIP-3009-style authorizations: user wallet grants session_pubkey the
-- right to auto-sign 402 challenges up to cap_usdc until valid_until.
-- consumed_usdc is a running tally maintained by the settlement worker.
-- revoked_at non-null means the authorization is dead and no further
-- challenges should be signed against it. A CHECK keeps the tally
-- non-negative and bounded by the cap so the worker cannot overspend.

CREATE TABLE IF NOT EXISTS x402_authorizations (
    auth_id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id        TEXT           NOT NULL REFERENCES policies (policy_id) ON DELETE CASCADE,
    session_pubkey   TEXT           NOT NULL,
    cap_usdc         NUMERIC(18,6)  NOT NULL,
    valid_until      TIMESTAMPTZ    NOT NULL,
    consumed_usdc    NUMERIC(18,6)  NOT NULL DEFAULT 0,
    revoked_at       TIMESTAMPTZ,
    user_signature   TEXT           NOT NULL,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_consumed_within_cap CHECK (consumed_usdc >= 0 AND consumed_usdc <= cap_usdc)
);

CREATE INDEX IF NOT EXISTS idx_x402_auth_policy_id ON x402_authorizations (policy_id);
CREATE INDEX IF NOT EXISTS idx_x402_auth_session_pubkey ON x402_authorizations (session_pubkey);
CREATE INDEX IF NOT EXISTS idx_x402_auth_active
    ON x402_authorizations (policy_id, valid_until DESC)
    WHERE revoked_at IS NULL;
