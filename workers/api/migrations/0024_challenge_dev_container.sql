-- Migration 0024: Dev-container wire-up for CODE_IMPLEMENTATION challenges (ADR-037).
--
-- Opt-in flag: a CODE_IMPLEMENTATION challenge becomes "dev-container backed"
-- when dev_container_repo_url is non-null. The launch route forwards this
-- (+ optional branch) to the DevContainerDO as env vars, and the container
-- entrypoint git-clones the repo into /workspace before starting code-server.
-- Existing challenges with the column NULL continue to use the in-browser
-- Monaco editor path — no content migration needed.
--
-- The repo URL is also snapshotted onto the session row so recruiters can
-- audit exactly what each candidate launched (challenges can be edited after
-- a session runs; the session row is the historical record).

ALTER TABLE challenges ADD COLUMN dev_container_repo_url TEXT;
ALTER TABLE challenges ADD COLUMN dev_container_challenge_branch TEXT;

ALTER TABLE dev_container_sessions ADD COLUMN repo_git_url TEXT;
