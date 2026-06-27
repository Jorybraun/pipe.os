-- Compact, replayable examples for improving CODE_REVIEW judging and feedback.
--
-- Raw transcripts and score reports remain the source of truth in
-- review_sessions and living-context artifacts. This table stores a compiled
-- example row that can be labelled by humans or replayed against future judge
-- prompts without scraping the whole transcript every time.

CREATE TABLE IF NOT EXISTS code_review_judge_examples (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES review_sessions(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  example_version TEXT NOT NULL,
  prompt_input_json TEXT NOT NULL,
  expected_output_json TEXT,
  judge_feedback_json TEXT,
  provenance_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY'
    CHECK (status IN ('READY', 'LABELLED', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_review_judge_examples_candidate
  ON code_review_judge_examples(candidate_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_review_judge_examples_challenge
  ON code_review_judge_examples(challenge_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_review_judge_examples_status
  ON code_review_judge_examples(status, updated_at DESC);
