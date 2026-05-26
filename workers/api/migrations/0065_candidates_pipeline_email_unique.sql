-- Migration 0065: Enforce unique email per pipeline
-- Prevents duplicate candidate emails within the same pipeline.

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_pipeline_email ON candidates(pipeline_id, email);
