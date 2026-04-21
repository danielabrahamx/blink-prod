-- 003 policies
-- One row per policy. policy_id is a user-visible prefixed ULID (e.g.
-- pol_01HXAMPLE) generated at creation time. The prefixed-ULID format is
-- a deliberate deviation from a raw UUID PK: the design doc Module 0.E1
-- uses "pol_01HXAMPLE" in every diagram, and the prefix is load-bearing
-- for admin-surface readability. See docs/DEVIATIONS.md.
--
-- status follows the FSM in Module 0.5 of the design doc. The enum is a
-- superset of the Agent B prompt list: design-doc states (`expiring`,
-- `terminated`, `claimed`) coexist with the newer claim-phase states
-- (`claim_submitted`, `claim_approved`, `claim_denied`) so the same column
-- drives both the policy lifecycle and the claim outcome.
--
-- home_wifi_set is a JSONB array of hashed SSID/BSSID entries learned during
-- the 48h calibration window. authorization_cap_usdc + authorization_valid_until
-- mirror the EIP-3009 envelope the user signed at purchase; payout_cap_usdc
-- bounds claim payouts; claim_waiting_until holds the timestamp after which
-- the policy is eligible for claim filing.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_status') THEN
        CREATE TYPE policy_status AS ENUM (
            'draft',
            'calibrating',
            'active',
            'paused_user',
            'paused_offline',
            'cancelled_by_user',
            'cancelled_by_system',
            'claim_submitted',
            'claim_approved',
            'claim_denied',
            'expiring',
            'terminated',
            'claimed'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS policies (
    policy_id                    TEXT           PRIMARY KEY,
    user_wallet                  TEXT           NOT NULL REFERENCES users (wallet_addr) ON DELETE RESTRICT,
    device_id                    UUID           NOT NULL REFERENCES devices (device_id) ON DELETE RESTRICT,
    status                       policy_status  NOT NULL DEFAULT 'draft',
    created_at                   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    home_country                 CHAR(2)        NOT NULL,
    home_wifi_set                JSONB          NOT NULL DEFAULT '[]'::jsonb,
    authorization_cap_usdc       NUMERIC(18,6)  NOT NULL,
    authorization_valid_until    TIMESTAMPTZ    NOT NULL,
    payout_cap_usdc              NUMERIC(18,6)  NOT NULL,
    claim_waiting_until          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_policies_user_wallet ON policies (user_wallet);
CREATE INDEX IF NOT EXISTS idx_policies_device_id ON policies (device_id);
CREATE INDEX IF NOT EXISTS idx_policies_active ON policies (user_wallet) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_policies_open
    ON policies (status)
    WHERE status IN ('draft', 'calibrating', 'active', 'paused_offline', 'paused_user', 'expiring');
