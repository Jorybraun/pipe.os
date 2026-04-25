-- 0035_repos_readme_tree.sql
-- Give Pass 3 Gemma actual semantic signal from the repo: README excerpt +
-- a shallow root-file tree. Without these, Gemma only sees aggregate counts
-- and dep lists and produces generic narratives that don't know what the
-- repo *does*.
--
-- readme_excerpt — up to ~3KB of README.md (or README.rst/README) text.
-- root_tree_json  — JSON array of top-level file/dir names (max 60 entries).

ALTER TABLE qualified_repos ADD COLUMN readme_excerpt TEXT;
ALTER TABLE qualified_repos ADD COLUMN root_tree_json TEXT;
