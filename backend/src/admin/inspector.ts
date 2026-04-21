import type {
  AccrualEntry,
  Policy,
  ScoredMultiplier,
  SignalEnvelope,
} from '../types/index.js';

/**
 * The per-policy inspector bundles everything the admin UI needs in one
 * round-trip. Data providers (Postgres tables owned by Agent B) are
 * injected so the admin layer stays storage-agnostic here.
 */

export interface InspectorProviders {
  loadPolicy(policy_id: string): Promise<Policy | null>;
  loadEnvelopes(
    policy_id: string,
    sinceIso?: string,
  ): Promise<SignalEnvelope[]>;
  loadScores(
    policy_id: string,
    sinceIso?: string,
  ): Promise<ScoredMultiplier[]>;
  loadAccrual(
    policy_id: string,
    sinceIso?: string,
  ): Promise<AccrualEntry[]>;
  loadFsmLog(
    policy_id: string,
  ): Promise<Array<{ from: string; to: string; ts: string }>>;
}

export interface InspectorPayload {
  policy: Policy;
  envelopes: SignalEnvelope[];
  scores: ScoredMultiplier[];
  accrual: AccrualEntry[];
  fsm_log: Array<{ from: string; to: string; ts: string }>;
  current_multiplier: number | null;
}

export async function loadInspector(
  providers: InspectorProviders,
  policy_id: string,
  sinceIso?: string,
): Promise<InspectorPayload | null> {
  const policy = await providers.loadPolicy(policy_id);
  if (!policy) return null;
  const [envelopes, scores, accrual, fsm_log] = await Promise.all([
    providers.loadEnvelopes(policy_id, sinceIso),
    providers.loadScores(policy_id, sinceIso),
    providers.loadAccrual(policy_id, sinceIso),
    providers.loadFsmLog(policy_id),
  ]);
  const current_multiplier =
    scores.length > 0 ? scores[scores.length - 1].multiplier : null;
  return { policy, envelopes, scores, accrual, fsm_log, current_multiplier };
}
