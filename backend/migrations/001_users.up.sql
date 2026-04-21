-- 001 users
-- Wallet address is the primary identity. Email is optional; jurisdiction_iso is
-- the ISO 3166-1 alpha-2 country code captured at onboarding for routing and
-- data-residency enforcement. tos_hash is the SHA-256 of the accepted ToS/
-- Privacy Policy version so we can prove which revision the user agreed to.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    wallet_addr       TEXT        PRIMARY KEY,
    email             TEXT,
    jurisdiction_iso  CHAR(2)     NOT NULL,
    tos_hash          TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_jurisdiction_iso ON users (jurisdiction_iso);
