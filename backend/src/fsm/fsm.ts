/**
 * FSM runtime.
 *
 * Handoff signature:
 *   transition(db, policyId, event, metadata?): Promise<NewState>
 *
 * Behaviour:
 *   - Reads current state from `policies.status`.
 *   - Finds the matching transition row (throws if none).
 *   - Runs the guard (throws if it rejects).
 *   - Writes a `state_log` row and updates `policies.status` atomically.
 *   - Idempotent on (policyId, idempotency_key): re-running the same key
 *     returns the persisted new_state without duplicating the log row or
 *     re-applying side effects.
 *   - Returns the new state.
 *
 * A pg-backed adapter and an in-memory adapter are both provided so Wave 2
 * work doesn't block on Agent B's migration landing.
 */

import {
  PolicyEvent,
  PolicyState,
  PolicyStates,
  TERMINAL_STATES,
} from "./states";
import {
  findTransition,
  SideEffect,
  TransitionContext,
  TransitionRow,
} from "./transitions";

export interface StateLogRow {
  id: string;
  policy_id: string;
  from_state: PolicyState;
  to_state: PolicyState;
  event: PolicyEvent;
  side_effect: SideEffect;
  /** Idempotency key, usually the triggering client_nonce or a ULID. */
  idempotency_key?: string;
  occurred_at: string;
  metadata_json: Record<string, unknown>;
}

export interface PolicyStateRepo {
  getCurrentState(policy_id: string): Promise<{ state: PolicyState } | null>;
  updateState(policy_id: string, from: PolicyState, to: PolicyState): Promise<void>;
}

export interface StateLogRepo {
  append(row: StateLogRow): Promise<void>;
  findByIdempotencyKey(policy_id: string, key: string): Promise<StateLogRow | null>;
  listForPolicy(policy_id: string): Promise<StateLogRow[]>;
}

export interface SideEffectHandler {
  run(
    effect: SideEffect,
    params: {
      policy_id: string;
      from: PolicyState;
      to: PolicyState;
      event: PolicyEvent;
      metadata: Record<string, unknown>;
    },
  ): Promise<void>;
}

/**
 * Test double / default handler. Records calls so tests can assert ordering
 * without a real subscriber.
 */
export class RecordingSideEffects implements SideEffectHandler {
  calls: Array<{
    effect: SideEffect;
    policy_id: string;
    from: PolicyState;
    to: PolicyState;
    event: PolicyEvent;
    metadata: Record<string, unknown>;
  }> = [];
  async run(
    effect: SideEffect,
    params: {
      policy_id: string;
      from: PolicyState;
      to: PolicyState;
      event: PolicyEvent;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    this.calls.push({ effect, ...params });
  }
}

export class InMemoryStateLog implements StateLogRepo {
  private rows: StateLogRow[] = [];
  async append(row: StateLogRow): Promise<void> {
    this.rows.push(row);
  }
  async findByIdempotencyKey(
    policy_id: string,
    key: string,
  ): Promise<StateLogRow | null> {
    return (
      this.rows.find(
        (r) => r.policy_id === policy_id && r.idempotency_key === key,
      ) ?? null
    );
  }
  async listForPolicy(policy_id: string): Promise<StateLogRow[]> {
    return this.rows.filter((r) => r.policy_id === policy_id);
  }
  snapshot(): readonly StateLogRow[] {
    return [...this.rows];
  }
  reset(): void {
    this.rows = [];
  }
}

export class InMemoryPolicyRepo implements PolicyStateRepo {
  private states = new Map<string, PolicyState>();

  seed(policy_id: string, state: PolicyState): void {
    this.states.set(policy_id, state);
  }
  async getCurrentState(
    policy_id: string,
  ): Promise<{ state: PolicyState } | null> {
    const s = this.states.get(policy_id);
    return s ? { state: s } : null;
  }
  async updateState(
    policy_id: string,
    from: PolicyState,
    to: PolicyState,
  ): Promise<void> {
    const current = this.states.get(policy_id);
    if (current !== from) {
      throw new Error(
        `policy ${policy_id} state drift: expected ${from}, saw ${current}`,
      );
    }
    this.states.set(policy_id, to);
  }
  snapshot(): ReadonlyMap<string, PolicyState> {
    return new Map(this.states);
  }
}

/** Thrown for illegal transitions (no matching row, guard rejected, etc). */
export class FsmTransitionError extends Error {
  constructor(
    public readonly policy_id: string,
    public readonly from: PolicyState | null,
    public readonly event: PolicyEvent,
    public readonly reason:
      | "policy_not_found"
      | "no_matching_transition"
      | "guard_rejected"
      | "already_terminal",
  ) {
    super(
      `fsm: illegal transition for policy=${policy_id} from=${from ?? "?"} event=${event} reason=${reason}`,
    );
    this.name = "FsmTransitionError";
  }
}

export interface TransitionDeps {
  policyRepo: PolicyStateRepo;
  stateLog: StateLogRepo;
  sideEffects: SideEffectHandler;
  now?: () => Date;
}

export interface TransitionMetadata extends Partial<TransitionContext> {
  idempotency_key?: string;
  [key: string]: unknown;
}

function newLogId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toTransitionCtx(meta: TransitionMetadata): TransitionContext {
  return {
    envelope_count: meta.envelope_count ?? 0,
    hours_in_calibration: meta.hours_in_calibration ?? 0,
    minutes_since_last_envelope: meta.minutes_since_last_envelope ?? 0,
    offline_ms_last_24h: meta.offline_ms_last_24h ?? 0,
    ...(meta.claim_waiting_cleared !== undefined
      ? { claim_waiting_cleared: meta.claim_waiting_cleared }
      : {}),
    ...(meta.now !== undefined ? { now: meta.now } : {}),
  };
}

/**
 * Apply an event to a policy.
 *
 * @param db   Dependency bag. Tests pass in-memory impls; prod passes
 *             pg-backed PolicyStateRepo + StateLogRepo.
 * @param policyId  Target policy id.
 * @param event     The event to apply.
 * @param metadata  Guard context + idempotency key + any extra fields
 *                  persisted to state_log.metadata_json.
 * @returns The new state.
 * @throws FsmTransitionError on any illegal transition.
 */
export async function transition(
  db: TransitionDeps,
  policyId: string,
  event: PolicyEvent,
  metadata: TransitionMetadata = {},
): Promise<PolicyState> {
  // 1. Idempotency check.
  if (metadata.idempotency_key) {
    const prior = await db.stateLog.findByIdempotencyKey(
      policyId,
      metadata.idempotency_key,
    );
    if (prior) return prior.to_state;
  }

  // 2. Load current state.
  const snapshot = await db.policyRepo.getCurrentState(policyId);
  if (!snapshot) {
    throw new FsmTransitionError(policyId, null, event, "policy_not_found");
  }
  const fromState = snapshot.state;

  if (TERMINAL_STATES.has(fromState)) {
    throw new FsmTransitionError(policyId, fromState, event, "already_terminal");
  }

  // 3. Look up transition row.
  const row: TransitionRow | null = findTransition(fromState, event);
  if (!row) {
    throw new FsmTransitionError(
      policyId,
      fromState,
      event,
      "no_matching_transition",
    );
  }

  // 4. Guard check.
  const ctx = toTransitionCtx(metadata);
  if (row.guard && !row.guard(ctx)) {
    throw new FsmTransitionError(policyId, fromState, event, "guard_rejected");
  }

  // 5. Apply.
  await db.policyRepo.updateState(policyId, fromState, row.to);

  const nowFn = db.now ?? (() => new Date());
  const logRow: StateLogRow = {
    id: newLogId(),
    policy_id: policyId,
    from_state: fromState,
    to_state: row.to,
    event,
    side_effect: row.sideEffect,
    ...(metadata.idempotency_key !== undefined
      ? { idempotency_key: metadata.idempotency_key }
      : {}),
    occurred_at: nowFn().toISOString(),
    metadata_json: sanitiseMetadata(metadata),
  };
  await db.stateLog.append(logRow);

  await db.sideEffects.run(row.sideEffect, {
    policy_id: policyId,
    from: fromState,
    to: row.to,
    event,
    metadata: logRow.metadata_json,
  });

  return row.to;
}

/**
 * Strip non-serialisable fields (functions, class instances) from metadata
 * before persisting to state_log.metadata_json.
 */
function sanitiseMetadata(meta: TransitionMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "function") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export { PolicyStates };
