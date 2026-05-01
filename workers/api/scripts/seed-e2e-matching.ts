#!/usr/bin/env npx tsx
/**
 * Seed script for E2E matching flow.
 *
 * Sets up the minimal data required for the full candidate→repo→role
 * triangulation pipeline to run end-to-end in local dev:
 *
 *   1. Role context + dummy embedding for the pipeline
 *   2. Pipeline match config (hybrid philosophy)
 *   3. Approve 5 real repos + seed repo_skills
 *   4. Seed repo_role_alignment rows
 *   5. Add a CODE_REVIEW placeholder stage + challenge
 *   6. Seed a synthetic candidate profile into candidate_ingestion
 *      (bypasses the LLM agent which may be slow/unavailable in local dev)
 *
 * All repos and the candidate are REAL — only the role embedding and the
 * candidate searchable profile are synthetic/dummy.
 *
 * Usage:
 *   cd workers/api
 *   npx tsx scripts/seed-e2e-matching.ts
 */

import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

// ─── Config ────────────────────────────────────────────────────────────────

const DB_PATH =
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite';

const PIPELINE_ID = 'a7a87cf57351ce107adbbbba58bc62a3';
const CANDIDATE_ID = 'd0cc9595-5a14-4492-bcd0-75af6ab8d514';
const OWNER_ID = 'user_3BabJ4z5erBfxIMzV4eVYGCsfl6';

// Real repos to approve (already have repo_engineering_signals rows)
const REPOS = [
  { id: 5089, full_name: 'hop-protocol/hop', domain: 'web-backend', seniority: 'staff', stars: 2837, open_pr_count: 15, open_feature_issue_count: 0 },
  { id: 5115, full_name: 'chrisvel/tududi', domain: 'web-backend', seniority: 'staff', stars: 2615, open_pr_count: 4, open_feature_issue_count: 2 },
  { id: 5119, full_name: 'puemos/hls-downloader', domain: 'web-frontend', seniority: 'senior', stars: 2548, open_pr_count: 7, open_feature_issue_count: 75 },
  { id: 4266, full_name: 'andrechristikan/ack-nestjs-boilerplate', domain: 'web-backend', seniority: 'senior', stars: 645, open_pr_count: 7, open_feature_issue_count: 0 },
  { id: 4392, full_name: 'argos-ci/argos', domain: 'web-backend', seniority: 'staff', stars: 575, open_pr_count: 2, open_feature_issue_count: 0 },
];

// Candidate's real skills (from candidates.skills JSON)
const CANDIDATE_SKILLS = [
  'react',
  'typescript',
  'redux',
  'accessibility (wcag)',
  'next.js',
  'node.js',
  'webpack',
  'vue.js',
  'angular',
  'graphql',
];

// Skill → repo mapping (seed repo_skills for each repo)
const REPO_SKILLS: Record<number, string[]> = {
  5089: ['typescript', 'node.js', 'react', 'graphql'],
  5115: ['typescript', 'node.js', 'react', 'webpack'],
  5119: ['typescript', 'react', 'webpack', 'node.js'],
  4266: ['typescript', 'node.js', 'graphql'],
  4392: ['typescript', 'node.js', 'react', 'graphql', 'webpack'],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateVector(dim = 1024): number[] {
  const vec = new Array(dim);
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = Math.random() * 2 - 1;
    vec[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}

// ─── SQL Builders ──────────────────────────────────────────────────────────

function buildRoleContextSql(roleContextId: string): string {
  const roleVec = generateVector();
  const profile =
    'Senior Backend Engineer. We are building a high-throughput web platform using TypeScript, Node.js, and React. The team values clean architecture, strong testing discipline, and async programming expertise. Must have production experience with modern backend frameworks and frontend integration. Experience with GraphQL and monorepo tooling is highly valued.';

  return `
DELETE FROM role_contexts WHERE pipeline_id = '${PIPELINE_ID}';
INSERT INTO role_contexts (
  id, pipeline_id, owner_id, status, role_searchable_profile,
  embedding_json, embedding_model_version, match_philosophy, tolerance,
  created_at, updated_at
) VALUES (
  '${roleContextId}',
  '${PIPELINE_ID}',
  '${OWNER_ID}',
  'COMPLETE',
  '${escapeSqlString(profile)}',
  '${escapeSqlString(JSON.stringify(roleVec))}',
  'bge-large-en-v1.5-dummy-seed',
  'hybrid',
  'moderate',
  '${nowIso()}',
  '${nowIso()}'
);
`;
}

function buildPipelineMatchConfigSql(): string {
  const ts = Math.floor(Date.now() / 1000);
  return `
INSERT INTO pipeline_match_config (
  pipeline_id, match_philosophy, tolerance, stage_linkage,
  automation_granularity, updated_at
) VALUES (
  '${PIPELINE_ID}',
  'hybrid',
  'moderate',
  'shared-repo',
  'per-candidate',
  ${ts}
)
ON CONFLICT(pipeline_id) DO UPDATE SET
  match_philosophy = excluded.match_philosophy,
  tolerance = excluded.tolerance,
  updated_at = ${ts};
`;
}

function buildApproveReposSql(): string {
  const ids = REPOS.map((r) => r.id).join(',');
  return `
UPDATE qualified_repos
SET admin_status = 'approved',
    seniority_band = COALESCE(seniority_band, 'senior'),
    detected_domain = COALESCE(detected_domain, 'web-backend'),
    refreshed_at = '${nowIso()}'
WHERE id IN (${ids});
`;
}

function buildRepoSkillsSql(): string {
  const lines: string[] = [];
  for (const repo of REPOS) {
    const skills = REPO_SKILLS[repo.id] ?? ['typescript'];
    for (const skill of skills) {
      lines.push(
        `INSERT OR IGNORE INTO repo_skills (repo_id, skill_slug, source, confidence) VALUES (${repo.id}, '${escapeSqlString(skill)}', 'readme', 0.85);`
      );
    }
  }
  return lines.join('\n');
}

function buildRepoRoleAlignmentSql(roleContextId: string): string {
  const lines: string[] = [];
  const scores = [0.82, 0.78, 0.71, 0.65, 0.6]; // descending
  for (let i = 0; i < REPOS.length; i++) {
    const repo = REPOS[i];
    const score = scores[i] ?? 0.55;
    const band = score >= 0.75 ? 'strong' : score >= 0.5 ? 'moderate' : 'weak';
    lines.push(`
INSERT INTO repo_role_alignment (
  role_context_id, repo_id, alignment_score, alignment_band,
  reasoning_json, per_signal_scores, rcd_version, signals_version,
  generated_at, model_used
) VALUES (
  '${roleContextId}',
  ${repo.id},
  ${score},
  '${band}',
  '${escapeSqlString(JSON.stringify({ matches: ['Strong TypeScript alignment'], mismatches: [], summary: 'Good fit for role' }))}',
  '{}',
  'v1-seed',
  'v2.0.0',
  '${nowIso()}',
  'seed-script'
)
ON CONFLICT(role_context_id, repo_id) DO UPDATE SET
  alignment_score = excluded.alignment_score,
  alignment_band = excluded.alignment_band,
  reasoning_json = excluded.reasoning_json,
  generated_at = excluded.generated_at;
`);
  }
  return lines.join('\n');
}

function buildCodeReviewStageSql(): { stageId: string; challengeId: string; sql: string } {
  const stageId = randomId();
  const challengeId = randomId();

  const sql = `
-- Delete any existing CODE_REVIEW placeholder stages for this pipeline
DELETE FROM challenges WHERE stage_id IN (
  SELECT id FROM stages WHERE pipeline_id = '${PIPELINE_ID}' AND stage_type = 'TECHNICAL'
);
DELETE FROM stages WHERE pipeline_id = '${PIPELINE_ID}' AND stage_type = 'TECHNICAL';

INSERT INTO stages (
  id, pipeline_id, title, description, sort_order, mode, stage_type, created_at, updated_at
) VALUES (
  '${stageId}',
  '${PIPELINE_ID}',
  'Code Review',
  'Review a real pull request from an open-source repository.',
  1,
  'ASYNC',
  'TECHNICAL',
  '${nowIso()}',
  '${nowIso()}'
);

INSERT INTO challenges (
  id, stage_id, type, sort_order, title, instructions, config, github_repo_url
) VALUES (
  '${challengeId}',
  '${stageId}',
  'CODE_REVIEW',
  0,
  'Review a Pull Request',
  'Review the assigned pull request. Focus on code quality, architecture, and correctness.',
  '${escapeSqlString(JSON.stringify({ timeLimitMinutes: 45 }))}',
  NULL
);
`;
  return { stageId, challengeId, sql };
}

function buildCandidateIngestionSql(): string {
  const candVec = generateVector();
  const searchableProfile =
    'Senior UI Developer with 6 years of experience. Expert in React, TypeScript, Redux, and Next.js. Strong background in accessibility (WCAG) and modern frontend tooling including Webpack. Also experienced with Node.js, Vue.js, Angular, and GraphQL. Education in E-commerce Marketing and Business Management from Hyper Island (2014). Proven track record building scalable web applications with clean architecture and strong testing discipline.';

  const keyConcepts = {
    mustHaveSkills: ['typescript', 'react', 'node.js'],
    niceToHaveSkills: ['graphql', 'next.js', 'redux', 'webpack'],
    seniority: 'senior',
    primary_language: 'typescript',
    detected_domain: 'web-backend',
  };

  const careerContext = {
    years_experience: 6,
    current_role: 'Senior UI Developer',
    education: ['E-commerce Marketing and Business Management in Business Management Hyper Island (2014)'],
    industries: ['web', 'saas'],
  };

  const situationSignature = {
    situations: [
      {
        type: 'experience',
        text: '6 years as Senior UI Developer working with React and TypeScript',
        confidence: 0.95,
      },
      {
        type: 'skill',
        text: 'Deep expertise in React ecosystem including Redux, Next.js, and Webpack',
        confidence: 0.92,
      },
      {
        type: 'skill',
        text: 'Backend experience with Node.js and GraphQL',
        confidence: 0.78,
      },
    ],
  };

  return `
INSERT INTO candidate_ingestion (
  candidate_id, status, candidate_searchable_profile, key_concepts_json,
  career_context_json, situation_signature_json, profile_version, model_used,
  profile_generated_at, profile_embedded_at, embedding_json, embedding_model_version,
  created_at, updated_at
) VALUES (
  '${CANDIDATE_ID}',
  'embedded',
  '${escapeSqlString(searchableProfile)}',
  '${escapeSqlString(JSON.stringify(keyConcepts))}',
  '${escapeSqlString(JSON.stringify(careerContext))}',
  '${escapeSqlString(JSON.stringify(situationSignature))}',
  'v1-seed',
  'seed-script',
  '${nowIso()}',
  '${nowIso()}',
  '${escapeSqlString(JSON.stringify(candVec))}',
  'bge-large-en-v1.5-dummy-seed',
  '${nowIso()}',
  '${nowIso()}'
)
ON CONFLICT(candidate_id) DO UPDATE SET
  status = excluded.status,
  candidate_searchable_profile = excluded.candidate_searchable_profile,
  key_concepts_json = excluded.key_concepts_json,
  career_context_json = excluded.career_context_json,
  situation_signature_json = excluded.situation_signature_json,
  profile_version = excluded.profile_version,
  model_used = excluded.model_used,
  profile_generated_at = excluded.profile_generated_at,
  profile_embedded_at = excluded.profile_embedded_at,
  embedding_json = excluded.embedding_json,
  embedding_model_version = excluded.embedding_model_version,
  error_text = NULL,
  updated_at = excluded.updated_at;
`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const roleContextId = randomId();
  const { stageId, challengeId, sql: stageSql } = buildCodeReviewStageSql();

  const allSql = [
    'BEGIN;',
    buildRoleContextSql(roleContextId),
    buildPipelineMatchConfigSql(),
    buildApproveReposSql(),
    buildRepoSkillsSql(),
    buildRepoRoleAlignmentSql(roleContextId),
    stageSql,
    buildCandidateIngestionSql(),
    'COMMIT;',
  ].join('\n\n');

  console.log('Seeding E2E matching data...');
  console.log('  Pipeline:', PIPELINE_ID);
  console.log('  Candidate:', CANDIDATE_ID);
  console.log('  Role context:', roleContextId);
  console.log('  CODE_REVIEW stage:', stageId);
  console.log('  Repos:', REPOS.map((r) => r.full_name).join(', '));

  try {
    execSync(`sqlite3 "${DB_PATH}"`, {
      input: allSql,
      encoding: 'utf-8',
      cwd: '/Users/hans/Code/PIPE/PIPE-OS/workers/api',
    });
    console.log('\n✅ Seed complete.');
    console.log('\nNext steps:');
    console.log('  1. Trigger matching: curl -X POST http://localhost:8787/api/v1/pipelines/' + PIPELINE_ID + '/ingestion/' + CANDIDATE_ID + '/reingest -H "X-Dev-Bypass: local"');
    console.log('  2. Or call matchReposForCandidate directly via a test script.');
    console.log('  3. Verify: SELECT * FROM candidate_ingestion WHERE candidate_id = \'' + CANDIDATE_ID + '\';');
    console.log('  4. Verify: SELECT * FROM candidate_challenge_assignment WHERE candidate_id = \'' + CANDIDATE_ID + '\';');
  } catch (err) {
    console.error('\n❌ Seed failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
