/**
 * Shared types for the signal collector.
 */

export type WifiTrust = 'home' | 'known' | 'public' | 'unknown' | 'offline';
export type ChargingState = 'ac' | 'battery';
export type LidState = 'open' | 'closed';
export type AppCategory = 'productivity' | 'browser' | 'media' | 'unknown' | 'idle' | null;
export type Trigger = 'scheduled' | 'event' | 'resume-from-offline';

export type EventSignal =
  | 'charging_state'
  | 'lid_state'
  | 'wifi_trust'
  | 'input_idle_flag'
  | null;

export interface ClientSignals {
  wifi_trust: WifiTrust;
  charging_state: ChargingState;
  lid_state: LidState;
  app_category: AppCategory;
  input_idle_flag: boolean;
  battery_health_pct: number | null;
}

export interface Envelope {
  schema_version: '1.0';
  policy_id: string;
  client_ts: string;
  client_nonce: string;
  trigger: Trigger;
  event_signal: EventSignal;
  signals: ClientSignals;
}

export interface SignedEnvelope {
  envelope: Envelope;
  signature: string;
  public_key: string;
}
