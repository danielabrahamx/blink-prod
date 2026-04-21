// Renderer-side ambient type for the contextBridge surface.
// The actual binding is attached by `preload/index.ts` at startup; this
// declaration lets `frontend/src/**` import from `@/lib/electron` (or any
// consumer) and get full typing.

import type {
  AppConfig,
  EIP3009Authorization,
  SettlementStatus,
  SignalEnvelope,
} from '../shared/types.js';

export interface BlinkElectronApi {
  session: {
    getPublicKey(): Promise<string>;
    rotate(): Promise<string>;
    sign(message: Uint8Array): Promise<Uint8Array>;
  };
  device: {
    getPublicKey(): Promise<string>;
    fingerprint(): Promise<string>;
  };
  signals: {
    start(policyId: string): Promise<void>;
    stop(): Promise<void>;
    getLatest(): Promise<SignalEnvelope | null>;
  };
  settlement: {
    registerAuthorization(auth: EIP3009Authorization): Promise<void>;
    getStatus(): Promise<SettlementStatus>;
  };
  config: {
    get<K extends keyof AppConfig>(k: K): Promise<AppConfig[K]>;
    set<K extends keyof AppConfig>(k: K, v: AppConfig[K]): Promise<void>;
  };
  telemetry: {
    track(event: string, props: Record<string, unknown>): void;
  };
}

declare global {
  interface Window {
    electron: BlinkElectronApi;
  }
}

export {};
