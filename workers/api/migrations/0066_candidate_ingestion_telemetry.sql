-- Migration 0066: Add telemetry columns to candidate_ingestion for observability

ALTER TABLE candidate_ingestion ADD COLUMN current_step TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN estimated_completion_at TEXT;
