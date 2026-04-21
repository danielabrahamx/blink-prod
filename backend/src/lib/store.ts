import type { Device, Policy } from '../types/index.js';

/**
 * Persistence interface. The Postgres implementation lives in Agent B's
 * `feat/db-schema` worktree; until that lands we ship an in-memory store
 * so the HTTP surface is fully runnable + testable.
 */

export interface Store {
  devices: {
    register(device: Omit<Device, 'device_id' | 'registered_at'>): Promise<Device>;
    byId(device_id: string): Promise<Device | null>;
    byWallet(wallet_addr: string): Promise<Device[]>;
  };
  policies: {
    create(
    input: Omit<Policy, 'policy_id' | 'status' | 'created_at' | 'calibrated_at' | 'terminated_at'>,
    ): Promise<Policy>;
    byId(policy_id: string): Promise<Policy | null>;
    setStatus(
      policy_id: string,
      status: Policy['status'],
    ): Promise<Policy | null>;
    all(): Promise<Policy[]>;
  };
}

function id(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function createMemoryStore(): Store {
  const devices = new Map<string, Device>();
  const policies = new Map<string, Policy>();
  return {
    devices: {
      async register(input) {
        const device: Device = {
          device_id: id('dev'),
          registered_at: new Date().toISOString(),
          ...input,
        };
        devices.set(device.device_id, device);
        return device;
      },
      async byId(device_id) {
        return devices.get(device_id) ?? null;
      },
      async byWallet(wallet_addr) {
        return Array.from(devices.values()).filter(
          (d) => d.wallet_addr.toLowerCase() === wallet_addr.toLowerCase(),
        );
      },
    },
    policies: {
      async create(input) {
        const policy: Policy = {
          policy_id: id('pol'),
          status: 'draft',
          created_at: new Date().toISOString(),
          calibrated_at: null,
          terminated_at: null,
          ...input,
        };
        policies.set(policy.policy_id, policy);
        return policy;
      },
      async byId(policy_id) {
        return policies.get(policy_id) ?? null;
      },
      async setStatus(policy_id, status) {
        const p = policies.get(policy_id);
        if (!p) return null;
        const next: Policy = {
          ...p,
          status,
          calibrated_at: status === 'active' && !p.calibrated_at
            ? new Date().toISOString()
            : p.calibrated_at,
          terminated_at:
            status === 'terminated' || status === 'cancelled_by_user'
              ? new Date().toISOString()
              : p.terminated_at,
        };
        policies.set(policy_id, next);
        return next;
      },
      async all() {
        return Array.from(policies.values());
      },
    },
  };
}
