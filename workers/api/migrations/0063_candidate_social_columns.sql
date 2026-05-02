-- Migration 0063: Add github_handle and linkedin_url to candidates table
-- For self-service demo intake and anonymous URL generation

ALTER TABLE candidates ADD COLUMN github_handle TEXT;
ALTER TABLE candidates ADD COLUMN linkedin_url TEXT;
