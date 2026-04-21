/**
 * Bridge between the IPC layer (main/ipc.ts) and the underlying
 * orchestrator `SignalCollector`. The IPC surface speaks `start({policyId})`,
 * `stop()`, and `getLatest()`. The underlying orchestrator wants a fully
 * wired collector (deviceKey + transport + offlineQueue + snapshot).
 *
 * The factory starts in an inert state; once the user onboards, the app's
 * dependency injector calls `attach()` with the real dependencies. Until
 * then `start()` is a no-op and `getLatest()` returns null.
 */

import type { SignedEnvelope } from './types';
import { SignalCollector as SignalCollectorImpl, type CollectorOptions } from './collector';

export interface SignalCollectorFacade {
  start(opts: { policyId: string }): Promise<void>;
  stop(): Promise<void>;
  getLatest(): SignedEnvelope | null;
  attach(deps: Omit<CollectorOptions, 'policy_id'>): void;
}

export type SignalCollector = SignalCollectorFacade;

export function createSignalCollector(): SignalCollectorFacade {
  let inner: SignalCollectorImpl | null = null;
  let latest: SignedEnvelope | null = null;
  let attached: Omit<CollectorOptions, 'policy_id'> | null = null;

  return {
    async start(opts: { policyId: string }): Promise<void> {
      if (!attached) return;
      if (inner) inner.stop();
      const deps = attached;
      const wrappedTransport = {
        send: async (signed: SignedEnvelope): Promise<boolean> => {
          latest = signed;
          return deps.transport.send(signed);
        },
      };
      inner = new SignalCollectorImpl({
        policy_id: opts.policyId,
        deviceKey: deps.deviceKey,
        transport: wrappedTransport,
        offlineQueue: deps.offlineQueue,
        snapshot: deps.snapshot,
        now: deps.now,
        nonce: deps.nonce,
        scheduledIntervalMs: deps.scheduledIntervalMs,
      });
      inner.start();
    },
    async stop(): Promise<void> {
      if (inner) inner.stop();
      inner = null;
    },
    getLatest(): SignedEnvelope | null {
      return latest;
    },
    attach(deps: Omit<CollectorOptions, 'policy_id'>): void {
      attached = deps;
    },
  };
}
