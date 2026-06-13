-- Source-exact transcript ingestion and rebuildable semantic projections.
-- Transcript artifacts and spans remain immutable. Meaning derived from them
-- can be replaced when a corrected transcript or extractor version arrives.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artifact_interactions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(artifact_id, interaction_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_artifact_interactions_interaction
  ON artifact_interactions(interaction_id, artifact_id);

-- Speaker attribution is provenance, not inferred semantic meaning. A missing
-- row means the source does not establish who spoke the span.
CREATE TABLE IF NOT EXISTS source_span_attributions (
  source_span_id TEXT NOT NULL REFERENCES source_spans(id) ON DELETE RESTRICT,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  attribution_source TEXT NOT NULL,
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_span_id, workspace_person_id, attribution_source)
);

CREATE INDEX IF NOT EXISTS idx_source_span_attributions_person
  ON source_span_attributions(workspace_person_id, source_span_id);

CREATE TABLE IF NOT EXISTS semantic_projection_runs (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  projection_type TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_projection_runs_artifact
  ON semantic_projection_runs(artifact_id, projection_type, created_at);

CREATE TABLE IF NOT EXISTS semantic_projection_entities (
  run_id TEXT NOT NULL REFERENCES semantic_projection_runs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_semantic_projection_entities_entity
  ON semantic_projection_entities(entity_type, entity_id);
