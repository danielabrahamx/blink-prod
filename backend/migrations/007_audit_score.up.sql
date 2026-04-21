-- 007 audit_score
-- Output of the risk engine: one score per envelope. multiplier is the
-- per-minute premium multiplier (e.g. 0.7 at home, up to 3.0x in very
-- risky contexts) stored with six-decimal precision for actuarial replay.
-- explanation_jsonb captures the rule attribution so the admin UI can
-- surface "why" to the user + carrier auditor.

CREATE TABLE IF NOT EXISTS audit_score (
    score_id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id           TEXT           NOT NULL REFERENCES policies (policy_id) ON DELETE CASCADE,
    envelope_id         UUID           NOT NULL REFERENCES signal_envelopes (envelope_id) ON DELETE CASCADE,
    feature_id          UUID           NOT NULL REFERENCES features (feature_id) ON DELETE CASCADE,
    model_version       TEXT           NOT NULL,
    multiplier          NUMERIC(10,6)  NOT NULL,
    explanation_jsonb   JSONB          NOT NULL,
    computed_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_score_policy_id ON audit_score (policy_id);
CREATE INDEX IF NOT EXISTS idx_audit_score_envelope_id ON audit_score (envelope_id);
CREATE INDEX IF NOT EXISTS idx_audit_score_feature_id ON audit_score (feature_id);
CREATE INDEX IF NOT EXISTS idx_audit_score_policy_computed
    ON audit_score (policy_id, computed_at DESC);
