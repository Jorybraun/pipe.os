-- Idempotent test seed. Inserts one recruiter pipeline with one CODE_REVIEW
-- challenge and one pre-invited candidate. Uses fixed UUIDs so repeated runs
-- update rather than duplicate.
--
-- Prereq: the Clerk dev instance user `user_test_recruiter` must exist, or
-- swap the owner_id to a real Clerk user in your dev workspace.
--
-- Apply with:
--   wrangler d1 execute pipe-db-test --env test --remote --file scripts/seed-test-db.sql

INSERT OR REPLACE INTO pipelines (id, owner_id, title, level, status, created_at, updated_at)
VALUES (
  'test-pipeline-0000',
  'user_test_recruiter',
  'Senior Backend Engineer',
  'Senior',
  'ACTIVE',
  '2026-04-22T00:00:00Z',
  '2026-04-22T00:00:00Z'
);

INSERT OR REPLACE INTO stages (id, pipeline_id, stage_type, title, sort_order, mode, created_at, updated_at)
VALUES (
  'test-stage-0000',
  'test-pipeline-0000',
  'CODE_REVIEW',
  'Code Review Challenge',
  0,
  'ASYNC',
  '2026-04-22T00:00:00Z',
  '2026-04-22T00:00:00Z'
);

INSERT OR REPLACE INTO challenges (
  id, stage_id, type, title, instructions, sort_order,
  config, server_config, cached_diff_json,
  github_pr_title, github_pr_description, github_pr_number, github_repo_url,
  created_at, updated_at
)
VALUES (
  'test-challenge-0000',
  'test-stage-0000',
  'CODE_REVIEW',
  'Planted-Bug PR Review',
  'Review the PR and flag any bugs or quality issues you find.',
  0,
  '{"implementerPersona":"junior","maxRounds":2,"enableExplainer":false}',
  '{"plantedBugs":[{"id":"b1","file":"src/example.ts","line":12,"severity":"blocking","description":"Off-by-one error in loop bound"}]}',
  '{"files":[{"filename":"src/example.ts","hunks":[{"header":"@@ -1,20 +1,20 @@","lines":[{"type":"context","content":"function sum(n: number) {"},{"type":"added","content":"  let total = 0;"},{"type":"added","content":"  for (let i = 0; i <= n; i++) total += i;"},{"type":"added","content":"  return total;"},{"type":"context","content":"}"}]}]}]}',
  'fix: sum helper',
  'Adds a sum helper function used by the reporting endpoint.',
  42,
  'https://github.com/pipe-test/example',
  '2026-04-22T00:00:00Z',
  '2026-04-22T00:00:00Z'
);

INSERT OR REPLACE INTO candidates (
  id, pipeline_id, owner_id, name, email, invite_token, status,
  current_stage_id, created_at, updated_at
)
VALUES (
  'test-candidate-0000',
  'test-pipeline-0000',
  'user_test_recruiter',
  'Test Candidate',
  'test+candidate@pipe.build',
  'test-invite-token-0000',
  'INVITED',
  'test-stage-0000',
  '2026-04-22T00:00:00Z',
  '2026-04-22T00:00:00Z'
);
