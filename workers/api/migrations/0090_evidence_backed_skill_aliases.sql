-- Remove the legacy seeded alias taxonomy and require provenance for future
-- learned aliases. Fresh databases create an empty table in migration 0021;
-- existing databases discard only rows that predate evidence metadata.

ALTER TABLE skill_aliases ADD COLUMN evidence_entity_type TEXT;
ALTER TABLE skill_aliases ADD COLUMN evidence_entity_id TEXT;
ALTER TABLE skill_aliases ADD COLUMN evidence_locator TEXT;
ALTER TABLE skill_aliases ADD COLUMN confidence REAL CHECK(confidence BETWEEN 0 AND 1);
ALTER TABLE skill_aliases ADD COLUMN resolver_version TEXT;
ALTER TABLE skill_aliases ADD COLUMN created_at INTEGER;

DELETE FROM skill_aliases
WHERE evidence_entity_type IS NULL
   OR evidence_entity_id IS NULL
   OR evidence_locator IS NULL
   OR resolver_version IS NULL;
