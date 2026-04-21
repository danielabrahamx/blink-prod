/**
 * TypeScript row types for every Postgres table Agent B owns.
 *
 * These mirror the column shapes defined in the migration SQL under
 * `backend/migrations/`. Each row interface uses the TypeScript shape a `pg`
 * driver hands back by default:
 *   - UUIDs + TEXT columns -> string
 *   - TIMESTAMPTZ / DATE   -> Date (pg parses types 1082/1114/1184 into Date)
 *   - NUMERIC              -> string (pg returns arbitrary-precision numbers
 *                            as strings; upstream code MUST NOT pass them to
 *                            Number() without guarding for precision loss)
 *   - JSONB                -> parsed JSON value (constrained here where we
 *                            know the shape; `unknown` where we do not)
 *   - BOOLEAN              -> boolean
 *
 * The *Insert* variants mark server-defaulted columns optional so callers can
 * rely on Postgres to fill created_at / server_ts / etc.
 */

import type { QueryResultRow } from "pg";

/** ISO 3166-1 alpha-2 country code. */
export type IsoCountryCode = string;

/** NUMERIC(18,6) or NUMERIC(10,6) — represented as a decimal string. */
export type NumericString = string;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export interface UserRow extends QueryResultRow {
    wallet_addr: string;
    email: string | null;
    jurisdiction_iso: IsoCountryCode;
    tos_hash: string;
    created_at: Date;
}

export interface UserInsert {
    wallet_addr: string;
    email?: string | null;
    jurisdiction_iso: IsoCountryCode;
    tos_hash: string;
    created_at?: Date;
}

// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------

export type DevicePlatform = "windows" | "mac" | "linux";

export interface DeviceRow extends QueryResultRow {
    device_id: string;
    wallet_addr: string;
    device_pubkey: string;
    platform: DevicePlatform;
    os_version: string;
    system_serial_hash: string;
    registered_at: Date;
    revoked_at: Date | null;
}

export interface DeviceInsert {
    device_id?: string;
    wallet_addr: string;
    device_pubkey: string;
    platform: DevicePlatform;
    os_version: string;
    system_serial_hash: string;
    registered_at?: Date;
    revoked_at?: Date | null;
}

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------

export type PolicyStatus =
    | "draft"
    | "calibrating"
    | "active"
    | "paused_user"
    | "paused_offline"
    | "cancelled_by_user"
    | "cancelled_by_system"
    | "claim_submitted"
    | "claim_approved"
    | "claim_denied"
    | "expiring"
    | "terminated"
    | "claimed";

export interface HomeWifiEntry {
    ssid_hash: string;
    bssid_hash?: string;
}

export interface PolicyRow extends QueryResultRow {
    policy_id: string;
    user_wallet: string;
    device_id: string;
    status: PolicyStatus;
    created_at: Date;
    home_country: IsoCountryCode;
    home_wifi_set: HomeWifiEntry[];
    authorization_cap_usdc: NumericString;
    authorization_valid_until: Date;
    payout_cap_usdc: NumericString;
    claim_waiting_until: Date | null;
}

export interface PolicyInsert {
    policy_id: string;
    user_wallet: string;
    device_id: string;
    status?: PolicyStatus;
    created_at?: Date;
    home_country: IsoCountryCode;
    home_wifi_set?: HomeWifiEntry[];
    authorization_cap_usdc: NumericString;
    authorization_valid_until: Date;
    payout_cap_usdc: NumericString;
    claim_waiting_until?: Date | null;
}

// ---------------------------------------------------------------------------
// state_log
// ---------------------------------------------------------------------------

export interface StateLogRow extends QueryResultRow {
    id: string;
    policy_id: string;
    from_state: string | null;
    to_state: string;
    event: string;
    metadata: Record<string, unknown> | null;
    ts: Date;
}

export interface StateLogInsert {
    policy_id: string;
    from_state?: string | null;
    to_state: string;
    event: string;
    metadata?: Record<string, unknown> | null;
    ts?: Date;
}

// ---------------------------------------------------------------------------
// signal_envelopes
// ---------------------------------------------------------------------------

export type EnvelopeTrigger = "scheduled" | "event" | "resume-from-offline" | "sleep";

export interface SignalEnvelopeRow extends QueryResultRow {
    envelope_id: string;
    policy_id: string;
    client_ts: Date;
    server_ts: Date;
    client_nonce: string;
    trigger: EnvelopeTrigger | string;
    signals_jsonb: Record<string, unknown>;
    sig: string;
}

export interface SignalEnvelopeInsert {
    envelope_id?: string;
    policy_id: string;
    client_ts: Date;
    server_ts?: Date;
    client_nonce: string;
    trigger: EnvelopeTrigger | string;
    signals_jsonb: Record<string, unknown>;
    sig: string;
}

// ---------------------------------------------------------------------------
// features
// ---------------------------------------------------------------------------

export interface FeatureRow extends QueryResultRow {
    feature_id: string;
    envelope_id: string;
    feature_version: string;
    features_jsonb: Record<string, unknown>;
    computed_at: Date;
}

export interface FeatureInsert {
    feature_id?: string;
    envelope_id: string;
    feature_version: string;
    features_jsonb: Record<string, unknown>;
    computed_at?: Date;
}

// ---------------------------------------------------------------------------
// audit_score
// ---------------------------------------------------------------------------

export interface AuditScoreRow extends QueryResultRow {
    score_id: string;
    policy_id: string;
    envelope_id: string;
    feature_id: string;
    model_version: string;
    multiplier: NumericString;
    explanation_jsonb: Record<string, unknown>;
    computed_at: Date;
}

export interface AuditScoreInsert {
    score_id?: string;
    policy_id: string;
    envelope_id: string;
    feature_id: string;
    model_version: string;
    multiplier: NumericString;
    explanation_jsonb: Record<string, unknown>;
    computed_at?: Date;
}

// ---------------------------------------------------------------------------
// x402_authorizations
// ---------------------------------------------------------------------------

export interface X402AuthorizationRow extends QueryResultRow {
    auth_id: string;
    policy_id: string;
    session_pubkey: string;
    cap_usdc: NumericString;
    valid_until: Date;
    consumed_usdc: NumericString;
    revoked_at: Date | null;
    user_signature: string;
    created_at: Date;
}

export interface X402AuthorizationInsert {
    auth_id?: string;
    policy_id: string;
    session_pubkey: string;
    cap_usdc: NumericString;
    valid_until: Date;
    consumed_usdc?: NumericString;
    revoked_at?: Date | null;
    user_signature: string;
    created_at?: Date;
}

// ---------------------------------------------------------------------------
// settlement_receipts
// ---------------------------------------------------------------------------

export type SettlementStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface SettlementReceiptRow extends QueryResultRow {
    receipt_id: string;
    policy_id: string;
    window_start: Date;
    window_end: Date;
    amount_usdc: NumericString;
    circle_tx_hash: string | null;
    status: SettlementStatus;
    submitted_at: Date | null;
    confirmed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface SettlementReceiptInsert {
    receipt_id?: string;
    policy_id: string;
    window_start: Date;
    window_end: Date;
    amount_usdc: NumericString;
    circle_tx_hash?: string | null;
    status?: SettlementStatus;
    submitted_at?: Date | null;
    confirmed_at?: Date | null;
    created_at?: Date;
    updated_at?: Date;
}

// ---------------------------------------------------------------------------
// claims
// ---------------------------------------------------------------------------

export type ClaimStatus = "submitted" | "under_review" | "approved" | "denied" | "paid";

export interface ClaimRow extends QueryResultRow {
    claim_id: string;
    policy_id: string;
    submitted_at: Date;
    /** DATE column — pg returns a Date pinned to midnight UTC of the incident day. */
    incident_date: Date;
    description: string;
    evidence_urls: string[];
    amount_claimed_usdc: NumericString;
    status: ClaimStatus;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    payout_tx_hash: string | null;
    fraud_flags: string[];
    denial_reason: string | null;
}

export interface ClaimInsert {
    claim_id?: string;
    policy_id: string;
    submitted_at?: Date;
    incident_date: Date | string;
    description: string;
    evidence_urls?: string[];
    amount_claimed_usdc: NumericString;
    status?: ClaimStatus;
    reviewed_by?: string | null;
    reviewed_at?: Date | null;
    payout_tx_hash?: string | null;
    fraud_flags?: string[];
    denial_reason?: string | null;
}
