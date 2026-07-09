-- 0116: Add CUSTOM_CONTAINER challenge and interview type
--
-- Introduces a pluggable custom container challenge type. The container runtime
-- (DevContainerDO) is reused, but the challenge spec, verification command, and
-- scoring come from a `challenges` row instead of a matched source-backed repo.
--
-- SQLite does not support ALTER TABLE DROP CONSTRAINT, so we rename the existing
-- constrained column, add a new column with the updated CHECK, copy the data
-- back, then drop the old column. This preserves the table and all foreign-key
-- relationships (e.g. dev_container_sessions, challenge_submissions) without
-- requiring a full table rebuild.
--
-- The `interview_type` column is indexed by `idx_scheduled_interviews_type`, so
-- that index is dropped before removing the old column and recreated afterwards.

-- ── 1. challenges.type: add CUSTOM_CONTAINER to the CHECK constraint
--    The original column has NOT NULL and CHECK(...), so we must temporarily
--    supply a default while we recreate the column.

ALTER TABLE challenges RENAME COLUMN type TO type_old;

ALTER TABLE challenges ADD COLUMN type TEXT NOT NULL
  CHECK (type IN (
    'CODE_REVIEW', 'CODE_IMPLEMENTATION', 'CUSTOM_CONTAINER',
    'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP',
    'INTAKE', 'AGENT_INTERVIEW'
  ))
  DEFAULT 'CODE_REVIEW';

UPDATE challenges SET type = type_old;

ALTER TABLE challenges DROP COLUMN type_old;

-- ── 2. scheduled_interviews: add CUSTOM_CONTAINER to interview_type CHECK
--    and a nullable challenge_id column so the custom container spec can be
--    linked directly to the interview.

ALTER TABLE scheduled_interviews ADD COLUMN challenge_id TEXT;

ALTER TABLE scheduled_interviews RENAME COLUMN interview_type TO interview_type_old;

ALTER TABLE scheduled_interviews ADD COLUMN interview_type TEXT DEFAULT 'VIDEO'
  CHECK (interview_type IN (
    'VIDEO', 'TECHNICAL', 'SCREENING', 'CODE_REVIEW',
    'DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX', 'CUSTOM_CONTAINER'
  ));

UPDATE scheduled_interviews SET interview_type = interview_type_old;

DROP INDEX IF EXISTS idx_scheduled_interviews_type;

ALTER TABLE scheduled_interviews DROP COLUMN interview_type_old;

CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_type ON scheduled_interviews(owner_id, interview_type);
