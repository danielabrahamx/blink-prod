// Types shared across main / preload / renderer.
// Renderer imports these via the `@shared` alias through the preload boundary;
// values never cross the bridge, only their shapes.

import { z } from 'zod';

// ---------- Signal envelope (Module 1) ----------

export const SignalEnvelopeSchema = z.object({
  version: z.literal(1),
  policy_id: z.string(),
  device_pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  client_ts: z.string().datetime(),
  client_nonce: z.string(),
  signals: z.object({
    wifi_trust: z.enum(['home', 'known', 'public', 'unknown']).nullable(),
    charging_state: z.enum(['charging', 'discharging', 'full', 'unknown']).nullable(),
    lid_state: z.enum(['open', 'closed', 'unknown']).nullable(),
    app_category: z.enum(['productivity', 'browser', 'media', 'idle', 'unknown']).nullable(),
    input_idle_flag: z.boolean().nullable(),
    motion_magnitude: z.number().nullable(),
    battery_health_pct: z.number().min(0).max(100).nullable(),
  }),
  signature: z.string(),
});
export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;

// ---------- EIP-3009 authorization (Module 3) ----------

export const EIP3009AuthorizationSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // USDC value encoded as decimal string (wei-scale of token decimals).
  value: z.string().regex(/^\d+$/),
  validAfter: z.number().int().nonnegative(),
  validBefore: z.number().int().nonnegative(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  // Session key address the user is authorizing.
  sessionKeyAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Cumulative cap (USDC decimal string) across the authorization window.
  cap: z.string().regex(/^\d+$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
export type EIP3009Authorization = z.infer<typeof EIP3009AuthorizationSchema>;

// ---------- Settlement status ----------

export type SettlementStatusState =
  | 'idle'
  | 'awaiting_auth'
  | 'active'
  | 'paused_cap'
  | 'paused_offline'
  | 'paused_user';

export interface SettlementStatus {
  state: SettlementStatusState;
  authorization: EIP3009Authorization | null;
  consumed: string; // USDC decimal string
  remaining: string; // USDC decimal string
  lastSettlementAt: string | null;
  pendingCount: number;
  confirmedCount: number;
}

// ---------- Sign request / result ----------

export interface SignRequest {
  message: Uint8Array;
}

export interface SignResult {
  signature: Uint8Array;
  publicKey: string; // hex
}

// ---------- Config ----------

export interface AppConfig {
  onboardingComplete: boolean;
  walletAddress: string | null;
  backendUrl: string;
  rpcUrl: string;
  homeSsidHashes: string[];
  telemetryEnabled: boolean;
  lastSignalAt: string | null;
  windowState: WindowState;
}

export interface WindowState {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
}

// ---------- Telemetry ----------

export interface TelemetryEvent {
  event: string;
  props: Record<string, unknown>;
  ts: string;
}

// ---------- Key info ----------

export interface KeyInfo {
  publicKey: string; // hex, 32 bytes
  createdAt: string;
  rotatedAt: string | null;
}
