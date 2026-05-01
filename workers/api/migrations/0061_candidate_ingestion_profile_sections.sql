-- Migration 0061: Add pre-computed profile sections to candidate_ingestion
-- Stores the serialized render plan so the frontend can render dynamic
-- candidate profiles without computing section order on each request.

ALTER TABLE candidate_ingestion ADD COLUMN profile_sections_json TEXT;
