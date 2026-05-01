-- Migration 0060: Add GitHub contribution calendar to candidate_ingestion
-- Stores the raw contribution calendar JSON so the frontend can render it
-- without re-querying GitHub or parsing candidate_nodes.

ALTER TABLE candidate_ingestion ADD COLUMN github_calendar_json TEXT;
