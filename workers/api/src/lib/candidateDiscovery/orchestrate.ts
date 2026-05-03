/**
 * Candidate Ingestion Orchestrator — runs the full meaning-based pipeline
 * on resume upload.
 *
 * Sequence:
 *   1. upsertPendingIngestion
 *   2. discoverCandidateProfile (rich extraction)
 *   3. persistRichCandidateProfile
 *   4. embedAndUpsertCandidate (self-persists status + embedding to D1 when db passed)
 *   5. matchReposForCandidate (graph + optional cosine)
 *   6. Load role_repo_alignment for pipeline's role_context
 *   7. Load cultural signal nodes for prompt enrichment
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
import type { DecompositionResult } from './candidateDecompositionPrompt';
import { createCandidateAgentProvider } from '../llm/createProvider';
import { matchReposForCandidate } from '../match/matchReposForCandidate';
import { triangulateMatch, triangulateShortlist } from '../match/triangulateMatch';
import { pickReviewPr, pickImplementationIssue } from '../match/autoStageBuilder';
import { discoverCandidateProfile, type CandidateDiscoveryResult } from './agent';
import { embedAndUpsertCandidate, upsertCandidateVector } from './embed';
import {
  upsertPendingIngestion,
  persistCandidateProfile,
  markIngestionMatched,
  markIngestionFailed,
  upsertCandidateChallengeAssignment,
  type MarkIngestionMatchedInput,
} from './persist';
import {
  candidateSituationFit,
  buildSituationFitCacheKey,
  getCachedSituationFit,
  storeSituationFitCache,
  type SituationFitCandidate,
  type SituationFitRanking,
} from './candidateSituationFit';
import { cosineSimilarity, parseEmbeddingJson, meanPoolVectors } from '../embedding/cosine';
import { getActiveCandidateNodes } from './candidateNodes';
import { decomposeResumeToGraph } from './resumeDecomposition';
import { computeRecencyMultiplier } from './candidateRecency';
import { getCandidateCoverage } from './candidateCoverage';
import { buildProfileSections } from './buildProfileSections';
import { recordStepDuration, estimateCompletion } from '../telemetry/stepDurationTracker';

export interface IngestionInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  parsed: ParsedCV;
  resumeText: string;
  decompositionResult?: DecompositionResult | null;
}

/**
 * Run the full ingestion pipeline. Never throws — failures are logged and
 * recorded in candidate_ingestion.status = 'failed'.
 */
export async function runCandidateIngestion(input: IngestionInput): Promise<void> {
  const { env, db, candidateId, parsed, resumeText } = input;

  // Step 1: Reset ingestion state
  try {
    await trackStep(db, candidateId, 'upsert_pending', () =>
      upsertPendingIngestion(db, candidateId),
    );
  } catch (err) {
    console.error('[ingestion] upsertPending failed:', err);
    // This is pre-upload — if this fails, something is deeply wrong.
    // Still swallow to avoid breaking the upload.
    return;
  }

  // Compute estimated completion before starting work steps
  const remainingSteps = [
    'discover_profile',
    'persist_profile',
    'decompose_resume',
    'embed_profile',
    'match_and_assign',
  ];
  const estimatedMs = await estimateCompletion(db, remainingSteps);
  if (estimatedMs !== null) {
    await setEstimatedCompletion(db, candidateId, new Date(Date.now() + estimatedMs));
  }

  // Step 2: Discover rich candidate profile
  let discoveryResult: CandidateDiscoveryResult;
  try {
    const provider = createCandidateAgentProvider(env);
    if (!provider) {
      await markIngestionFailedWithStep(
        db,
        candidateId,
        'Candidate agent provider unavailable (MOCK_AI or missing config)',
        'discover_profile',
      );
      return;
    }

    discoveryResult = await trackStep(db, candidateId, 'discover_profile', () =>
      discoverCandidateProfile({ provider, parsed, resumeText }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] discoverCandidateProfile failed:', msg);
    await markIngestionFailedWithStep(db, candidateId, `Discovery failed: ${msg}`, 'discover_profile');
    return;
  }

  // Step 3: Persist rich profile
  try {
    await trackStep(db, candidateId, 'persist_profile', () =>
      persistCandidateProfile(db, candidateId, discoveryResult),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] persistCandidateProfile failed:', msg);
    await markIngestionFailedWithStep(db, candidateId, `Persist failed: ${msg}`, 'persist_profile');
    return;
  }

  // Step 3.5: Decompose resume into candidate_nodes (ADR-041 Phase 1)
  // This runs after profile persistence but before embedding.
  // Failures are logged but do not block the pipeline.
  let decompositionEmbeddings: number[][] = [];
  try {
    const decompResult = await trackStep(db, candidateId, 'decompose_resume', () =>
      decomposeResumeToGraph({
        db,
        candidateId,
        resumeText,
        parsedCV: parsed,
        env,
        decompositionResult: input.decompositionResult,
        vectorize: env.CANDIDATE_INDEX,
      }),
    );
    decompositionEmbeddings = decompResult.embeddings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ingestion] resumeDecomposition failed (non-blocking):', msg);
  }

  // Step 4: Embed into CANDIDATE_INDEX
  // Primary: aggregate sub-element embeddings (mean pool + L2 norm).
  // Fallback: embed the prose profile directly if decomposition yielded no vectors.
  let embedResult: Awaited<ReturnType<typeof embedAndUpsertCandidate>>;
  try {
    embedResult = await trackStep(db, candidateId, 'embed_profile', async () => {
      const aggregateVector = meanPoolVectors(decompositionEmbeddings);
      if (aggregateVector) {
        const result = await upsertCandidateVector({
          vectorize: env.CANDIDATE_INDEX,
          candidateId,
          vector: aggregateVector,
          metadata: {
            seniority: discoveryResult.keyConcepts.seniority,
            primary_language: discoveryResult.keyConcepts.primary_language,
            profile_version: discoveryResult.profileVersion,
            aggregate_source: 'node_mean_pool',
          },
          db,
        });
        console.log('[ingestion] Upserted aggregate vector from', decompositionEmbeddings.length, 'node embeddings');
        return result;
      } else {
        // Fallback to prose-generated embedding when decomposition has no vectors
        return await embedAndUpsertCandidate({
          ai: env.AI,
          vectorize: env.CANDIDATE_INDEX,
          candidateId,
          profile: discoveryResult.candidateSearchableProfile,
          metadata: {
            seniority: discoveryResult.keyConcepts.seniority,
            primary_language: discoveryResult.keyConcepts.primary_language,
            profile_version: discoveryResult.profileVersion,
          },
          db,
        });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] embed/upsert failed:', msg);
    await markIngestionFailedWithStep(db, candidateId, `Embed failed: ${msg}`, 'embed_profile');
    return;
  }

  // Step 5: Mark embedded — now handled inside embedAndUpsertCandidate

  // Step 6-11: Match, triangulate, assign — wrapped in inner try/catch
  try {
    await trackStep(db, candidateId, 'match_and_assign', () =>
      runMatchAndAssign({ env, db, candidateId, discoveryResult }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] runMatchAndAssign failed:', msg);
    await markIngestionFailedWithStep(db, candidateId, `Match/assign failed: ${msg}`, 'match_and_assign');
  }
}

// ─── Match + Assign ─────────────────────────────────────────────────────────

export interface MatchAndAssignInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  discoveryResult: CandidateDiscoveryResult;
}

export async function runMatchAndAssign(input: MatchAndAssignInput): Promise<void> {
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

  // Load candidate embedding early for semantic PR selection.
  const candidateEmbeddingRow = await db
    .prepare(`SELECT embedding_json FROM candidate_ingestion WHERE candidate_id = ?1`)
    .bind(candidateId)
    .first<{ embedding_json: string | null }>();
  const candidateVec = parseEmbeddingJson(candidateEmbeddingRow?.embedding_json);

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
    candidateEmbeddingJson: candidateVec,
  });

  // Step 7: Load role_repo_alignment for pipeline's role_context
  const roleContextRow = await db
    .prepare(`SELECT id FROM role_contexts WHERE pipeline_id = ?1 LIMIT 1`)
    .bind(pipelineId)
    .first<{ id: string }>();

  let roleRepoAlignments = new Map<number, number>();
  let roleCandidateCosine: number | null = null;
  let vectorRoleRepo: number | null = null;
  let vectorRoleCandidate: number | null = null;

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
    const roleEmbeddingRow = await db
      .prepare(`SELECT embedding_json AS role_embedding FROM role_contexts WHERE id = ?1`)
      .bind(roleContextRow.id)
      .first<{ role_embedding: string | null }>();

    const roleVec = parseEmbeddingJson(roleEmbeddingRow?.role_embedding);
    if (candidateVec && roleVec) {
      try {
        roleCandidateCosine = cosineSimilarity(candidateVec, roleVec);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ingestion] cosine failed for candidate ${candidateId}:`, msg);
        roleCandidateCosine = null;
      }
    }

    // Vector-native ANN signals: query Vectorize with role vector to get
    // approximate role→repo and role→candidate similarities.
    // These are best-effort; failures fall back to null.
    if (roleVec) {
      try {
        const [repoQuery, candidateQuery] = await Promise.all([
          env.REPO_INDEX.query(roleVec, { topK: 20 }),
          env.CANDIDATE_INDEX.query(roleVec, { topK: 20 }),
        ]);
        const winnerRepoId = matchResult.repoChoice.repoId;
        const repoMatch = repoQuery.matches.find((m) => m.id === `repo_${winnerRepoId}`);
        if (repoMatch) {
          vectorRoleRepo = repoMatch.score;
        }
        const candMatch = candidateQuery.matches.find((m) => m.id === `candidate_${candidateId}`);
        if (candMatch) {
          vectorRoleCandidate = candMatch.score;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ingestion] vector query failed for candidate ${candidateId}:`, msg);
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

  // Step 8: Load candidate nodes for prompt enrichment (graph-enabled matching)
  let culturalSignalNodes: Awaited<ReturnType<typeof getActiveCandidateNodes>> = [];
  let experienceNodes: Awaited<ReturnType<typeof getActiveCandidateNodes>> = [];
  let projectNodes: Awaited<ReturnType<typeof getActiveCandidateNodes>> = [];
  let skillNodes: Awaited<ReturnType<typeof getActiveCandidateNodes>> = [];
  let careerArcNodes: Awaited<ReturnType<typeof getActiveCandidateNodes>> = [];
  try {
    [culturalSignalNodes, experienceNodes, projectNodes, skillNodes, careerArcNodes] = await Promise.all([
      getActiveCandidateNodes(db, candidateId, 'CulturalSignal'),
      getActiveCandidateNodes(db, candidateId, 'Experience'),
      getActiveCandidateNodes(db, candidateId, 'Project'),
      getActiveCandidateNodes(db, candidateId, 'Skill'),
      getActiveCandidateNodes(db, candidateId, 'CareerArc'),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestion] failed to load candidate nodes for ${candidateId}:`, msg);
  }

  // Compute recency multiplier from all active resume-derived nodes
  const allResumeNodes = [...experienceNodes, ...projectNodes, ...skillNodes, ...careerArcNodes];
  const recencyMultiplier = allResumeNodes.length > 0 ? computeRecencyMultiplier(allResumeNodes) : 1.0;

  const hasGraphNodes =
    culturalSignalNodes.length > 0 ||
    experienceNodes.length > 0 ||
    projectNodes.length > 0 ||
    skillNodes.length > 0 ||
    careerArcNodes.length > 0;

  // v3-graph-enriched: includes CareerArc + enriched Experience/Skill fields
  // v2-graph: basic graph nodes without enrichment
  // v1: flat profile only
  const promptVersion = careerArcNodes.length > 0 ? 'v3-graph-enriched' : hasGraphNodes ? 'v2-graph' : 'v1';

  // Step 9: Candidate situation fit (with per-repo cache)
  const cachedRankings: SituationFitRanking[] = [];
  const missRepos: SituationFitCandidate[] = [];

  for (const repo of situationCandidates) {
    const cacheKey = await buildSituationFitCacheKey(
      candidateId,
      repo.repo_id,
      discoveryResult.profileVersion,
      repo.signals.signals_version,
      promptVersion,
    );
    const cached = await getCachedSituationFit(db, cacheKey);
    if (cached) {
      cachedRankings.push(cached);
    } else {
      missRepos.push(repo);
    }
  }

  console.log(
    JSON.stringify({
      event: 'situationFit.cache',
      candidateId,
      total: situationCandidates.length,
      hits: cachedRankings.length,
      misses: missRepos.length,
    }),
  );

  let situationRankings: Awaited<ReturnType<typeof candidateSituationFit>>;
  if (missRepos.length === 0) {
    situationRankings = { rankings: cachedRankings, rawText: '' };
  } else {
    // Batch repos to avoid JSON truncation on long responses (Llama 3.1 8B
    // struggles with structured JSON for >5 repos at once).
    const BATCH_SIZE = 3;
    const allRankings: SituationFitRanking[] = [...cachedRankings];
    const rawTexts: string[] = [];

    for (let i = 0; i < missRepos.length; i += BATCH_SIZE) {
      const batch = missRepos.slice(i, i + BATCH_SIZE);
      console.log(`[ingestion] situationFit batch ${i / BATCH_SIZE + 1}/${Math.ceil(missRepos.length / BATCH_SIZE)} — ${batch.length} repos`);
      let llmResult: Awaited<ReturnType<typeof candidateSituationFit>>;
      try {
        llmResult = await candidateSituationFit({
          provider: createCandidateAgentProvider(env)!,
          candidateResult: discoveryResult,
          candidateKeyConcepts: discoveryResult.keyConcepts,
          repos: batch,
          ...(culturalSignalNodes.length > 0 ? { culturalSignalNodes } : {}),
          ...(roleContextRow ? { roleContextId: roleContextRow.id } : {}),
          ...(experienceNodes.length > 0 ? { experienceNodes } : {}),
          ...(projectNodes.length > 0 ? { projectNodes } : {}),
          ...(skillNodes.length > 0 ? { skillNodes } : {}),
          ...(careerArcNodes.length > 0 ? { careerArcNodes } : {}),
          recencyMultiplier,
        });
      } catch (batchErr) {
        console.error(`[ingestion] situationFit batch ${i / BATCH_SIZE + 1} failed:`, batchErr);
        continue;
      }

      // Store cache for each miss in this batch
      for (const ranking of llmResult.rankings) {
        const repo = batch.find((r) => r.repo_id === ranking.repo_id);
        if (!repo) continue;
        const cacheKey = await buildSituationFitCacheKey(
          candidateId,
          ranking.repo_id,
          discoveryResult.profileVersion,
          repo.signals.signals_version,
          promptVersion,
        );
        await storeSituationFitCache(
          db,
          cacheKey,
          candidateId,
          ranking.repo_id,
          discoveryResult.profileVersion,
          repo.signals.signals_version,
          ranking,
        );
      }

      allRankings.push(...llmResult.rankings);
      if (llmResult.rawText) rawTexts.push(llmResult.rawText);
    }

    situationRankings = {
      rankings: allRankings,
      rawText: rawTexts.join('\n---\n'),
    };
  }

  // Step 9.5: Load coverage for evidence density multiplier
  let evidenceDensity: number | null = null;
  try {
    const coverage = await getCandidateCoverage(db, candidateId);
    if (coverage) {
      evidenceDensity =
        coverage.experience_coverage * 0.3 +
        coverage.technical_coverage * 0.3 +
        coverage.cultural_coverage * 0.2 +
        coverage.motivation_coverage * 0.1 +
        coverage.context_coverage * 0.1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestion] failed to load coverage for ${candidateId}:`, msg);
  }

  // Step 10: Triangulate
  const vectorCandidateRepo = matchResult.repoChoice.cosine;
  let triangulated = triangulateMatch({
    philosophy,
    graphResult: matchResult,
    situationRankings: situationRankings.rankings,
    roleRepoAlignments,
    roleCandidateCosine,
    vectorCandidateRepo,
    vectorRoleRepo,
    vectorRoleCandidate,
    evidenceDensity,
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
      vectorCandidateRepo,
      vectorRoleRepo,
      vectorRoleCandidate,
      evidenceDensity,
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
          pickReviewPr(db, winnerRepoId, candidateVec),
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
            vectorCandidateRepo: tailoredWinner.cosine,
            vectorRoleRepo,
            vectorRoleCandidate,
            evidenceDensity,
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

  // Step 12: Persist profile sections for dynamic frontend rendering
  try {
    const dims = triangulated.dimensions as Record<string, number>;
    const matchData = {
      score: triangulated.triangulated_score,
      dimensions: {
        skillCoverage: dims.skill_coverage ?? 0,
        semanticSimilarity: dims.semantic_similarity ?? 0,
        situationFit: dims.situation_fit ?? 0,
        roleAlignment: dims.role_alignment ?? 0,
      },
      reasoning: winnerSituation
        ? {
            matches: winnerSituation.reasoning.matches,
            mismatches: winnerSituation.reasoning.mismatches,
          }
        : undefined,
      philosophy,
      repoName: winnerRepoUrl ? winnerRepoUrl.replace('https://github.com/', '') : undefined,
      repoUrl: winnerRepoUrl,
    };

    // Load decomposition result from candidate_nodes (resume-derived graph)
    // We don't have direct access to DecompositionResult here, so we build
    // sections from discovery result + match data only.
    const profileSections = buildProfileSections(null, discoveryResult, matchData, null);

    await db
      .prepare(
        `UPDATE candidate_ingestion
         SET profile_sections_json = ?1
         WHERE candidate_id = ?2`,
      )
      .bind(JSON.stringify(profileSections), candidateId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestion] failed to persist profile sections for ${candidateId}:`, msg);
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

// ─── Telemetry helpers ──────────────────────────────────────────────────────

async function setCurrentStep(
  db: D1Database,
  candidateId: string,
  stepName: string,
): Promise<void> {
  await db
    .prepare(`UPDATE candidate_ingestion SET current_step = ?1 WHERE candidate_id = ?2`)
    .bind(stepName, candidateId)
    .run();
}

async function setEstimatedCompletion(
  db: D1Database,
  candidateId: string,
  estimatedAt: Date,
): Promise<void> {
  await db
    .prepare(
      `UPDATE candidate_ingestion SET estimated_completion_at = ?1 WHERE candidate_id = ?2`,
    )
    .bind(estimatedAt.toISOString(), candidateId)
    .run();
}

async function markIngestionFailedWithStep(
  db: D1Database,
  candidateId: string,
  reason: string,
  stepName: string,
): Promise<void> {
  await markIngestionFailed(db, candidateId, reason);
  await setCurrentStep(db, candidateId, stepName);
}

async function trackStep<T>(
  db: D1Database,
  candidateId: string,
  stepName: string,
  fn: () => Promise<T>,
): Promise<T> {
  await setCurrentStep(db, candidateId, stepName);
  const start = Date.now();
  try {
    const result = await fn();
    await recordStepDuration(db, stepName, Date.now() - start, candidateId);
    return result;
  } catch (err) {
    await recordStepDuration(db, stepName, Date.now() - start, candidateId);
    throw err;
  }
}

// ─── Discovery result reloader ───────────────────────────────────────────────

/**
 * Reconstruct a CandidateDiscoveryResult from the D1 row written by
 * persistCandidateProfile. Used by the post-screener pipeline when the
 * original discovery result object is no longer in scope.
 */
export async function loadDiscoveryResultFromDb(
  db: D1Database,
  candidateId: string,
): Promise<CandidateDiscoveryResult | null> {
  const row = await db
    .prepare(
      `SELECT candidate_searchable_profile, key_concepts_json, career_context_json,
              situation_signature_json, profile_version, model_used
         FROM candidate_ingestion
        WHERE candidate_id = ?1`,
    )
    .bind(candidateId)
    .first<{
      candidate_searchable_profile: string | null;
      key_concepts_json: string | null;
      career_context_json: string | null;
      situation_signature_json: string | null;
      profile_version: string | null;
      model_used: string | null;
    }>();

  if (!row || !row.candidate_searchable_profile) {
    return null;
  }

  function safeJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  return {
    candidateSearchableProfile: row.candidate_searchable_profile,
    keyConcepts: safeJson(row.key_concepts_json, {
      mustHaveSkills: [],
      niceToHaveSkills: [],
      seniority: 'mid' as const,
      primary_language: '',
      detected_domain: '',
    }),
    careerContext: safeJson(row.career_context_json, {
      company_stages: [],
      company_size_exposure: [],
      tenure_pattern: 'unknown' as const,
      progression_velocity: 'unknown' as const,
      ownership_depth: 'unknown' as const,
      system_scale_exposure: [],
      greenfield_ratio: 0,
    }),
    situationSignature: safeJson(row.situation_signature_json, {
      primary_challenge_types: [],
      architecture_exposure: [],
      test_culture_exposure: '',
      review_culture: '',
      impact_signals: [],
    }),
    profileVersion: row.profile_version ?? 'unknown',
    modelUsed: row.model_used ?? 'unknown',
    rawText: '',
  };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function cryptoRandomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
