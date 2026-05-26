-- Migration 0048: Add issue body cache columns to repo_issues
--
-- Supports pre-fetching and caching of full issue bodies for challenge
-- generation. Subtask-1 of issue-body-prefetch (Part 3).
--
-- Design decisions:
--   - All columns nullable: existing rows remain valid until backfilled
--   - body_cache_json stores the full pre-fetched body (raw markdown)
--   - body_cached_at is epoch seconds for fast TTL comparisons
--   - body_cache_ttl_days defaults to 7 days (weekly refresh alignment)

ALTER TABLE repo_issues
ADD COLUMN body_cache_json    TEXT;

ALTER TABLE repo_issues
ADD COLUMN body_cached_at     INTEGER;

ALTER TABLE repo_issues
ADD COLUMN body_cache_ttl_days INTEGER DEFAULT 7;
