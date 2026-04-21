import type { AccrualEntry, ScoredMultiplier } from '../types/index.js';
import { NotImplementedError } from '../lib/errors.js';

/**
 * Accrual loop + ledger. Body is deferred to Agent F
 * (feat/settlement-x402) — this file defines the interface that
 * /signals, /policies/cancel, and /admin use.
 */

export interface AccrualLedger {
  record(entry: AccrualEntry): Promise<void>;
  totalForPolicy(policy_id: string): Promise<number>;
  sincePolicyCreate(
    policy_id: string,
    sinceIso?: string,
  ): Promise<AccrualEntry[]>;
}

export interface AccrualTick {
  policy_id: string;
  base_rate_usdc: number;
  duration_seconds: number;
  scored: ScoredMultiplier;
}

export interface AccrualEngine {
  tick(t: AccrualTick): Promise<AccrualEntry>;
  finalize(policy_id: string): Promise<number>;
}

class NotImplementedLedger implements AccrualLedger {
  async record(_entry: AccrualEntry): Promise<void> {
    throw new NotImplementedError('accrual ledger not implemented (Agent F)');
  }
  async totalForPolicy(_policy_id: string): Promise<number> {
    throw new NotImplementedError('accrual ledger not implemented (Agent F)');
  }
  async sincePolicyCreate(
    _policy_id: string,
    _sinceIso?: string,
  ): Promise<AccrualEntry[]> {
    throw new NotImplementedError('accrual ledger not implemented (Agent F)');
  }
}

class NotImplementedEngine implements AccrualEngine {
  async tick(_t: AccrualTick): Promise<AccrualEntry> {
    throw new NotImplementedError('accrual engine not implemented (Agent F)');
  }
  async finalize(_policy_id: string): Promise<number> {
    throw new NotImplementedError('accrual engine not implemented (Agent F)');
  }
}

let ledger: AccrualLedger = new NotImplementedLedger();
let engine: AccrualEngine = new NotImplementedEngine();

export function setAccrualLedger(next: AccrualLedger): void {
  ledger = next;
}
export function getAccrualLedger(): AccrualLedger {
  return ledger;
}
export function setAccrualEngine(next: AccrualEngine): void {
  engine = next;
}
export function getAccrualEngine(): AccrualEngine {
  return engine;
}

export function computeAccruedUsdc(t: AccrualTick): number {
  return t.base_rate_usdc * t.duration_seconds * t.scored.multiplier;
}
