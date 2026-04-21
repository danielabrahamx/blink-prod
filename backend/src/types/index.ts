/**
 * Shared types for the Blink backend. Mirrors the schemas in the
 * approved design doc (rev 7), Modules 1 and 2.
 */

export type WifiTrust = 'home' | 'known' | 'public' | 'unknown' | 'offline';
export type ChargingState = 'ac' | 'battery';
export type LidState = 'open' | 'closed';
export type AppCategory =
  | 'productivity'
  | 'browser'
  | 'media'
  | 'unknown'
  | 'idle'
  | null;

export type EnvelopeTrigger = 'scheduled' | 'event' | 'resume-from-offline';

export interface SignalPayload {
  wifi_trust: WifiTrust;
  charging_state: ChargingState;
  lid_state: LidState;
  app_category: AppCategory;
  input_idle_flag: boolean;
  battery_health_pct: number | null;
  // ip_country is server-side appended; clients never supply it.
  ip_country?: string;
}

export interface SignalEnvelope {
  schema_version: '1.0';
  policy_id: string;
  client_ts: string;
  client_nonce: string;
  trigger: EnvelopeTrigger;
  event_signal: string | null;
  signals: SignalPayload;
}

export interface SignedSignalEnvelope {
  envelope: SignalEnvelope;
  signature: string; // base64 or hex, Ed25519 over JCS(envelope)
  device_id: string;
}

export interface FeatureVector {
  wifi_trust_score: number; // 0-1
  at_desk_confidence: number; // 0-1
  jurisdiction_match: boolean;
  device_age_risk: number; // 0-1
  time_of_day: number; // 0-23
  activity_signal: 'active' | 'idle' | 'sleep';
  policy_age_days: number;
}

export interface ExplanationFactor {
  factor: string;
  value: number | string | boolean;
  contribution: number; // multiplicative contribution
}

export interface Explanation {
  factors: ExplanationFactor[];
  base_multiplier: number;
  final_multiplier: number;
}

export interface ScoredMultiplier {
  multiplier: number;
  model_version: string;
  features: FeatureVector;
  explanation: Explanation;
  computed_at: string;
}

export type PolicyStatus =
  | 'draft'
  | 'calibrating'
  | 'active'
  | 'paused_offline'
  | 'paused_user'
  | 'expiring'
  | 'terminated'
  | 'cancelled_by_user';

export interface Policy {
  policy_id: string;
  wallet_addr: string;
  home_country: string;
  status: PolicyStatus;
  created_at: string;
  calibrated_at: string | null;
  terminated_at: string | null;
}

export interface Device {
  device_id: string;
  wallet_addr: string;
  device_pubkey: string; // hex or base64 ed25519 public key
  platform: string;
  os_version: string;
  registered_at: string;
}

export interface AccrualEntry {
  policy_id: string;
  ts: string;
  duration_seconds: number;
  base_rate_usdc: number;
  multiplier: number;
  charged_usdc: number;
  model_version: string;
}
