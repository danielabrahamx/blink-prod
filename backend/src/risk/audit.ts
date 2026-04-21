/**
 * Audit-log writer for scored multipliers.
 *
 * Persists a row in `audit_score` linking the raw signal envelope, the
 * extracted features, and the model output. Required for replay + actuarial
 * calibration.
 *
 * Row schema (aligned with Agent B's pg migration):
 *   audit_score(id, policy_id, signal_envelope_id, feature_version,
 *               features_json, model_version, multiplier, explanation_json,
 *               computed_at)
 *
 * The module exposes two ways to persist:
 *   - writeAudit(db, ...) wraps a pg Pool / Client.
 *   - InMemoryAuditRepo for unit tests and Wave 2 integration before the pg
 *     schema lands.
 */

import type { FeatureVector, ScoredMultiplier } from "./types";
import { FEATURE_VERSION } from "./feature-vector";

export interface AuditScoreRow {
  id: string;
  policy_id: string;
  signal_envelope_id: string;
  feature_version: string;
  features_json: FeatureVector;
  model_version: string;
  multiplier: number;
  explanation_json: ScoredMultiplier["explanation"];
  computed_at: string;
}

/**
 * Minimal pg adapter contract. Matches `pg`'s Pool.query and Client.query
 * signatures so writeAudit works with either. Typed manually so this module
 * doesn't depend on @types/pg at compile time for downstream consumers.
 */
export interface PgLikeClient {
  query(text: string, values: readonly unknown[]): Promise<{
    rows: Array<{ id: string; computed_at: string }>;
    rowCount: number | null;
  }>;
}

export interface AuditRepo {
  write(row: AuditScoreRow): Promise<void>;
  listForPolicy(policy_id: string, from: string, to: string): Promise<AuditScoreRow[]>;
}

export class InMemoryAuditRepo implements AuditRepo {
  private rows: AuditScoreRow[] = [];

  async write(row: AuditScoreRow): Promise<void> {
    this.rows.push(row);
  }

  /**
   * Return rows with computed_at inside the half-open interval [from, to).
   * Half-open matches typical SQL BETWEEN semantics at the upper bound.
   */
  async listForPolicy(
    policy_id: string,
    from: string,
    to: string,
  ): Promise<AuditScoreRow[]> {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    return this.rows
      .filter((r) => r.policy_id === policy_id)
      .filter((r) => {
        const ts = Date.parse(r.computed_at);
        return ts >= fromMs && ts < toMs;
      })
      .sort((a, b) => Date.parse(a.computed_at) - Date.parse(b.computed_at));
  }

  snapshot(): AuditScoreRow[] {
    return [...this.rows];
  }

  reset(): void {
    this.rows = [];
  }
}

const INSERT_SQL = `
  INSERT INTO audit_score
    (id, policy_id, signal_envelope_id, feature_version,
     features_json, model_version, multiplier, explanation_json, computed_at)
  VALUES
    ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9)
  RETURNING id, computed_at
`;

function newAuditId(): string {
  // Small uuid-ish without importing deps. Agent B swaps to uuid-v7.
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Write a scored multiplier + its feature vector to `audit_score`. Returns
 * the persisted row.
 *
 * Handoff signature is `writeAudit(db, policyId, envelopeId, featureId,
 * scored)`. We extend with `features` because the row schema requires the
 * materialised FV and the scoring pipeline has it in-memory anyway.
 * `featureId` carries the extractor version (not the FV itself).
 */
export async function writeAudit(
  db: PgLikeClient,
  policyId: string,
  envelopeId: string,
  featureId: string,
  features: FeatureVector,
  scored: ScoredMultiplier,
  opts: { now?: () => Date } = {},
): Promise<AuditScoreRow> {
  const id = newAuditId();
  const now = (opts.now ?? (() => new Date()))().toISOString();

  const row: AuditScoreRow = {
    id,
    policy_id: policyId,
    signal_envelope_id: envelopeId,
    feature_version: featureId || FEATURE_VERSION,
    features_json: features,
    model_version: scored.model_version,
    multiplier: scored.multiplier,
    explanation_json: scored.explanation,
    computed_at: now,
  };

  await db.query(INSERT_SQL, [
    row.id,
    row.policy_id,
    row.signal_envelope_id,
    row.feature_version,
    JSON.stringify(row.features_json),
    row.model_version,
    row.multiplier,
    JSON.stringify(row.explanation_json),
    row.computed_at,
  ]);

  return row;
}

/**
 * Richer writer that also persists the full FeatureVector. Preferred path:
 * the risk-engine pipeline has the FV in-memory at score time and there's no
 * reason to force callers through a downstream join.
 */
export async function writeAuditScore(
  repo: AuditRepo,
  params: {
    policy_id: string;
    signal_envelope_id: string;
    features: FeatureVector;
    scored: ScoredMultiplier;
    feature_version?: string;
    computed_at?: string;
  },
): Promise<AuditScoreRow> {
  const row: AuditScoreRow = {
    id: newAuditId(),
    policy_id: params.policy_id,
    signal_envelope_id: params.signal_envelope_id,
    feature_version: params.feature_version ?? FEATURE_VERSION,
    features_json: params.features,
    model_version: params.scored.model_version,
    multiplier: params.scored.multiplier,
    explanation_json: params.scored.explanation,
    computed_at: params.computed_at ?? new Date().toISOString(),
  };
  await repo.write(row);
  return row;
}
