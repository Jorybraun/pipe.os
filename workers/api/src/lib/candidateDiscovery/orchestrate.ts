/**
 * Candidate Ingestion Orchestrator — runs the full meaning-based pipeline
 * on resume upload.
 *
 * Sequence:
 *   1. upsertPendingIngestion
 *   2. discoverCandidateProfile (rich extraction)
 *   3. persistRichCandidateProfile
 *   4. embedAndUpsertCandidate
 *   5. markIngestionEmbedded
 *   6. matchReposForCandidate (graph + optional cosine)
 *   7. Load role_repo_alignment for pipeline's role_context
 *   8. candidateSituationFit on top repos
 *   9. triangulateMatch
 *   10. Write candidate_challenge_assignment rows
 *   11. markIngestionMatched
 *
 * Every step after (2) is wrapped in its own try/catch. Failures write
 * markIngestionFailed and return without throwing — the upload route must
 * not fail because ingestion failed.
 *
 * See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.
 */

import type { Env, RepoEngineeringSignalsRow } from '../../types';
import type { ParsedCV } from '../cvParser';
import { createCandidateAgentProvider } from '../llm/createProvider';
import { matchReposForCandidate } from '../match/matchReposForCandidate';
import { triangulateMatch, triangulateShortlist } from '../match/triangulateMatch';
import { pickReviewPr, pickImplementationIssue } from '../match/autoStageBuilder';
import { discoverCandidateProfile, type CandidateDiscoveryResult } from './agent';
import { embedAndUpsertCandidate } from './embed';
import {
  upsertPendingIngestion,
  persistCandidateProfile,
  markIngestionEmbedded,
  markIngestionMatched,
  markIngestionFailed,
  upsertCandidateChallengeAssignment,
  type MarkIngestionMatchedInput,
} from './persist';
import { candidateSituationFit, type SituationFitCandidate } from './candidateSituationFit';
import { cosineSimilarity, parseEmbeddingJson } from '../embedding/cosine';

export interface IngestionInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  parsed: ParsedCV;
  resumeText: string;
}

/**
 * Run the full ingestion pipeline. Never throws — failures are logged and
 * recorded in candidate_ingestion.status = 'failed'.
 */
export async function runCandidateIngestion(input: IngestionInput): Promise<void> {
  const { env, db, candidateId, parsed, resumeText } = input;

  // Step 1: Reset ingestion state
  try {
    await upsertPendingIngestion(db, candidateId);
  } catch (err) {
    console.error('[ingestion] upsertPending failed:', err);
    // This is pre-upload — if this fails, something is deeply wrong.
    // Still swallow to avoid breaking the upload.
    return;
  }

  // Step 2: Discover rich candidate profile
  let discoveryResult: CandidateDiscoveryResult;
  try {
    const provider = createCandidateAgentProvider(env);
    if (!provider) {
      await markIngestionFailed(db, candidateId, 'Candidate agent provider unavailable (MOCK_AI or missing config)');
      return;
    }

    discoveryResult = await discoverCandidateProfile({ provider, parsed, resumeText });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] discoverCandidateProfile failed:', msg);
    await markIngestionFailed(db, candidateId, `Discovery failed: ${msg}`);
    return;
  }

  // Step 3: Persist rich profile
  try {
    await persistCandidateProfile(db, candidateId, discoveryResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] persistCandidateProfile failed:', msg);
    await markIngestionFailed(db, candidateId, `Persist failed: ${msg}`);
    return;
  }

  // Step 4: Embed into CANDIDATE_INDEX
  let embedResult: Awaited<ReturnType<typeof embedAndUpsertCandidate>>;
  try {
    embedResult = await embedAndUpsertCandidate({
      ai: env.AI,
      vectorize: env.CANDIDATE_INDEX,
      candidateId,
      profile: discoveryResult.candidateSearchableProfile,
      metadata: {
        seniority: discoveryResult.keyConcepts.seniority,
        primary_language: discoveryResult.keyConcepts.primary_language,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] embedAndUpsertCandidate failed:', msg);
    await markIngestionFailed(db, candidateId, `Embed failed: ${msg}`);
    return;
  }

  // Step 5: Mark embedded
  try {
    await markIngestionEmbedded(db, candidateId, embedResult.embeddedAt, JSON.stringify(embedResult.vector));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] markIngestionEmbedded failed:', msg);
    await markIngestionFailed(db, candidateId, `Mark embedded failed: ${msg}`);
    return;
  }

  // Step 6-11: Match, triangulate, assign — wrapped in inner try/catch
  try {
    await runMatchAndAssign({ env, db, candidateId, discoveryResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] runMatchAndAssign failed:', msg);
    await markIngestionFailed(db, candidateId, `Match/assign failed: ${msg}`);
  }
}

// ─── Match + Assign ─────────────────────────────────────────────────────────

interface MatchAndAssignInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  discoveryResult: CandidateDiscoveryResult;
}

async function runMatchAndAssign(input: MatchAndAssignInput): Promise<void> {
  const { env, db, candidateId, discoveryResult } = input;

  // Load candidate's pipeline + match config
  const candidateRow = await db
    .prepare(
      `SELECT c.pipeline_id, pmc.match_philosophy
         FROM candidates c
         LEFT JOIN pipeline_match_config pmc ON pmc.pipeline_id = c.pipeline_id
        WHERE c.id = ?1`,
    )
    .bind(candidateId)
    .first<{ pipeline_id: string; match_philosophy: string | null }>();

  if (!candidateRow) {
    throw new Error(`Candidate ${candidateId} not found`);
  }

  const pipelineId = candidateRow.pipeline_id;
  const philosophy = (candidateRow.match_philosophy ?? 'validate') as 'validate' | 'tailored' | 'hybrid';

  // Step 6: Graph + optional cosine match
  const matchResult = await matchReposForCandidate({
    db,
    ai: env.AI,
    vectorize: env.REPO_INDEX,
    candidateProfile: discoveryResult.candidateSearchableProfile,
    keyConcepts: discoveryResult.keyConcepts,
    candidateLimit: 10,
    rerankTopK: 50,
    cosineWeight: philosophy === 'validate' ? 0.3 : 0.5,
  });

  // Step 7: Load role_repo_alignment for pipeline's role_context
  const roleContextRow = await db
    .prepare(`SELECT id FROM role_contexts WHERE pipeline_id = ?1 LIMIT 1`)
    .bind(pipelineId)
    .first<{ id: string }>();

  let roleRepoAlignments = new Map<number, number>();
  let roleCandidateCosine: number | null = null;

  if (roleContextRow) {
    // Load top 20 role-aligned repos
    const alignmentRows = await db
      .prepare(
        `SELECT repo_id, alignment_score
           FROM repo_role_alignment
          WHERE role_context_id = ?1
          ORDER BY alignment_score DESC
          LIMIT 20`,
      )
      .bind(roleContextRow.id)
      .all<{ repo_id: number; alignment_score: number }>();

    for (const row of alignmentRows.results ?? []) {
      roleRepoAlignments.set(row.repo_id, row.alignment_score);
    }

    // Dual-layer exact cosine: load ground-truth vectors from D1,
    // compute exact similarity. Falls back to null if either side
    // hasn't been embedded yet (triangulateMatch then uses skill_coverage).
    const embeddingRow = await db
      .prepare(
        `SELECT ci.embedding_json AS candidate_embedding, rc.embedding_json AS role_embedding
           FROM candidate_ingestion ci
           LEFT JOIN role_contexts rc ON rc.id = ?1
          WHERE ci.candidate_id = ?2`,
      )
      .bind(roleContextRow.id, candidateId)
      .first<{ candidate_embedding: string | null; role_embedding: string | null }>();

    const candidateVec = parseEmbeddingJson(embeddingRow?.candidate_embedding);
    const roleVec = parseEmbeddingJson(embeddingRow?.role_embedding);
    if (candidateVec && roleVec) {
      try {
        roleCandidateCosine = cosineSimilarity(candidateVec, roleVec);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ingestion] cosine failed for candidate ${candidateId}:`, msg);
        roleCandidateCosine = null;
      }
    }
  }

  // Step 8: Candidate situation fit
  // Build candidate pool from: (a) role-aligned repos, (b) graph shortlist
  const repoIdsToFetch = new Set<number>([
    ...roleRepoAlignments.keys(),
    ...matchResult.shortlist.map((s) => s.repoId),
  ]);

  if (repoIdsToFetch.size === 0) {
    throw new Error('No repos to evaluate for candidate situation fit');
  }

  // Load engineering signals for all candidate repos
  const signalsRows = await db
    .prepare(
      `SELECT repo_id, repo_searchable_profile, engineering_narrative, signals_version,
              test_touch_rate, mean_changed_files, p90_changed_files, issue_link_rate,
              complexity_band, swe_bench_eligibility_rate, architecture_style,
              review_density, test_style, challenge_surfaces
         FROM repo_engineering_signals
        WHERE repo_id IN (${Array.from(repoIdsToFetch).map(() => '?').join(',')})`,
    )
    .bind(...repoIdsToFetch)
    .all<{
      repo_id: number;
      repo_searchable_profile: string;
      engineering_narrative: string;
      signals_version: string;
      test_touch_rate: number | null;
      mean_changed_files: number | null;
      p90_changed_files: number | null;
      issue_link_rate: number | null;
      complexity_band: string | null;
      swe_bench_eligibility_rate: number | null;
      architecture_style: string | null;
      review_density: number | null;
      test_style: string | null;
      challenge_surfaces: string | null;
    }>();

  const signalsByRepo = new Map<number, RepoEngineeringSignalsRow>();
  for (const row of signalsRows.results ?? []) {
    signalsByRepo.set(row.repo_id, {
      repo_id: row.repo_id,
      signals_version: row.signals_version,
      content_hash: '',
      test_touch_rate: row.test_touch_rate,
      mean_changed_files: row.mean_changed_files,
      p90_changed_files: row.p90_changed_files,
      issue_link_rate: row.issue_link_rate,
      complexity_band: row.complexity_band as RepoEngineeringSignalsRow['complexity_band'],
      swe_bench_eligibility_rate: row.swe_bench_eligibility_rate,
      architecture_style: row.architecture_style as RepoEngineeringSignalsRow['architecture_style'],
      review_density: row.review_density,
      commit_cadence: null,
      satd_density: null,
      test_style: row.test_style as RepoEngineeringSignalsRow['test_style'],
      challenge_surfaces: row.challenge_surfaces,
      repo_searchable_profile: row.repo_searchable_profile,
      engineering_narrative: row.engineering_narrative,
      signal_json: '',
      generated_at: '',
      model_used: '',
      model_version: '',
    });
  }

  const situationCandidates: SituationFitCandidate[] = [];
  for (const repoId of repoIdsToFetch) {
    const signals = signalsByRepo.get(repoId);
    if (!signals) continue;
    situationCandidates.push({
      repo_id: repoId,
      full_name: `repo_${repoId}`, // Will be enriched from matchResult shortlist if needed
      signals,
    });
  }

  // Enrich full_name from shortlist
  const shortlistNameMap = new Map(matchResult.shortlist.map((s) => [s.repoId, s.fullName]));
  for (const c of situationCandidates) {
    const name = shortlistNameMap.get(c.repo_id);
    if (name) c.full_name = name;
  }

  let situationRankings = await candidateSituationFit({
    provider: createCandidateAgentProvider(env)!,
    candidateResult: discoveryResult,
    candidateKeyConcepts: discoveryResult.keyConcepts,
    repos: situationCandidates,
  });

  // Step 9: Triangulate
  let triangulated = triangulateMatch({
    philosophy,
    graphResult: matchResult,
    situationRankings: situationRankings.rankings,
    roleRepoAlignments,
    roleCandidateCosine,
  });

  let winnerRepoId = triangulated.repo_id;
  let winnerRepoUrl = matchResult.repoChoice.githubUrl;
  let winnerReview = matchResult.review;
  let winnerImplementation = matchResult.implementation;

  // Tailored mode: re-rank the full shortlist and potentially switch winner
  if (philosophy === 'tailored' && matchResult.shortlist.length > 1) {
    const shortlistScores = triangulateShortlist({
      philosophy,
      graphResult: matchResult,
      situationRankings: situationRankings.rankings,
      roleRepoAlignments,
      roleCandidateCosine,
    });

    if (shortlistScores.length > 0) {
      const top = shortlistScores[0]!;
      if (top.repo_id !== winnerRepoId) {
        winnerRepoId = top.repo_id;
        // Look up github_url from qualified_repos
        const repoRow = await db
          .prepare('SELECT full_name, html_url FROM qualified_repos WHERE id = ?1')
          .bind(winnerRepoId)
          .first<{ full_name: string; html_url: string }>();
        winnerRepoUrl = repoRow?.html_url ?? '';

        // Fetch PR/issue for the new winner
        const [pr, issue] = await Promise.all([
          pickReviewPr(db, winnerRepoId),
          pickImplementationIssue(db, winnerRepoId, discoveryResult.keyConcepts.seniority),
        ]);
        winnerReview = pr;
        winnerImplementation = issue;

        // Re-triangulate the single winner so dimensions/raw_signals are accurate
        const tailoredWinner = matchResult.shortlist.find((s) => s.repoId === winnerRepoId);
        if (tailoredWinner) {
          triangulated = triangulateMatch({
            philosophy,
            graphResult: {
              ...matchResult,
              repoChoice: {
                repoId: winnerRepoId,
                fullName: repoRow?.full_name ?? `repo_${winnerRepoId}`,
                githubUrl: winnerRepoUrl,
                score: tailoredWinner.score,
                cosine: tailoredWinner.cosine,
                rationale: `tailored re-rank winner (score ${top.triangulated_score.toFixed(3)})`,
              },
            },
            situationRankings: situationRankings.rankings,
            roleRepoAlignments,
            roleCandidateCosine,
          });
        }
      }
    }
  }

  // Extract reasoning for the winner from situation fit rankings
  const winnerSituation = situationRankings.rankings.find((r) => r.repo_id === winnerRepoId);
  const reasoningJson = winnerSituation
    ? JSON.stringify({
        matches: winnerSituation.reasoning.matches,
        mismatches: winnerSituation.reasoning.mismatches,
      })
    : undefined;

  // Telemetry: record vector vs LLM signal correlation for empirical calibration
  // NOTE: match_feedback table (migration 0040) currently lacks columns for
  // vector_role_repo, vector_cand_repo, and vector_role_cand. If these signals
  // are promoted to first-class match dimensions, extend the schema.
  const rawSignals = triangulated.raw_signals as typeof triangulated.raw_signals & {
    vector_role_repo?: number | null;
    vector_cand_repo?: number | null;
    vector_role_cand?: number | null;
  };
  console.log(
    JSON.stringify({
      event: 'match.telemetry',
      candidateId,
      pipelineId,
      triangulatedScore: triangulated.triangulated_score,
      vectorSignals: {
        vector_role_repo: rawSignals.vector_role_repo ?? null,
        vector_cand_repo: rawSignals.vector_cand_repo ?? null,
        vector_role_cand: rawSignals.vector_role_cand ?? null,
      },
      llmSignals: {
        role_repo_alignment: rawSignals.role_repo_alignment,
        candidate_repo_fit: rawSignals.candidate_repo_fit,
        role_candidate_cosine: rawSignals.role_candidate_cosine,
      },
    }),
  );

  // Step 10: Find placeholder stages and write assignments (skip in validate mode)
  if (philosophy !== 'validate') {
    const placeholderStages = await db
      .prepare(
        `SELECT s.id as stage_id, c.id as challenge_id, c.type
           FROM stages s
           JOIN challenges c ON c.stage_id = s.id
           JOIN candidates cd ON cd.pipeline_id = s.pipeline_id
          WHERE cd.id = ?1 AND c.github_repo_url IS NULL
            AND c.type IN ('CODE_REVIEW', 'CODE_IMPLEMENTATION')`,
      )
      .bind(candidateId)
      .all<{ stage_id: string; challenge_id: string; type: string }>();

    for (const stage of placeholderStages.results ?? []) {
      const isReview = stage.type === 'CODE_REVIEW';
      const prNumber = isReview ? (winnerReview?.prNumber ?? null) : null;
      const issueNumber = !isReview ? (winnerImplementation?.issueNumber ?? null) : null;

      await upsertCandidateChallengeAssignment(db, {
        id: cryptoRandomId(),
        candidateId,
        stageId: stage.stage_id,
        challengeId: stage.challenge_id,
        repoId: winnerRepoId,
        githubRepoUrl: winnerRepoUrl,
        githubPrNumber: prNumber,
        issueNumber: issueNumber,
      });
    }
  }

  // Step 11: Mark matched with full score payload
  const matchedInput: MarkIngestionMatchedInput = {
    candidateId,
    matchedRepoId: winnerRepoId,
    triangulatedScore: triangulated.triangulated_score,
    dimensionsJson: JSON.stringify(triangulated.dimensions),
    reasoningJson,
    matchPhilosophy: philosophy,
  };
  await markIngestionMatched(db, matchedInput);
}

// ─── Utility ────────────────────────────────────────────────────────────────

function cryptoRandomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
