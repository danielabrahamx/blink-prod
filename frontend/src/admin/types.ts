// Admin portal shared types. These mirror Module 5 of the master design doc.
// Types are intentionally self-contained so this Agent G worktree compiles
// without depending on Agent A's backend types (Wave 3 will reconcile).

export type FsmState =
  | 'calibrating'
  | 'active'
  | 'suspended'
  | 'cancelled'
  | 'claimed'
  | 'expired';

export interface MultiplierBreakdownFactor {
  signal: string;
  weight: number;
  contribution: number;
  note?: string;
}

export interface MultiplierBreakdown {
  base: number;
  factors: MultiplierBreakdownFactor[];
  multiplier: number;
  rulebook_version: string;
  computed_at: string;
}

export interface SignalEnvelope {
  signal_id: string;
  kind: string;
  received_at: string;
  latency_ms: number;
  verified: boolean;
  payload_digest: string;
}

export interface FeatureVectorPoint {
  computed_at: string;
  rulebook_version: string;
  features: Record<string, number | string | boolean>;
  multiplier: number;
}

export interface AccrualLedgerEntry {
  minute_index: number;
  ts: string;
  rate_usdc: number;
  multiplier: number;
  accrued_usdc: number;
  state: FsmState;
}

export interface EscrowAuthorization {
  authorization_id: string;
  cap_usdc: number;
  consumed_usdc: number;
  consumption_pct: number;
  valid_until: string;
  session_key_pubkey: string;
  revoked: boolean;
}

export interface SettlementReceipt {
  receipt_id: string;
  settled_at: string;
  amount_usdc: number;
  tx_hash: string;
  status: 'settled' | 'failed' | 'pending';
}

export interface ClaimRecord {
  claim_id: string;
  opened_at: string;
  status: 'open' | 'review' | 'paid' | 'denied';
  amount_usdc: number;
  summary: string;
}

export interface FsmTransition {
  ts: string;
  from: FsmState;
  to: FsmState;
  reason: string;
  actor: string;
}

export interface PolicyInspectorData {
  policy_id: string;
  wallet_addr: string;
  current_state: FsmState;
  current_multiplier: number;
  breakdown: MultiplierBreakdown;
  signal_timeline_24h: SignalEnvelope[];
  feature_history: FeatureVectorPoint[];
  accrual_ledger: AccrualLedgerEntry[];
  escrow_authorization: EscrowAuthorization;
  settlement_receipts: SettlementReceipt[];
  claims: ClaimRecord[];
  fsm_log: FsmTransition[];
}

export interface ReplayRequest {
  policy_id: string;
  window_start: string;
  window_end: string;
  model_version: string;
}

export interface ReplayMinutePoint {
  ts: string;
  multiplier_replay: number;
  multiplier_actual: number;
  delta: number;
  accrued_delta_usdc: number;
}

export interface ReplayResult {
  request: ReplayRequest;
  generated_at: string;
  minute_series: ReplayMinutePoint[];
  total_accrued_delta_usdc: number;
}

export interface AdminMetrics {
  generated_at: string;
  active_policies: number;
  avg_multiplier: number;
  ingest_latency_ms: { p50: number; p95: number; p99: number };
  claim_queue_depth: number;
  authorization_consumption_pct: number;
}

export interface AdminRole {
  wallet_addr: string;
  role: 'admin' | 'operator' | 'viewer';
  display_name?: string;
}
