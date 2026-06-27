-- 0103_assessment_layer_repo_task_compat.sql
--
-- Compatibility projection for repo-task assessment code. The canonical
-- substrate is assessment_sessions; this view keeps the repo-task naming lane
-- available without duplicating event/evaluation storage.

CREATE VIEW IF NOT EXISTS repo_task_interview_sessions AS
SELECT
  id,
  ingestion_key,
  interview_id,
  candidate_id,
  workspace_id,
  workspace_person_id,
  application_id,
  mode,
  CASE
    WHEN state = 'EVALUATION_PENDING' THEN 'EVALUATING'
    WHEN state = 'BLOCKED' THEN 'DIAGNOSTIC'
    ELSE state
  END AS state,
  created_by,
  metadata_json,
  started_at,
  submitted_at,
  completed_at,
  COALESCE(diagnostic_at, CASE WHEN state IN ('DIAGNOSTIC', 'BLOCKED') THEN updated_at ELSE NULL END) AS diagnostic_at,
  canceled_at,
  created_at,
  updated_at
FROM assessment_sessions
WHERE mode IN (
  'CODE_REVIEW',
  'DEV_CONTAINER_REPO_TASK',
  'OPEN_SOURCE_BUG_FIX',
  'NINETY_FIVE_UNTIL_INFINITY_ROOM',
  'CLIPPY_DEVIN_INTERACTION'
);
