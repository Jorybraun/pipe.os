-- D1-backed rollout gate configuration for staged feature rollout.
-- Acceptance criterion #8: controlled staged rollout without redeployment.
-- Replaces hardcoded stages in rollout.ts with data-driven configuration.

CREATE TABLE IF NOT EXISTS rollout_gates (
  gate_key          TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  stage             TEXT NOT NULL DEFAULT 'disabled'
                    CHECK (stage IN ('disabled', 'internal_only', 'canary', 'general_availability')),
  prerequisites     TEXT NOT NULL DEFAULT '[]',  -- JSON array of gate_key strings
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by        TEXT
);

-- Seed default gate configuration matching the current hardcoded values
INSERT OR IGNORE INTO rollout_gates (gate_key, label, description, stage, prerequisites) VALUES
  ('living_context_ingestion', 'Living Context Ingestion', 'Ingest meetings, resumes, code reviews, and phone calls into the person graph.', 'general_availability', '[]'),
  ('living_context_read_model', 'Living Context Read Model', 'Load and serve the full living context graph via recruiter API.', 'general_availability', '["living_context_ingestion"]'),
  ('contact_living_context', 'Contact Living Context', 'Serve living context for contacts (pre-candidate people).', 'canary', '["living_context_read_model"]'),
  ('deterministic_matching', 'Deterministic PR Matching', 'Match candidates to specific reviewable PRs via the deterministic challenge matcher.', 'general_availability', '["living_context_ingestion"]'),
  ('match_explanation', 'Match Explanation', 'Show structured evidence gaps, stretch areas, and source provenance in match explanations.', 'canary', '["deterministic_matching"]'),
  ('repo_graph_backfill', 'Repo Graph Backfill', 'Idempotent backfill of repository semantic graphs from D1 source data.', 'general_availability', '[]'),
  ('neo4j_projection_rebuild', 'Neo4j Projection Rebuild', 'Rebuild Neo4j projections from D1 source-of-truth via projection outbox.', 'canary', '["living_context_ingestion", "repo_graph_backfill"]'),
  ('repo_overlay_visualization', 'Repo Overlay Visualization', 'Show file-level repo structure with matched spans in recruiter CONTEXT.', 'internal_only', '["deterministic_matching", "repo_graph_backfill"]'),
  ('expert_labelled_evaluation', 'Expert-Labelled Evaluation', 'Run matching evaluation against expert-labelled corpus as a CI quality gate.', 'internal_only', '["deterministic_matching"]');
