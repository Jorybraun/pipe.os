/**
 * Candidate Ingestion Orchestrator — runs the full meaning-based pipeline
 * on resume upload.
 *
 * Sequence:
 *   1. upsertPendingIngestion
 *   2. discoverCandidateProfile (rich extraction)
 *   3. persistRichCandidateProfile
 *   4. embedAndUpsertCandidate (self-persists status + embedding to D1 when db passed)
 *   5. matchRepos (catalog query — legacy Vectorize path removed)
 *   6. Load role_repo_alignment for pipeline's role_context
 *   7. Pick PR + issue for winner repo
 *   8. Build placeholder triangulated result
 *   9. Write candidate_challenge_assignment rows
 *   10. markIngestionMatched
 *
 * Every step after (2) is wrapped in its own try/catch. Failures write
 * markIngestionFailed and return without throwing — the upload route must
 * not fail because ingestion failed.
 *
 * See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.
 */

import type { Env } from '../../types';
import type { ParsedCV } from '../cvParser';
import type { DecompositionResult } from './candidateDecompositionPrompt';
import { createCandidateAgentProvider } from '../llm/createProvider';
import { pickImplementationIssue } from '../match/autoStageBuilder';
import { matchRepos, type MatchRequest } from '../repoDiscovery/matchRepos';
import { matchCandidateToReviewChallenge } from '../challengeMatching/d1Matcher';
import { loadRoleChallengeSemantics } from '../challengeMatching/roleGuardrails';
import {
  buildSourceBackedCandidateDiscoveryFallback,
  discoverCandidateProfile,
  type CandidateDiscoveryResult,
} from './agent';
import { embedAndUpsertCandidate, upsertCandidateVector } from './embed';
import {
  upsertPendingIngestion,
  persistCandidateProfile,
  markIngestionMatched,
  markIngestionFailed,
  upsertCandidateChallengeAssignment,
  upsertCandidateRepoMatches,
  type MarkIngestionMatchedInput,
} from './persist';
// candidateSituationFit removed — simplified matching path post-Neo4j cutover
import { cosineSimilarity, parseEmbeddingJson, meanPoolVectors } from '../embedding/cosine';
import { getActiveCandidateNodesWithFallback } from './candidateNodes';
import { decomposeResumeToGraph } from './resumeDecomposition';
// computeRecencyMultiplier removed — simplified matching path post-Neo4j cutover
import { computeCandidateCoverageWithFallback } from '../neo4j/candidateGraphQueries';
import { buildNeo4jConfig, getNeo4jDriver } from '../neo4j/driver';
import { buildProfileSections } from './buildProfileSections';
import { recordStepDuration, estimateCompletion } from '../telemetry/stepDurationTracker';
import { recordSessionEvent } from '../telemetry/sessionEvents';

export interface IngestionInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  parsed: ParsedCV;
  resumeText: string;
  decompositionResult?: DecompositionResult | null;
  afterSourceBackedEvidence?: () => Promise<void>;
  maxNodeEmbeddings?: number;
  skipPostDecompositionMaintenance?: boolean;
}

const CANDIDATE_DISCOVERY_AI_TIMEOUT_MS = 12_000;

function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
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

  // Step 1.5: Decompose resume into candidate_nodes (ADR-041 Phase 1).
  // This must run before LLM-only discovery so standalone CODE_REVIEW matching
  // still has source-backed candidate evidence when a profile/model provider is
  // unavailable or slow.
  let decompositionEmbeddings: number[][] = [];
  let sourceBackedEvidenceHandled = false;
  const triggerAfterSourceBackedEvidence = async (): Promise<void> => {
    if (sourceBackedEvidenceHandled || !input.afterSourceBackedEvidence) return;
    sourceBackedEvidenceHandled = true;
    await input.afterSourceBackedEvidence();
  };
  try {
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'ingestion',
      candidateId,
      eventType: 'decomposition_started',
      payload: { resumeTextLength: resumeText.length },
    });
    const decompResult = await trackStep(db, candidateId, 'decompose_resume', () =>
      decomposeResumeToGraph({
        db,
        candidateId,
        resumeText,
        parsedCV: parsed,
        env,
        decompositionResult: input.decompositionResult,
        afterSourceBackedEvidence: triggerAfterSourceBackedEvidence,
        maxNodeEmbeddings: input.maxNodeEmbeddings,
        skipPostDecompositionMaintenance: input.skipPostDecompositionMaintenance,
      }),
    );
    decompositionEmbeddings = decompResult.embeddings;
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'ingestion',
      candidateId,
      eventType: 'decomposition_complete',
      payload: {
        nodeCount: decompResult.nodesInserted,
        embeddedNodeCount: decompResult.nodesEmbedded,
      },
    });
    try {
      await triggerAfterSourceBackedEvidence();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ingestion] afterSourceBackedEvidence failed:', msg);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ingestion] resumeDecomposition failed (non-blocking):', msg);
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'ingestion',
      candidateId,
      eventType: 'error',
      payload: { step: 'decompose_resume', error: msg },
    });
  }

  // Step 2: Discover rich candidate profile
  let discoveryResult: CandidateDiscoveryResult;
  try {
    const provider = createCandidateAgentProvider(env);
    if (!provider) {
      discoveryResult = await trackStep(db, candidateId, 'discover_profile', async () =>
        buildSourceBackedCandidateDiscoveryFallback({
          parsed,
          resumeText,
          reason: 'Candidate agent provider unavailable (MOCK_AI or missing config)',
        }),
      );
    } else {
      try {
        discoveryResult = await trackStep(db, candidateId, 'discover_profile', () =>
          Promise.race([
            discoverCandidateProfile({ provider, parsed, resumeText }),
            timeoutAfter(CANDIDATE_DISCOVERY_AI_TIMEOUT_MS, 'Candidate Discovery AI'),
          ]),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ingestion] discoverCandidateProfile failed:', msg);
        discoveryResult = buildSourceBackedCandidateDiscoveryFallback({
          parsed,
          resumeText,
          reason: `Candidate Discovery AI failed: ${msg}`,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] source-backed candidate discovery fallback failed:', msg);
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

  // Step 4: Embed into CANDIDATE_INDEX
  // Primary: aggregate sub-element embeddings (mean pool + L2 norm).
  // Fallback: embed the prose profile directly if decomposition yielded no vectors.
  let embedResult: Awaited<ReturnType<typeof embedAndUpsertCandidate>>;
  try {
    embedResult = await trackStep(db, candidateId, 'embed_profile', async () => {
      const aggregateVector = meanPoolVectors(decompositionEmbeddings);
      const evidenceMetadata = {
        ...(discoveryResult.keyConcepts.seniority
          ? { seniority: discoveryResult.keyConcepts.seniority }
          : {}),
        ...(discoveryResult.keyConcepts.primary_language
          ? { primary_language: discoveryResult.keyConcepts.primary_language }
          : {}),
        profile_version: discoveryResult.profileVersion,
      };
      if (aggregateVector) {
        const result = await upsertCandidateVector({
          vectorize: env.CANDIDATE_INDEX,
          candidateId,
          vector: aggregateVector,
          metadata: {
            ...evidenceMetadata,
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
          metadata: evidenceMetadata,
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
  // Skip when candidate has no pipeline (talent pool / standalone invite).
  const candidatePipelineRow = await db
    .prepare('SELECT pipeline_id FROM candidates WHERE id = ?1')
    .bind(candidateId)
    .first<{ pipeline_id: string | null }>();

  if (!candidatePipelineRow?.pipeline_id) {
    // Standalone candidate — ingestion stops at "embedded" (searchable in talent pool).
    console.log('[ingestion] No pipeline for candidate', candidateId, '— skipping match/assign');
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'ingestion',
      candidateId,
      eventType: 'completed',
      payload: { step: 'embedded_no_pipeline', reason: 'talent_pool_only' },
    });
    return;
  }

  try {
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'matching',
      candidateId,
      eventType: 'match_assigned',
      payload: { step: 'match_and_assign_start' },
    });
    await trackStep(db, candidateId, 'match_and_assign', () =>
      runMatchAndAssign({ env, db, candidateId, discoveryResult }),
    );
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'matching',
      candidateId,
      eventType: 'completed',
      payload: { step: 'match_and_assign_success' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingestion] runMatchAndAssign failed:', msg);
    await markIngestionFailedWithStep(db, candidateId, `Match/assign failed: ${msg}`, 'match_and_assign');
    await recordSessionEvent(db, {
      sessionId: `ingestion-${candidateId}`,
      sessionType: 'matching',
      candidateId,
      eventType: 'error',
      payload: { step: 'match_and_assign', error: msg },
    });
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

  // Neo4j driver for graph reads (fallback to D1 if unavailable)
  const neo4jConfig = buildNeo4jConfig(env);
  const neo4jDriver = neo4jConfig ? getNeo4jDriver(neo4jConfig) : null;

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

  // Step 6: Simple repo matching via catalog query (legacy Vectorize path removed)
  const seniorityRaw = discoveryResult.keyConcepts.seniority;
  const candidateSeniority = seniorityRaw
    && ['junior', 'mid', 'senior', 'staff'].includes(seniorityRaw)
    ? (seniorityRaw as 'junior' | 'mid' | 'senior' | 'staff')
    : undefined;
  const primaryLanguage = discoveryResult.keyConcepts.primary_language?.trim().toLowerCase();
  const domain = discoveryResult.keyConcepts.detected_domain?.trim().toLowerCase();

  const matchRequest: MatchRequest = {
    mustHaveSkills: discoveryResult.keyConcepts.mustHaveSkills,
    niceToHaveSkills: discoveryResult.keyConcepts.niceToHaveSkills,
    seniority: candidateSeniority,
    domain: domain && domain !== 'general' && domain !== 'unknown' ? domain : undefined,
    primaryLanguage:
      primaryLanguage && primaryLanguage !== 'unknown' ? primaryLanguage : undefined,
    limit: 10,
  };

  const matchedRepos = await matchRepos(db, matchRequest);

  // Step 7: Load role_repo_alignment for pipeline's role_context
  const roleContextRow = await db
    .prepare(
      `SELECT id, rcd_version, rcd_json, job_description_md, non_negotiable_skills_json
         FROM role_contexts
        WHERE pipeline_id = ?1
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .bind(pipelineId)
    .first<{
      id: string;
      rcd_version: string | null;
      rcd_json: string | null;
      job_description_md: string | null;
      non_negotiable_skills_json: string | null;
    }>();

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

    if (roleVec) {
      try {
        const [repoQuery, candidateQuery] = await Promise.all([
          env.REPO_INDEX.query(roleVec, { topK: 20 }),
          env.CANDIDATE_INDEX.query(roleVec, { topK: 20 }),
        ]);
        const catalogWinner = matchedRepos[0];
        if (catalogWinner) {
          const repoMatch = repoQuery.matches.find((m) => m.id === `repo_${catalogWinner.id}`);
          if (repoMatch) {
            vectorRoleRepo = repoMatch.score;
          }
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

  // Step 8: Select a source-backed PR from the living candidate graph.
  const roleSemantics = roleContextRow
    ? await loadRoleChallengeSemantics(db, roleContextRow)
    : null;
  const reviewMatch = await matchCandidateToReviewChallenge(db, candidateId, {
    roleContextId: roleContextRow?.id,
    roleSnapshotId: roleSemantics?.roleSnapshotId,
    roleConcepts: roleSemantics?.relevantConcepts,
    requiredConcepts: roleSemantics?.requiredConcepts,
    conceptResolverVersion: roleSemantics?.resolverVersion,
    roleSourceReferences: roleSemantics?.sources.map((source) => ({
      entityId: source.roleNodeId,
      locator: source.sourceSection ?? 'role_context',
      conceptKeys: source.conceptKeys,
    })),
  });
  if (
    reviewMatch.status !== 'MATCHED'
    || !reviewMatch.repoId
    || !reviewMatch.prNumber
    || !reviewMatch.explanation
  ) {
    throw new Error(`Deterministic challenge matcher returned ${reviewMatch.status}`);
  }

  const winnerRepoId = reviewMatch.repoId;
  const winnerRepo = await db.prepare(
    `SELECT github_url FROM qualified_repos WHERE id = ?1`,
  ).bind(winnerRepoId).first<{ github_url: string | null }>();
  if (!winnerRepo?.github_url) {
    throw new Error(`Matched challenge repository ${winnerRepoId} is unavailable`);
  }
  const winnerRepoUrl = winnerRepo.github_url;
  const winnerReview = { prNumber: reviewMatch.prNumber };
  const winnerImplementation = await pickImplementationIssue(
    db,
    winnerRepoId,
    candidateSeniority,
    roleSemantics?.relevantConcepts,
  );
  const catalogWinner = matchedRepos.find((repo) => repo.id === winnerRepoId);

  // Step 9: Persist only measured match signals.
  const triangulated = {
    repo_id: winnerRepoId,
    triangulated_score: reviewMatch.explanation.score,
    dimensions: {
      challenge_alignment: reviewMatch.explanation.score,
      ...(roleCandidateCosine !== null ? { role_candidate_cosine: roleCandidateCosine } : {}),
    },
    raw_signals: {
      role_repo_alignment: roleRepoAlignments.get(winnerRepoId) ?? null,
      candidate_repo_fit: catalogWinner?.score ?? null,
      role_candidate_cosine: roleCandidateCosine,
      vector_role_repo: vectorRoleRepo,
      vector_cand_repo: null,
      vector_role_cand: vectorRoleCandidate,
    },
  };

  // Empty situation rankings (legacy candidateSituationFit removed)
  const situationRankings = { rankings: [] as Array<never>, rawText: '' };

  // Step 9.5: Recompute open-concept coverage for evidence density.
  let evidenceDensity: number | null = null;
  try {
    const coverage = await computeCandidateCoverageWithFallback(
      db,
      candidateId,
      neo4jDriver,
    );
    evidenceDensity = coverage.overallScore;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestion] failed to compute coverage for ${candidateId}:`, msg);
  }

  const reasoningJson = JSON.stringify(reviewMatch.explanation);

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

      try {
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[ingestion] FK violation writing candidate_challenge_assignment: ` +
          `candidate=${candidateId} stage=${stage.stage_id} challenge=${stage.challenge_id} repo=${winnerRepoId} ` +
          `error=${msg}`,
        );
        throw new Error(
          `candidate_challenge_assignment insert failed for candidate=${candidateId} ` +
          `stage=${stage.stage_id} repo=${winnerRepoId}: ${msg}`,
        );
      }
    }
  }

  // Step 11: Mark matched with full score payload
  try {
    const matchedInput: MarkIngestionMatchedInput = {
      candidateId,
      matchedRepoId: winnerRepoId,
      triangulatedScore: triangulated.triangulated_score,
      dimensionsJson: JSON.stringify(triangulated.dimensions),
      reasoningJson,
      matchPhilosophy: philosophy,
    };
    await markIngestionMatched(db, matchedInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ingestion] FK violation writing candidate_ingestion: ` +
      `candidate=${candidateId} matched_repo_id=${winnerRepoId} error=${msg}`,
    );
    throw new Error(
      `markIngestionMatched failed for candidate=${candidateId} repo=${winnerRepoId}: ${msg}`,
    );
  }

  // Step 11b: Persist top-3 repo matches for recruiter visibility
  try {
    // Extract location from candidate Context nodes
    let locationTag: string | null = null;
    const contextNodes = await getActiveCandidateNodesWithFallback(db, candidateId, neo4jDriver, 'Context');
    for (const node of contextNodes) {
      const props = node.extracted_properties_json
        ? (JSON.parse(node.extracted_properties_json) as Record<string, unknown>)
        : {};
      if (props.subtype === 'location' && typeof props.value === 'string') {
        locationTag = props.value;
        break;
      }
      if (props.subtype === 'location' && typeof props.location === 'string') {
        locationTag = props.location;
        break;
      }
    }

    const alternatives = matchedRepos
      .filter((repo) => repo.id !== winnerRepoId)
      .slice(0, 2);
    const matchRows = [
      {
        id: cryptoRandomId(),
        candidateId,
        repoId: winnerRepoId,
        rank: 1,
        triangulatedScore: reviewMatch.explanation.score,
        rationale: reasoningJson,
        prNumber: winnerReview.prNumber,
        issueNumber: winnerImplementation?.issueNumber ?? null,
        locationTag,
      },
      ...alternatives.map((repo, index) => ({
        id: cryptoRandomId(),
        candidateId,
        repoId: repo.id,
        rank: index + 2,
        triangulatedScore: repo.score,
        rationale: null,
        prNumber: null,
        issueNumber: null,
        locationTag,
      })),
    ];

    await upsertCandidateRepoMatches(db, matchRows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ingestion] FK violation writing candidate_repo_matches: ` +
      `candidate=${candidateId} repos=[${matchedRepos.slice(0, 3).map(r => r.id).join(',')}] error=${msg}`,
    );
    // Non-blocking: recruiter visibility only
    console.warn(`[ingestion] failed to persist top-3 repo matches for ${candidateId}:`, msg);
  }

  // Step 12: Persist profile sections for dynamic frontend rendering
  try {
    const matchData = {
      score: triangulated.triangulated_score,
      dimensions: undefined,
      reasoning: undefined,
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
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE candidate_ingestion SET current_step = ?1, updated_at = ?2 WHERE candidate_id = ?3`)
    .bind(stepName, now, candidateId)
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
      seniority: null,
      primary_language: null,
      detected_domain: null,
    }),
    careerContext: safeJson(row.career_context_json, {
      company_stages: [],
      company_size_exposure: [],
      tenure_pattern: 'unknown' as const,
      progression_velocity: 'unknown' as const,
      ownership_depth: 'unknown' as const,
      system_scale_exposure: [],
      greenfield_ratio: null,
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
