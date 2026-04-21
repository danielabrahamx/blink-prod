-- 005 signal_envelopes
-- Raw signed envelopes POSTed to /signals. client_ts is what the laptop
-- stamped; server_ts is when we received it. (policy_id, client_nonce) is
-- unique to enforce replay protection while allowing different policies to
-- pick unrelated nonce spaces. trigger is "scheduled" | "event" |
-- "resume-from-offline" etc. signals_jsonb is the canonical JCS payload;
-- sig is the base64 ed25519 signature verified against the device_pubkey
-- on the linked policy.

CREATE TABLE IF NOT EXISTS signal_envelopes (
    envelope_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id      TEXT          NOT NULL REFERENCES policies (policy_id) ON DELETE CASCADE,
    client_ts      TIMESTAMPTZ   NOT NULL,
    server_ts      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    client_nonce   TEXT          NOT NULL,
    trigger        TEXT          NOT NULL,
    signals_jsonb  JSONB         NOT NULL,
    sig            TEXT          NOT NULL,
    CONSTRAINT uniq_envelope_policy_nonce UNIQUE (policy_id, client_nonce)
);

CREATE INDEX IF NOT EXISTS idx_signal_envelopes_policy_id ON signal_envelopes (policy_id);
CREATE INDEX IF NOT EXISTS idx_signal_envelopes_policy_ts
    ON signal_envelopes (policy_id, server_ts DESC);
