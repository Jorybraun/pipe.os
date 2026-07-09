-- Seed: Senior accessibility audit custom container challenge
-- Apply with: npx wrangler d1 execute pipe-db --local --file=./workers/api/seed/accessibility-challenge.sql
-- Replace 'seed' owner_id with the target recruiter's Clerk user ID before applying in production.

INSERT OR IGNORE INTO pipelines (id, owner_id, title, status, created_at, updated_at)
VALUES (
  'seed-pipe-accessibility',
  'seed',
  'Accessibility audit pipeline',
  'DRAFT',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO stages (id, pipeline_id, title, description, sort_order, mode, created_at, updated_at)
VALUES (
  'seed-stage-accessibility',
  'seed-pipe-accessibility',
  'Custom container challenge',
  'Audit the provided dashboard for accessibility issues, write a report, and fix the most critical issues.',
  0,
  'ASYNC',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO challenges (
  id, stage_id, type, sort_order, title, instructions,
  config, server_config,
  owner_id, dev_container_repo_url, dev_container_challenge_branch,
  created_at, updated_at
)
VALUES (
  'seed-challenge-accessibility',
  'seed-stage-accessibility',
  'CUSTOM_CONTAINER',
  0,
  'Senior accessibility audit',
  'Audit the provided dashboard for accessibility issues, write a report, and fix the most critical issues.',
  json_object('expectedArtifacts', json_array('AUDIT.md')),
  json_object(
    'containerImage', 'node:20-slim',
    'verificationCommand', 'npm run test:accessibility',
    'groundTruth', json_object('issues', json_array()),
    'rubric', json_object('dimensions', json_array())
  ),
  'seed',
  'https://github.com/pipe-os/accessibility-audit-challenge',
  'main',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
