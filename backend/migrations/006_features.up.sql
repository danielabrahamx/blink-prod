-- 006 features
-- Output of the feature extractor. feature_version pins the rulebook
-- revision (e.g. "fx-2026.04.1"). features_jsonb holds the extracted
-- numeric features ready for the risk engine.

CREATE TABLE IF NOT EXISTS features (
    feature_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    envelope_id      UUID          NOT NULL REFERENCES signal_envelopes (envelope_id) ON DELETE CASCADE,
    feature_version  TEXT          NOT NULL,
    features_jsonb   JSONB         NOT NULL,
    computed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_envelope_id ON features (envelope_id);
CREATE INDEX IF NOT EXISTS idx_features_version ON features (feature_version);
