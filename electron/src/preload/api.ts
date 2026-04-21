// Runtime-importable counterpart to `api.d.ts`.
// Re-exports the interface so `preload/index.ts` can `import type`
// without surfacing a .d.ts-only dependency in the build graph.

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
