-- Migration 0051: repo_sample_prs narrative enrichment
-- Adds Gemma-generated PR narrative and BGE embedding for semantic per-candidate PR selection.
ALTER TABLE repo_sample_prs ADD COLUMN pr_narrative TEXT;
ALTER TABLE repo_sample_prs ADD COLUMN pr_narrative_embedding_json TEXT;
ALTER TABLE repo_sample_prs ADD COLUMN pr_narrative_version TEXT;
