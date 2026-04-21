// Signal collector -- EXPORTED INTERFACE ONLY.
// Agent D fills in the 7-signal implementation on the `feat/signal-agent`
// branch. This file defines the contract that the main process + IPC
// layer can depend on today.
//
// Wiring is intentionally thin: the stub implementation returns `null`
// from `getLatest()` and is a no-op for start/stop so the rest of the
// shell can compile + start without a real collector.

import type { SignalEnvelope } from '../shared/types.js';

export interface CollectorStartOptions {
  policyId: string;
  /** Tick interval in ms. Collector orchestrator uses 60_000 in production. */
  intervalMs?: number;
}

export interface SignalCollector {
  start(options: CollectorStartOptions): Promise<void>;
  stop(): Promise<void>;
  /** Most recent envelope produced by this collector, or null if none yet. */
  getLatest(): Promise<SignalEnvelope | null>;
  /** True while the collector is actively sampling. */
  isRunning(): boolean;
}

/**
 * Factory for the stub collector. Agent D replaces the body on `feat/signal-agent`
 * to wire in node-wifi, get-windows, powerMonitor, systeminformation, etc.
 */
export async function createSignalCollector(): Promise<SignalCollector> {
  let running = false;
  let activePolicyId: string | null = null;

  return {
    async start({ policyId }: CollectorStartOptions): Promise<void> {
      running = true;
      activePolicyId = policyId;
    },
    async stop(): Promise<void> {
      running = false;
      activePolicyId = null;
    },
    async getLatest(): Promise<SignalEnvelope | null> {
      // Stub: Agent D populates this from the in-memory ring buffer.
      void activePolicyId;
      return null;
    },
    isRunning(): boolean {
      return running;
    },
  };
}

// Re-export the envelope type so sibling modules can import from one place.
export type { SignalEnvelope } from '../shared/types.js';
