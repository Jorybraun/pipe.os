#!/usr/bin/env npx tsx
/**
 * Direct SQL matching test — bypasses the LLM agents to verify that the
 * seeded data produces a valid repo match + triangulation.
 *
 * Runs the same SQL graph matcher query that matchRepos.ts uses, then
 * loads role-repo alignments and engineering signals, and computes
 * triangulateMatch manually.
 *
 * Usage:
 *   cd workers/api
 *   npx tsx scripts/test-matching-sql.ts
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DB_PATH =
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite';

const CANDIDATE_ID = 'd0cc9595-5a14-4492-bcd0-75af6ab8d514';
const PIPELINE_ID = 'a7a87cf57351ce107adbbbba58bc62a3';

function sql(query: string): string {
  const tmp = join(tmpdir(), `pipe-test-${Date.now()}.sql`);
  writeFileSync(tmp, query, 'utf-8');
  try {
    return execSync(`sqlite3 "${DB_PATH}" < "${tmp}"`, {
      encoding: 'utf-8',
      cwd: '/Users/hans/Code/PIPE/PIPE-OS/workers/api',
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function sqlJson<T>(query: string): T[] {
  const out = sql('.mode json\n' + query);
  if (!out || out === '[]') return [];
  try {
    return JSON.parse(out) as T[];
  } catch {
    console.error('JSON parse failed. Raw:', out.slice(0, 200));
    return [];
  }
}

// ─── Load candidate key concepts ───────────────────────────────────────────

const candRows = sqlJson<{
  key_concepts_json: string;
  candidate_searchable_profile: string;
  embedding_json: string;
}>(
  `SELECT key_concepts_json, candidate_searchable_profile, embedding_json FROM candidate_ingestion WHERE candidate_id = '${CANDIDATE_ID}'`
);

if (candRows.length === 0) {
  console.error('❌ No candidate_ingestion row found. Run seed-e2e-matching.ts first.');
  process.exit(1);
}

const candRow = candRows[0];
const keyConcepts = JSON.parse(candRow.key_concepts_json);
console.log('Candidate key concepts:', JSON.stringify(keyConcepts, null, 2));

// ─── Load role context ─────────────────────────────────────────────────────

const roleRows = sqlJson<{
  id: string;
  embedding_json: string;
}>(
  `SELECT id, embedding_json FROM role_contexts WHERE pipeline_id = '${PIPELINE_ID}'`
);

if (roleRows.length === 0) {
  console.error('❌ No role_contexts row found. Run seed-e2e-matching.ts first.');
  process.exit(1);
}

const roleRow = roleRows[0];
console.log('Role context:', roleRow.id);

// ─── Run graph matcher SQL (simplified from matchRepos.ts) ─────────────────

const mustSkills = keyConcepts.mustHaveSkills ?? [];
const niceSkills = keyConcepts.niceToHaveSkills ?? [];
const seniority = keyConcepts.seniority ?? 'senior';
const primaryLanguage = keyConcepts.primary_language ?? 'typescript';
const domain = keyConcepts.detected_domain ?? 'web-backend';

const mustSlugs = mustSkills.map((s: string) => s.toLowerCase().replace(/\s+/g, '-'));
const niceSlugs = niceSkills.map((s: string) => s.toLowerCase().replace(/\s+/g, '-'));

console.log('\nMust-have slugs:', mustSlugs.join(', '));
console.log('Nice-to-have slugs:', niceSlugs.join(', '));

const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
const staleCutoff = sixMonthsAgo.toISOString();

function sqlList(arr: string[]): string {
  return arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
}

const bands = (() => {
  const ORDER = ['junior', 'mid', 'senior', 'staff'];
  const idx = ORDER.indexOf(seniority.toLowerCase());
  if (idx === -1) return [seniority];
  return [
    idx > 0 ? ORDER[idx - 1] : null,
    ORDER[idx],
    idx < ORDER.length - 1 ? ORDER[idx + 1] : null,
  ].filter((b): b is string => b !== null);
})();

const graphSql = `
WITH scored AS (
  SELECT
    r.id,
    r.full_name,
    r.github_url,
    r.description,
    r.seniority_band,
    r.detected_domain,
    r.pr_quality_score,
    r.contamination_risk,
    r.stars,
    r.primary_language,
    COUNT(DISTINCT CASE WHEN rs.skill_slug IN (${sqlList(mustSlugs)}) THEN rs.skill_slug END) AS must_hits,
    COUNT(DISTINCT CASE WHEN rs.skill_slug IN (${sqlList(niceSlugs)}) THEN rs.skill_slug END) AS nice_hits
  FROM qualified_repos r
  LEFT JOIN repo_skills rs ON rs.repo_id = r.id
  LEFT JOIN repo_engineering_signals es ON es.repo_id = r.id
  WHERE r.disqualified = 0
    AND r.primary_language = '${primaryLanguage}'
    AND r.seniority_band IN (${sqlList(bands)})
    AND r.last_pushed_at >= '${staleCutoff}'
    AND (es.architecture_style IS NULL OR es.architecture_style != 'library')
    AND NOT (COALESCE(r.open_pr_count, 0) = 0 AND COALESCE(r.open_feature_issue_count, 0) < 5)
    AND r.admin_status = 'approved'
  GROUP BY r.id
  HAVING must_hits = ${mustSlugs.length}
)
SELECT
  *,
  (must_hits * 1.0 / ${mustSlugs.length}) * 0.45
  + (nice_hits * 1.0 / MAX(${niceSlugs.length}, 1)) * 0.15
  + (CASE WHEN detected_domain = '${domain}' THEN 1.0 ELSE 0.0 END) * 0.10
  + pr_quality_score * 0.15
  + (1.0 - contamination_risk) * 0.05 AS score
FROM scored
ORDER BY score DESC
LIMIT 10;
`;

const graphMatches = sqlJson<{
  id: number;
  full_name: string;
  github_url: string;
  seniority_band: string;
  detected_domain: string;
  stars: number;
  must_hits: number;
  nice_hits: number;
  score: number;
}>(graphSql);

console.log('\n📊 Graph matcher results:');
if (graphMatches.length === 0) {
  console.log('  ❌ No repos matched. Check repo_skills and qualified_repos data.');
} else {
  for (const m of graphMatches) {
    console.log(
      `  • ${m.full_name} (score=${Number(m.score).toFixed(3)}, must=${m.must_hits}, nice=${m.nice_hits}, domain=${m.detected_domain}, band=${m.seniority_band})`
    );
  }
}

// ─── Load role-repo alignments ─────────────────────────────────────────────

const alignments = sqlJson<{
  repo_id: number;
  alignment_score: number;
  alignment_band: string;
}>(
  `SELECT repo_id, alignment_score, alignment_band FROM repo_role_alignment WHERE role_context_id = '${roleRow.id}'`
);

console.log('\n🔗 Role-repo alignments:');
for (const a of alignments) {
  console.log(`  • repo_${a.repo_id}: ${a.alignment_score} (${a.alignment_band})`);
}

// ─── Load engineering signals for top repo ─────────────────────────────────

if (graphMatches.length > 0) {
  const winner = graphMatches[0];
  const sigRows = sqlJson<{
    complexity_band: string;
    architecture_style: string;
    test_style: string;
    challenge_surfaces: string;
    repo_searchable_profile: string;
    engineering_narrative: string;
  }>(
    `SELECT complexity_band, architecture_style, test_style, challenge_surfaces, repo_searchable_profile, engineering_narrative FROM repo_engineering_signals WHERE repo_id = ${winner.id}`
  );
  const signals = sigRows[0];

  console.log('\n🏆 Winning repo engineering signals:');
  console.log(`  Repo: ${winner.full_name}`);
  console.log(`  Complexity: ${signals?.complexity_band ?? 'n/a'}`);
  console.log(`  Architecture: ${signals?.architecture_style ?? 'n/a'}`);
  console.log(`  Test style: ${signals?.test_style ?? 'n/a'}`);
  console.log(`  Challenge surfaces: ${signals?.challenge_surfaces ?? 'n/a'}`);

  // ─── Mock triangulation ──────────────────────────────────────────────────

  const roleRepoAlignment = alignments.find((a) => a.repo_id === winner.id)?.alignment_score ?? 0;

  // Mock situation fit score (would come from candidateSituationFit LLM)
  const candidateRepoFit = 0.72;

  // Mock role-candidate cosine (would come from exact cosine)
  const roleCandidateCosine = 0.68;

  // Normalize graph score
  const normalizeGraphScore = (score: number) => {
    const minExpected = 0.3;
    const maxExpected = 0.9;
    return Math.max(0, Math.min(1, (score - minExpected) / (maxExpected - minExpected)));
  };

  const dimensions = {
    skill_coverage: normalizeGraphScore(winner.score),
    semantic_similarity: 0, // no ANN in local dev
    situation_fit: candidateRepoFit,
    role_alignment: roleRepoAlignment,
  };

  const w = {
    role_repo: 0.25,
    candidate_fit: 0.35,
    role_candidate: 0.20,
    skill_coverage: 0.20,
  };

  let triangulatedScore =
    w.role_repo * roleRepoAlignment +
    w.candidate_fit * candidateRepoFit +
    w.role_candidate * roleCandidateCosine +
    w.skill_coverage * dimensions.skill_coverage;

  triangulatedScore = Math.max(0, Math.min(1, triangulatedScore));

  console.log('\n📐 Triangulated match (mock situation fit):');
  console.log(`  Skill coverage:     ${dimensions.skill_coverage.toFixed(3)}`);
  console.log(`  Situation fit:      ${dimensions.situation_fit.toFixed(3)}`);
  console.log(`  Role alignment:     ${dimensions.role_alignment.toFixed(3)}`);
  console.log(`  Role↔Candidate:     ${roleCandidateCosine.toFixed(3)}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Triangulated score: ${triangulatedScore.toFixed(3)}`);
  console.log(`  Fit band:           ${triangulatedScore >= 0.75 ? 'strong' : triangulatedScore >= 0.5 ? 'moderate' : triangulatedScore >= 0.25 ? 'weak' : 'mismatch'}`);

  // ─── Check CODE_REVIEW stage ─────────────────────────────────────────────

  const stageRows = sqlJson<{ stage_id: string; challenge_id: string; type: string }>(
    `SELECT s.id as stage_id, c.id as challenge_id, c.type FROM stages s JOIN challenges c ON c.stage_id = s.id WHERE s.pipeline_id = '${PIPELINE_ID}' AND c.type = 'CODE_REVIEW'`
  );

  console.log('\n🎬 CODE_REVIEW placeholder stages:');
  if (stageRows.length === 0) {
    console.log('  ❌ No CODE_REVIEW stage found.');
  } else {
    for (const s of stageRows) {
      console.log(`  • stage=${s.stage_id}, challenge=${s.challenge_id}, type=${s.type}`);
    }
  }

  console.log('\n✅ Matching data verification complete.');
}
