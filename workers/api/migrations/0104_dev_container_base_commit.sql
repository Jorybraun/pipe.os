-- 0104_dev_container_base_commit.sql
-- Preserve the exact source-backed base commit used to launch assessment workspaces.

ALTER TABLE dev_container_sessions ADD COLUMN base_commit_sha TEXT;
