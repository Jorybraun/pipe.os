-- Migration 0079: expand candidate_nodes node_type CHECK to allow contextual conversation-graph
-- types (ADR-050): Action, Tech, Org, Person, Reason, Outcome, Situation.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt in place.

PRAGMA foreign_keys = OFF;

CREATE TABLE candidate_nodes_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN (
    'Experience', 'Project', 'Accomplishment', 'Skill', 'Education', 'Credential',
    'CulturalSignal', 'TechnicalDemonstration', 'WorkingStyle', 'CommunicationStyle',
    'CareerArc', 'Motivation', 'Context',
    'Action', 'Tech', 'Org', 'Person', 'Reason', 'Outcome', 'Situation'
  )),
  narrative_text TEXT NOT NULL,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  captured_at INTEGER NOT NULL,
  confidence REAL CHECK(confidence BETWEEN 0 AND 1),
  supersedes TEXT REFERENCES candidate_nodes(id),
  superseded_at INTEGER,
  decomposition_version TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO candidate_nodes_new SELECT * FROM candidate_nodes;

DROP TABLE candidate_nodes;
ALTER TABLE candidate_nodes_new RENAME TO candidate_nodes;

CREATE INDEX IF NOT EXISTS idx_candidate_nodes_candidate ON candidate_nodes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_type ON candidate_nodes(candidate_id, node_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_active ON candidate_nodes(candidate_id, superseded_at) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_source ON candidate_nodes(candidate_id, source_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_captured ON candidate_nodes(candidate_id, captured_at);

PRAGMA foreign_keys = ON;
