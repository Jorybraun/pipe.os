-- Replace the fixed five-bucket candidate coverage taxonomy with an open,
-- concept-backed projection over the living context graph.

PRAGMA foreign_keys = OFF;

CREATE TABLE candidate_coverage_open (
  candidate_id TEXT PRIMARY KEY,
  overall_coverage REAL NOT NULL DEFAULT 0.0 CHECK(overall_coverage BETWEEN 0 AND 1),
  dimension_count INTEGER NOT NULL DEFAULT 0 CHECK(dimension_count >= 0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK(evidence_count >= 0),
  source_diversity INTEGER NOT NULL DEFAULT 0 CHECK(source_diversity >= 0),
  interaction_count INTEGER NOT NULL DEFAULT 0 CHECK(interaction_count >= 0),
  first_observed_at TEXT,
  last_observed_at TEXT,
  last_probed_at INTEGER,
  next_probe_concept_id TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  policy_version TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (candidate_id) REFERENCES candidate_ingestion(candidate_id) ON DELETE CASCADE
);

INSERT INTO candidate_coverage_open (
  candidate_id,
  overall_coverage,
  last_probed_at,
  policy_version,
  updated_at
)
SELECT
  candidate_id,
  (
    experience_coverage
    + cultural_coverage
    + technical_coverage
    + motivation_coverage
    + context_coverage
  ) / 5.0,
  last_probed_at,
  'legacy-five-bucket-import',
  updated_at
FROM candidate_coverage;

DROP TABLE candidate_coverage;
ALTER TABLE candidate_coverage_open RENAME TO candidate_coverage;

CREATE INDEX idx_candidate_coverage_probe
  ON candidate_coverage(next_probe_concept_id);

CREATE TABLE candidate_coverage_dimensions (
  candidate_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  label TEXT NOT NULL,
  score REAL NOT NULL CHECK(score BETWEEN 0 AND 1),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK(evidence_count >= 0),
  assertion_count INTEGER NOT NULL DEFAULT 0 CHECK(assertion_count >= 0),
  source_diversity INTEGER NOT NULL DEFAULT 0 CHECK(source_diversity >= 0),
  interaction_count INTEGER NOT NULL DEFAULT 0 CHECK(interaction_count >= 0),
  first_observed_at TEXT,
  last_observed_at TEXT,
  policy_version TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(candidate_id, concept_id),
  FOREIGN KEY (candidate_id) REFERENCES candidate_ingestion(candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE
);

CREATE INDEX idx_candidate_coverage_dimensions_score
  ON candidate_coverage_dimensions(candidate_id, score, canonical_key);
CREATE INDEX idx_candidate_coverage_dimensions_concept
  ON candidate_coverage_dimensions(concept_id, candidate_id);
CREATE INDEX idx_candidate_coverage_dimensions_recency
  ON candidate_coverage_dimensions(candidate_id, last_observed_at);

PRAGMA foreign_keys = ON;
