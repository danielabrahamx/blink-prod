-- 002 devices
-- One row per registered laptop. device_pubkey is the ed25519 public key whose
-- private half lives in the OS keychain and signs every signal envelope.
-- platform is constrained to the three OS targets the agent supports.
-- system_serial_hash is SHA-256(serial || device_secret) so we can spot
-- re-registrations of the same hardware without storing raw serials.
-- revoked_at nullable; non-null means the device key is dead.

CREATE TABLE IF NOT EXISTS devices (
    device_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_addr          TEXT        NOT NULL REFERENCES users (wallet_addr) ON DELETE CASCADE,
    device_pubkey        TEXT        NOT NULL,
    platform             TEXT        NOT NULL
        CHECK (platform IN ('windows', 'mac', 'linux')),
    os_version           TEXT        NOT NULL,
    system_serial_hash   TEXT        NOT NULL,
    registered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_pubkey ON devices (device_pubkey);
CREATE INDEX IF NOT EXISTS idx_devices_wallet_addr ON devices (wallet_addr);
CREATE INDEX IF NOT EXISTS idx_devices_serial_hash ON devices (system_serial_hash);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices (wallet_addr) WHERE revoked_at IS NULL;
