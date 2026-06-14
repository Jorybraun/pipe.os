-- Persisted, open-ended concept resolution with source-backed observations.
-- Semantic keys and relationship dimensions are data, not schema enums.

PRAGMA foreign_keys = ON;

ALTER TABLE concepts ADD COLUMN resolver_version TEXT;
ALTER TABLE concepts ADD COLUMN model_version TEXT;
ALTER TABLE concepts ADD COLUMN confidence REAL
  CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1);
ALTER TABLE concepts ADD COLUMN first_observed_at INTEGER;
ALTER TABLE concepts ADD COLUMN last_observed_at INTEGER;
ALTER TABLE concepts ADD COLUMN observation_count INTEGER NOT NULL DEFAULT 0
  CHECK(observation_count >= 0);
ALTER TABLE concepts ADD COLUMN superseded_at INTEGER;
ALTER TABLE concepts ADD COLUMN superseded_by_id TEXT REFERENCES concepts(id);

CREATE INDEX IF NOT EXISTS idx_concepts_current
  ON concepts(canonical_key)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS concept_surfaces (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  normalized_surface TEXT NOT NULL,
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE SET NULL,
  artifact_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
  evidence_entity_type TEXT,
  evidence_entity_id TEXT,
  evidence_locator TEXT,
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_concept_surfaces_concept
  ON concept_surfaces(concept_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_concept_surfaces_normalized
  ON concept_surfaces(normalized_surface, observed_at DESC);

CREATE TABLE IF NOT EXISTS concept_resolutions (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  resolver_version TEXT NOT NULL,
  model_version TEXT,
  resolved_canonical_key TEXT NOT NULL,
  resolution_confidence REAL
    CHECK(resolution_confidence IS NULL OR resolution_confidence BETWEEN 0 AND 1),
  resolution_metadata_json TEXT NOT NULL DEFAULT '{}',
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE SET NULL,
  artifact_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
  evidence_entity_type TEXT,
  evidence_entity_id TEXT,
  evidence_locator TEXT,
  resolved_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_concept_resolutions_concept
  ON concept_resolutions(concept_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_concept_resolutions_version
  ON concept_resolutions(resolver_version, resolved_at DESC);

CREATE TABLE IF NOT EXISTS concept_adjacency (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  from_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  to_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  stretch_allowed INTEGER NOT NULL DEFAULT 1 CHECK(stretch_allowed IN (0, 1)),
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE SET NULL,
  artifact_version_id TEXT REFERENCES artifact_versions(id) ON DELETE SET NULL,
  evidence_entity_type TEXT,
  evidence_entity_id TEXT,
  evidence_locator TEXT,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_concept_adjacency_from
  ON concept_adjacency(from_concept_id, dimension);
CREATE INDEX IF NOT EXISTS idx_concept_adjacency_to
  ON concept_adjacency(to_concept_id, dimension);

CREATE TRIGGER IF NOT EXISTS concept_surfaces_increment_observation
AFTER INSERT ON concept_surfaces
BEGIN
  UPDATE concepts
     SET observation_count = observation_count + 1,
         first_observed_at = CASE
           WHEN first_observed_at IS NULL OR NEW.observed_at < first_observed_at
             THEN NEW.observed_at
           ELSE first_observed_at
         END,
         last_observed_at = CASE
           WHEN last_observed_at IS NULL OR NEW.observed_at > last_observed_at
             THEN NEW.observed_at
           ELSE last_observed_at
         END,
         updated_at = datetime('now')
   WHERE id = NEW.concept_id;
END;
