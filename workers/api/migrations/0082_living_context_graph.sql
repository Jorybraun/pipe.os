-- Candidate Living Context Graph foundation.
-- D1 is the source of truth; graph/search stores are rebuildable projections.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  external_ids_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_email ON people(primary_email);

CREATE TABLE IF NOT EXISTS workspace_people (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_summary TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_people_workspace
  ON workspace_people(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_workspace_people_person
  ON workspace_people(person_id);

-- Applications preserve the existing candidate process without making
-- "candidate" a second identity. A person may have many applications.
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  legacy_candidate_id TEXT REFERENCES candidates(id) ON DELETE SET NULL,
  pipeline_id TEXT,
  status TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_legacy_candidate
  ON applications(legacy_candidate_id)
  WHERE legacy_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_workspace_person
  ON applications(workspace_person_id, updated_at);

CREATE TABLE IF NOT EXISTS person_roles (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  role_type TEXT NOT NULL,
  label TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  active_from TEXT,
  active_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_person_roles_workspace_person
  ON person_roles(workspace_person_id, role_type);
CREATE INDEX IF NOT EXISTS idx_person_roles_application
  ON person_roles(application_id);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL,
  external_reference TEXT,
  started_at TEXT,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_workspace_person
  ON interactions(workspace_person_id, started_at);
CREATE INDEX IF NOT EXISTS idx_interactions_application
  ON interactions(application_id, started_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT REFERENCES workspace_people(id) ON DELETE CASCADE,
  interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  logical_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_workspace_person
  ON artifacts(workspace_person_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_interaction
  ON artifacts(interaction_id);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  content_hash TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content_text TEXT,
  storage_key TEXT,
  byte_length INTEGER CHECK(byte_length IS NULL OR byte_length >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK(content_text IS NOT NULL OR storage_key IS NOT NULL),
  UNIQUE(artifact_id, version_number),
  UNIQUE(artifact_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
  ON artifact_versions(artifact_id, version_number);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_hash
  ON artifact_versions(content_hash);

CREATE TRIGGER IF NOT EXISTS artifact_versions_no_update
BEFORE UPDATE ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS artifact_versions_no_delete
BEFORE DELETE ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions are immutable');
END;

CREATE TABLE IF NOT EXISTS source_spans (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
  stable_segment_id TEXT,
  byte_start INTEGER,
  byte_end INTEGER,
  char_start INTEGER,
  char_end INTEGER,
  line_start INTEGER,
  line_end INTEGER,
  timestamp_start_ms INTEGER,
  timestamp_end_ms INTEGER,
  exact_text TEXT NOT NULL,
  exact_text_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK(
    (byte_start IS NULL AND byte_end IS NULL)
    OR (byte_start IS NOT NULL AND byte_end IS NOT NULL AND byte_end >= byte_start)
  ),
  CHECK(
    (char_start IS NULL AND char_end IS NULL)
    OR (char_start IS NOT NULL AND char_end IS NOT NULL AND char_end >= char_start)
  ),
  CHECK(
    (line_start IS NULL AND line_end IS NULL)
    OR (line_start IS NOT NULL AND line_end IS NOT NULL AND line_end >= line_start)
  ),
  CHECK(
    (timestamp_start_ms IS NULL AND timestamp_end_ms IS NULL)
    OR (
      timestamp_start_ms IS NOT NULL
      AND timestamp_end_ms IS NOT NULL
      AND timestamp_end_ms >= timestamp_start_ms
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_source_spans_artifact_version
  ON source_spans(artifact_version_id);
CREATE INDEX IF NOT EXISTS idx_source_spans_segment
  ON source_spans(artifact_version_id, stable_segment_id);

CREATE TRIGGER IF NOT EXISTS source_spans_no_update
BEFORE UPDATE ON source_spans
BEGIN
  SELECT RAISE(ABORT, 'source_spans are immutable');
END;

CREATE TRIGGER IF NOT EXISTS source_spans_no_delete
BEFORE DELETE ON source_spans
BEGIN
  SELECT RAISE(ABORT, 'source_spans are immutable');
END;

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  narrative TEXT,
  started_at TEXT,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_workspace_person
  ON episodes(workspace_person_id, interaction_id);

-- Predicates and object shapes are intentionally free-form. Meaning evolves
-- as source-backed assertion data, not as a whitelist of graph edge types.
CREATE TABLE IF NOT EXISTS semantic_assertions (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  predicate TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  object_value_json TEXT,
  narrative TEXT NOT NULL,
  qualifiers_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  polarity REAL NOT NULL DEFAULT 1 CHECK(polarity BETWEEN -1 AND 1),
  extraction_version TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_assertions_workspace_person
  ON semantic_assertions(workspace_person_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_semantic_assertions_episode
  ON semantic_assertions(episode_id);
CREATE INDEX IF NOT EXISTS idx_semantic_assertions_predicate
  ON semantic_assertions(predicate);

CREATE TABLE IF NOT EXISTS assertion_source_spans (
  assertion_id TEXT NOT NULL REFERENCES semantic_assertions(id) ON DELETE CASCADE,
  source_span_id TEXT NOT NULL REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  created_at TEXT NOT NULL,
  PRIMARY KEY(assertion_id, source_span_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_assertion_source_spans_span
  ON assertion_source_spans(source_span_id);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  canonical_key TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_concepts_namespace
  ON concepts(namespace, label);

CREATE TABLE IF NOT EXISTS assertion_concepts (
  assertion_id TEXT NOT NULL REFERENCES semantic_assertions(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'about',
  weight REAL NOT NULL DEFAULT 1 CHECK(weight BETWEEN 0 AND 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY(assertion_id, concept_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_assertion_concepts_concept
  ON assertion_concepts(concept_id, weight);

CREATE TABLE IF NOT EXISTS signal_evidence (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  assertion_id TEXT NOT NULL REFERENCES semantic_assertions(id) ON DELETE CASCADE,
  concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  signal_key TEXT NOT NULL,
  evidence_level TEXT NOT NULL CHECK(evidence_level IN (
    'mentioned', 'used', 'explained', 'selected',
    'implemented', 'demonstrated', 'validated'
  )),
  strength REAL NOT NULL CHECK(strength BETWEEN 0 AND 1),
  polarity REAL NOT NULL DEFAULT 1 CHECK(polarity BETWEEN -1 AND 1),
  observed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_evidence_signal
  ON signal_evidence(workspace_person_id, signal_key, observed_at);
CREATE INDEX IF NOT EXISTS idx_signal_evidence_assertion
  ON signal_evidence(assertion_id);

CREATE TABLE IF NOT EXISTS signal_snapshots (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  interaction_id TEXT REFERENCES interactions(id) ON DELETE SET NULL,
  as_of TEXT NOT NULL,
  conversation_score REAL CHECK(conversation_score IS NULL OR conversation_score BETWEEN 0 AND 1),
  total_score REAL NOT NULL CHECK(total_score BETWEEN 0 AND 1),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK(evidence_count >= 0),
  source_diversity INTEGER NOT NULL DEFAULT 0 CHECK(source_diversity >= 0),
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_latest
  ON signal_snapshots(workspace_person_id, signal_key, as_of DESC);

CREATE TABLE IF NOT EXISTS semantic_relationships (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  workspace_person_id TEXT NOT NULL REFERENCES workspace_people(id) ON DELETE CASCADE,
  from_entity_type TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  to_entity_type TEXT,
  to_entity_id TEXT,
  to_value_json TEXT,
  qualifiers_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_assertion_id TEXT REFERENCES semantic_assertions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(to_entity_id IS NOT NULL OR to_value_json IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_semantic_relationships_from
  ON semantic_relationships(workspace_person_id, from_entity_type, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_semantic_relationships_to
  ON semantic_relationships(workspace_person_id, to_entity_type, to_entity_id);

CREATE TABLE IF NOT EXISTS projection_outbox (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  projection_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert'
    CHECK(operation IN ('upsert', 'delete', 'rebuild')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projection_outbox_pending
  ON projection_outbox(status, available_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_projection_outbox_aggregate
  ON projection_outbox(aggregate_type, aggregate_id, created_at);
