-- Source-backed semantic context records.
-- Immutable artifacts and source spans remain the root truth. Context records are
-- rebuildable meaning units that preserve N-participant context for graph/search.
-- V1 supports generic scopes for people, roles, repos, and matches. The
-- workspace_person_id column remains for person read models and same-person
-- provenance checks; non-person scopes use scope_type/scope_id plus source refs.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS context_records (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  workspace_person_id TEXT REFERENCES workspace_people(id) ON DELETE CASCADE,
  interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  assertion_id TEXT REFERENCES semantic_assertions(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL,
  predicate TEXT,
  narrative TEXT NOT NULL,
  qualifiers_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  polarity REAL NOT NULL DEFAULT 1 CHECK(polarity BETWEEN -1 AND 1),
  extraction_version TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(scope_type <> 'workspace_person' OR workspace_person_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_context_records_scope
  ON context_records(scope_type, scope_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_context_records_workspace_person
  ON context_records(workspace_person_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_context_records_interaction
  ON context_records(interaction_id);
CREATE INDEX IF NOT EXISTS idx_context_records_assertion
  ON context_records(assertion_id);
CREATE INDEX IF NOT EXISTS idx_context_records_type
  ON context_records(record_type);

CREATE TABLE IF NOT EXISTS context_record_source_spans (
  context_record_id TEXT NOT NULL REFERENCES context_records(id) ON DELETE CASCADE,
  source_span_id TEXT NOT NULL REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  created_at TEXT NOT NULL,
  PRIMARY KEY(context_record_id, source_span_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_context_record_source_spans_span
  ON context_record_source_spans(source_span_id);

CREATE TABLE IF NOT EXISTS context_record_source_refs (
  context_record_id TEXT NOT NULL REFERENCES context_records(id) ON DELETE CASCADE,
  source_ref_type TEXT NOT NULL,
  source_ref_id TEXT NOT NULL,
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  locator_json TEXT NOT NULL DEFAULT '{}',
  exact_text TEXT,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK(source_ref_id <> ''),
  CHECK(source_span_id IS NULL OR source_ref_type = 'source_span'),
  PRIMARY KEY(context_record_id, source_ref_type, source_ref_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_context_record_source_refs_ref
  ON context_record_source_refs(source_ref_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_context_record_source_refs_span
  ON context_record_source_refs(source_span_id);

CREATE TABLE IF NOT EXISTS context_record_entities (
  context_record_id TEXT NOT NULL REFERENCES context_records(id) ON DELETE CASCADE,
  entity_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  relationship TEXT NOT NULL,
  value_json TEXT,
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK(entity_id IS NOT NULL OR value_json IS NOT NULL),
  PRIMARY KEY(context_record_id, entity_key, relationship)
);

CREATE INDEX IF NOT EXISTS idx_context_record_entities_entity
  ON context_record_entities(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS context_record_concepts (
  context_record_id TEXT NOT NULL REFERENCES context_records(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1 CHECK(weight BETWEEN 0 AND 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY(context_record_id, concept_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_context_record_concepts_concept
  ON context_record_concepts(concept_id, weight);
