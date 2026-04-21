-- seed.sql
-- Deterministic fixtures used by integration tests and local dev.
-- One user, one device, one calibrating policy, one x402 authorization,
-- 5 signal envelopes (scheduled / event / resume-from-offline / event / scheduled),
-- 5 features, 5 scores, one pending settlement receipt, one submitted claim.
-- Re-running is idempotent thanks to ON CONFLICT DO NOTHING guards.

-- user
INSERT INTO users (wallet_addr, email, jurisdiction_iso, tos_hash, created_at)
VALUES (
    '0x0000000000000000000000000000000000000001',
    'seed@blink.test',
    'GB',
    'sha256:tos_v1_seed',
    '2026-04-01T00:00:00Z'
)
ON CONFLICT (wallet_addr) DO NOTHING;

-- device
INSERT INTO devices (
    device_id, wallet_addr, device_pubkey, platform, os_version, system_serial_hash, registered_at
)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    '0x0000000000000000000000000000000000000001',
    'ed25519:seed_device_pubkey_base64',
    'windows',
    '10.0.26200',
    'sha256:serial_hash_seed',
    '2026-04-01T00:05:00Z'
)
ON CONFLICT (device_id) DO NOTHING;

-- policy (calibrating — matches design-doc Module 0.E1 onboarding flow)
INSERT INTO policies (
    policy_id, user_wallet, device_id, status, created_at, home_country, home_wifi_set,
    authorization_cap_usdc, authorization_valid_until, payout_cap_usdc, claim_waiting_until
)
VALUES (
    'pol_01HXAMPLE_SEED01',
    '0x0000000000000000000000000000000000000001',
    '11111111-1111-1111-1111-111111111111',
    'calibrating',
    '2026-04-01T00:10:00Z',
    'GB',
    '[{"ssid_hash":"sha256:home_ssid_1","bssid_hash":"sha256:home_bssid_1"}]'::jsonb,
    50.000000,
    '2026-05-01T00:10:00Z',
    500.000000,
    '2026-04-08T00:10:00Z'
)
ON CONFLICT (policy_id) DO NOTHING;

-- FSM history for the seed policy
INSERT INTO state_log (policy_id, from_state, to_state, event, metadata, ts) VALUES
    ('pol_01HXAMPLE_SEED01', NULL,    'draft',       'policy_created',       '{"source":"seed"}'::jsonb, '2026-04-01T00:10:00Z'),
    ('pol_01HXAMPLE_SEED01', 'draft', 'calibrating', 'authorization_signed', '{"auth_id":"22222222-2222-2222-2222-222222222201"}'::jsonb, '2026-04-01T00:11:00Z')
ON CONFLICT DO NOTHING;

-- x402 authorization bound to the session key
INSERT INTO x402_authorizations (
    auth_id, policy_id, session_pubkey, cap_usdc, valid_until, consumed_usdc, user_signature, created_at
)
VALUES (
    '22222222-2222-2222-2222-222222222201',
    'pol_01HXAMPLE_SEED01',
    'ed25519:seed_session_pubkey_base64',
    50.000000,
    '2026-05-01T00:10:00Z',
    0.123456,
    '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00',
    '2026-04-01T00:11:00Z'
)
ON CONFLICT (auth_id) DO NOTHING;

-- signal envelopes (5 — scheduled / event / resume-from-offline / event / scheduled)
INSERT INTO signal_envelopes (
    envelope_id, policy_id, client_ts, server_ts, client_nonce, trigger, signals_jsonb, sig
) VALUES
    ('33333333-3333-3333-3333-333333333301',
     'pol_01HXAMPLE_SEED01',
     '2026-04-03T12:00:00Z', '2026-04-03T12:00:00.200Z',
     'nonce_seed_0001', 'scheduled',
     '{"schema_version":"1.0","wifi_trust":"home","charging_state":"ac","lid_state":"open","app_category":"productivity","input_idle_flag":false,"battery_health_pct":92}'::jsonb,
     'ed25519:sig_seed_0001'),
    ('33333333-3333-3333-3333-333333333302',
     'pol_01HXAMPLE_SEED01',
     '2026-04-03T12:01:00Z', '2026-04-03T12:01:00.180Z',
     'nonce_seed_0002', 'event',
     '{"schema_version":"1.0","wifi_trust":"home","charging_state":"battery","lid_state":"open","app_category":"productivity","input_idle_flag":false,"battery_health_pct":92,"event_signal":"charging_state"}'::jsonb,
     'ed25519:sig_seed_0002'),
    ('33333333-3333-3333-3333-333333333303',
     'pol_01HXAMPLE_SEED01',
     '2026-04-03T12:02:30Z', '2026-04-03T12:02:30.310Z',
     'nonce_seed_0003', 'resume-from-offline',
     '{"schema_version":"1.0","wifi_trust":"unknown","charging_state":"battery","lid_state":"open","app_category":"browser","input_idle_flag":false,"battery_health_pct":92}'::jsonb,
     'ed25519:sig_seed_0003'),
    ('33333333-3333-3333-3333-333333333304',
     'pol_01HXAMPLE_SEED01',
     '2026-04-03T12:04:00Z', '2026-04-03T12:04:00.220Z',
     'nonce_seed_0004', 'event',
     '{"schema_version":"1.0","wifi_trust":"unknown","charging_state":"battery","lid_state":"closed","app_category":"idle","input_idle_flag":true,"battery_health_pct":92,"event_signal":"lid_state"}'::jsonb,
     'ed25519:sig_seed_0004'),
    ('33333333-3333-3333-3333-333333333305',
     'pol_01HXAMPLE_SEED01',
     '2026-04-03T12:05:00Z', '2026-04-03T12:05:00.150Z',
     'nonce_seed_0005', 'scheduled',
     '{"schema_version":"1.0","wifi_trust":"home","charging_state":"ac","lid_state":"open","app_category":"productivity","input_idle_flag":false,"battery_health_pct":92}'::jsonb,
     'ed25519:sig_seed_0005')
ON CONFLICT (policy_id, client_nonce) DO NOTHING;

-- feature rows (5 — one per envelope)
INSERT INTO features (feature_id, envelope_id, feature_version, features_jsonb, computed_at) VALUES
    ('44444444-4444-4444-4444-444444444401',
     '33333333-3333-3333-3333-333333333301',
     'fx-2026.04.1',
     '{"wifi_trust_score":1.0,"at_desk_confidence":0.95,"jurisdiction_match":true,"device_age_risk":0.1,"time_of_day":12,"activity_signal":"active","policy_age_days":2}'::jsonb,
     '2026-04-03T12:00:00.300Z'),
    ('44444444-4444-4444-4444-444444444402',
     '33333333-3333-3333-3333-333333333302',
     'fx-2026.04.1',
     '{"wifi_trust_score":1.0,"at_desk_confidence":0.7,"jurisdiction_match":true,"device_age_risk":0.1,"time_of_day":12,"activity_signal":"active","policy_age_days":2}'::jsonb,
     '2026-04-03T12:01:00.300Z'),
    ('44444444-4444-4444-4444-444444444403',
     '33333333-3333-3333-3333-333333333303',
     'fx-2026.04.1',
     '{"wifi_trust_score":0.2,"at_desk_confidence":0.4,"jurisdiction_match":true,"device_age_risk":0.1,"time_of_day":12,"activity_signal":"active","policy_age_days":2}'::jsonb,
     '2026-04-03T12:02:30.400Z'),
    ('44444444-4444-4444-4444-444444444404',
     '33333333-3333-3333-3333-333333333304',
     'fx-2026.04.1',
     '{"wifi_trust_score":0.2,"at_desk_confidence":0.1,"jurisdiction_match":true,"device_age_risk":0.1,"time_of_day":12,"activity_signal":"idle","policy_age_days":2}'::jsonb,
     '2026-04-03T12:04:00.300Z'),
    ('44444444-4444-4444-4444-444444444405',
     '33333333-3333-3333-3333-333333333305',
     'fx-2026.04.1',
     '{"wifi_trust_score":1.0,"at_desk_confidence":0.95,"jurisdiction_match":true,"device_age_risk":0.1,"time_of_day":12,"activity_signal":"active","policy_age_days":2}'::jsonb,
     '2026-04-03T12:05:00.250Z')
ON CONFLICT (feature_id) DO NOTHING;

-- audit scores (5 — one per feature)
INSERT INTO audit_score (
    score_id, policy_id, envelope_id, feature_id, model_version, multiplier, explanation_jsonb, computed_at
) VALUES
    ('55555555-5555-5555-5555-555555555501',
     'pol_01HXAMPLE_SEED01',
     '33333333-3333-3333-3333-333333333301',
     '44444444-4444-4444-4444-444444444401',
     'rulebook_v1.0.0',
     0.700000,
     '{"rules":[{"id":"home_wifi","contribution":-0.3},{"id":"at_desk","contribution":-0.05},{"id":"active_use","contribution":0.05}]}'::jsonb,
     '2026-04-03T12:00:00.400Z'),
    ('55555555-5555-5555-5555-555555555502',
     'pol_01HXAMPLE_SEED01',
     '33333333-3333-3333-3333-333333333302',
     '44444444-4444-4444-4444-444444444402',
     'rulebook_v1.0.0',
     0.900000,
     '{"rules":[{"id":"home_wifi","contribution":-0.3},{"id":"on_battery","contribution":0.2}]}'::jsonb,
     '2026-04-03T12:01:00.400Z'),
    ('55555555-5555-5555-5555-555555555503',
     'pol_01HXAMPLE_SEED01',
     '33333333-3333-3333-3333-333333333303',
     '44444444-4444-4444-4444-444444444403',
     'rulebook_v1.0.0',
     1.500000,
     '{"rules":[{"id":"untrusted_wifi","contribution":0.5}]}'::jsonb,
     '2026-04-03T12:02:30.500Z'),
    ('55555555-5555-5555-5555-555555555504',
     'pol_01HXAMPLE_SEED01',
     '33333333-3333-3333-3333-333333333304',
     '44444444-4444-4444-4444-444444444404',
     'rulebook_v1.0.0',
     1.900000,
     '{"rules":[{"id":"untrusted_wifi","contribution":0.5},{"id":"lid_closed","contribution":0.2},{"id":"idle","contribution":0.2}]}'::jsonb,
     '2026-04-03T12:04:00.400Z'),
    ('55555555-5555-5555-5555-555555555505',
     'pol_01HXAMPLE_SEED01',
     '33333333-3333-3333-3333-333333333305',
     '44444444-4444-4444-4444-444444444405',
     'rulebook_v1.0.0',
     0.700000,
     '{"rules":[{"id":"home_wifi","contribution":-0.3},{"id":"at_desk","contribution":-0.05}]}'::jsonb,
     '2026-04-03T12:05:00.350Z')
ON CONFLICT (score_id) DO NOTHING;

-- settlement receipt (one pending window)
INSERT INTO settlement_receipts (
    receipt_id, policy_id, window_start, window_end, amount_usdc, status, created_at, updated_at
) VALUES (
    '66666666-6666-6666-6666-666666666601',
    'pol_01HXAMPLE_SEED01',
    '2026-04-03T12:00:00Z',
    '2026-04-03T13:00:00Z',
    0.027500,
    'pending',
    '2026-04-03T13:00:01Z',
    '2026-04-03T13:00:01Z'
)
ON CONFLICT (policy_id, window_end) DO NOTHING;

-- claim (submitted)
INSERT INTO claims (
    claim_id, policy_id, submitted_at, incident_date, description, evidence_urls,
    amount_claimed_usdc, status, fraud_flags
) VALUES (
    '77777777-7777-7777-7777-777777777701',
    'pol_01HXAMPLE_SEED01',
    '2026-04-10T09:00:00Z',
    '2026-04-09',
    'Laptop dropped on pavement outside cafe; screen cracked.',
    '["s3://blink-evidence/claim_77777777/photo_1.jpg","s3://blink-evidence/claim_77777777/receipt.pdf"]'::jsonb,
    420.000000,
    'submitted',
    '[]'::jsonb
)
ON CONFLICT (claim_id) DO NOTHING;
