/**
 * RPC routes — Phase 3 Candidate Flow
 *
 * Candidate-facing routes authenticated via custom JWT session tokens.
 * No Clerk. No sign-in required.
 *
 * Routes:
 *   POST /rpc/resolve-token      — Public: validate invite token, issue JWT
 *   POST /rpc/start-assessment   — Candidate JWT: claim one-use invite token on first real start
 *   POST /rpc/get-stage-config   — Candidate JWT: return current stage metadata
 *   POST /rpc/get-challenge      — Candidate JWT: return challenge content by order
 *   POST /rpc/refresh-session    — Public: reissue JWT from expired token
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { signJwt, verifyJwt } from '../lib/jwt';
import { candidateAuth, type CandidateVariables } from '../middleware/candidateAuth';
import { review } from './assessment/review';
import { repo } from './assessment/repo';
import { devContainer, devContainerProxyPublic } from './assessment/devContainer';
import { fetchGitHubDiff } from '../lib/fetchGitHubDiff';
import { cultureCandidate } from './screening/culture';
import { scoreImplementationSubmission } from '../lib/implementationScorer/implementationScorer';
import { processResumeFromR2 } from '../lib/enrichment/resumeIngestion';
import { buildRuleBasedParsedCV, persistParsedCV } from '../lib/cvParser';
import { runCandidateIngestion } from '../lib/candidateDiscovery/orchestrate';
import type { Env } from '../types';
import { matchReposForCandidateNeo4j } from '../lib/neo4j/matchingQueries';
import { matchReposByGroundedEdges } from '../lib/neo4j/contextualGraph';
import { matchRepos } from '../lib/repoDiscovery/matchRepos';
import {
  pickImplementationIssue,
  buildMatchRequest,
  matchImplementationReposByRoleConcepts,
} from '../lib/match/autoStageBuilder';
import { upsertCandidateChallengeAssignment } from '../lib/candidateDiscovery/persist';
import { hasSourceBackedReviewPacket, loadSourceBackedReviewDiff } from '../lib/review/sourceBackedReviewDiff';
import { createNeo4jDriver, buildNeo4jConfig } from '../lib/neo4j/driver';
import {
  loadRoleChallengeSemantics,
  matchCandidateToReviewChallenge,
} from '../lib/challengeMatching';
import {
  candidateSafeQualityGateFor,
  type CandidateSafeQualityGateVerdict,
  type CandidateSafeMatchStatus,
} from '../lib/challengeMatching/candidateSafeQualityGate';
import type {
  CandidateReviewChallengeMatch,
  MatchExplanation,
  RoleSourceReference,
  SourceRef,
} from '../lib/challengeMatching';
import {
  STALE_WORKERS_AI_RETRY_REASON,
  maybeQueueRetryableStandaloneIngestion,
} from '../lib/candidateDiscovery/staleWorkersAiRetry';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentProgressSnapshot,
  type CommitSubmissionChangedFileStatus,
} from '../lib/repoTaskInterviewSession';
import type { JsonObject, JsonValue } from '../lib/livingContext';

// ─── Blocking gate for post-screener enrichment ─────────────────────────────

export interface WaitingChallenge {
  id: string;
  type: 'WAITING_FOR_MATCH';
  title: string;
  instructions: string;
  config: {
    autoRefresh: boolean;
    refreshIntervalSeconds: number;
    state?: 'pending' | 'blocked';
    reason?: string;
    diagnostics?: WaitingChallengeDiagnostics;
  };
}

interface WaitingChallengeDiagnostics {
  phase: 'candidate_evidence' | 'repo_matching';
  ingestionStatus?: string | null;
  currentStep?: string | null;
  matchableNodeCount?: number;
  rawNodeCount?: number;
  updatedAt?: string | null;
  estimatedCompletionAt?: string | null;
  staleAfterSeconds?: number;
  pipeline?: WaitingPipelineStep[];
}

type WaitingPipelineStepId =
  | 'intake'
  | 'decomposition'
  | 'repo_matching'
  | 'challenge'
  | 'review'
  | 'scoring';

type WaitingPipelineStepStatus = 'pending' | 'active' | 'complete' | 'blocked';

interface WaitingPipelineStep {
  id: WaitingPipelineStepId;
  label: string;
  status: WaitingPipelineStepStatus;
  detail?: string | null;
  updatedAt?: string | null;
}

interface GateResult {
  blocked: boolean;
  reason?: string;
  syntheticChallenge?: WaitingChallenge;
}

function waitingForMatch(
  reason: string,
  options: {
    terminal?: boolean;
    diagnostics?: WaitingChallengeDiagnostics;
  } = {},
): GateResult {
  const terminal = options.terminal === true;
  return {
    blocked: true,
    reason,
    syntheticChallenge: {
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
      title: terminal ? 'Challenge needs attention' : 'Building your personalized challenge',
      instructions: terminal
        ? reason
        : 'We are analyzing source-backed candidate evidence to find the best open-source project match.',
      config: {
        autoRefresh: !terminal,
        refreshIntervalSeconds: 30,
        state: terminal ? 'blocked' : 'pending',
        reason,
        diagnostics: options.diagnostics,
      },
    },
  };
}

async function checkMatchingGate(
  db: D1Database,
  candidateId: string,
  pipelineId: string,
  stageId: string,
  challengeId: string,
  nextChallengeType: string,
  env: Env,
): Promise<GateResult> {
  const isCodeStage = ['CODE_REVIEW', 'CODE_IMPLEMENTATION'].includes(nextChallengeType);
  if (!isCodeStage) {
    return { blocked: false };
  }

  const pipelineConfig = await db.prepare(
    `SELECT match_philosophy FROM pipeline_match_config WHERE pipeline_id = ?1`
  ).bind(pipelineId).first<{ match_philosophy: string | null }>();

  const isValidate = pipelineConfig?.match_philosophy === 'validate';
  if (isValidate) {
    return { blocked: false };
  }

  // 1. Check if assignment already exists for this candidate + stage
  const existingAssignment = await db.prepare(
    `SELECT id, github_repo_url, github_pr_number
       FROM candidate_challenge_assignment
      WHERE candidate_id = ?1 AND stage_id = ?2`,
  ).bind(candidateId, stageId).first<{
    id: string;
    github_repo_url: string | null;
    github_pr_number: number | null;
  }>();

  if (existingAssignment) {
    if (nextChallengeType !== 'CODE_REVIEW') {
      return { blocked: false };
    }
    if (
      existingAssignment.github_repo_url
      && existingAssignment.github_pr_number
      && await hasSourceBackedReviewPacket(
        db,
        existingAssignment.github_repo_url,
        existingAssignment.github_pr_number,
      )
    ) {
      return { blocked: false };
    }
    console.warn(
      `[checkMatchingGate] refreshing stale CODE_REVIEW assignment without source-backed graph context for candidate ${candidateId}`,
    );
  }

  if (nextChallengeType === 'CODE_REVIEW') {
    const roleContext = await db.prepare(
      `SELECT id, persona_json, rcd_json, job_description_md, non_negotiable_skills_json
         FROM role_contexts
        WHERE pipeline_id = ?1
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).bind(pipelineId).first<{
      id: string;
      persona_json: string | null;
      rcd_json: string | null;
      job_description_md: string | null;
      non_negotiable_skills_json: string | null;
    }>();
    if (!roleContext) {
      return waitingForMatch('Role context is not ready for deterministic challenge matching');
    }

    const roleSemantics = await loadRoleChallengeSemantics(db, {
      ...roleContext,
      rcd_version: (() => {
        if (!roleContext.rcd_json) return null;
        try {
          const parsed = JSON.parse(roleContext.rcd_json) as { rcd_version?: unknown };
          return typeof parsed.rcd_version === 'string' ? parsed.rcd_version : null;
        } catch {
          return null;
        }
      })(),
    });
    const match = await matchCandidateToReviewChallenge(db, candidateId, {
      roleContextId: roleContext.id,
      roleSnapshotId: roleSemantics.roleSnapshotId,
      roleConcepts: roleSemantics.relevantConcepts,
      requiredConcepts: roleSemantics.requiredConcepts,
      conceptResolverVersion: roleSemantics.resolverVersion,
      roleSourceReferences: roleSemantics.sources.map((source) => ({
        entityId: source.roleNodeId,
        locator: source.sourceSection ?? 'role_context',
        conceptKeys: source.conceptKeys,
        sourceRefType: source.sourceRefType,
        sourceRefId: source.sourceRefId,
        sourceSpanId: source.sourceSpanId,
        exactText: source.exactText,
        contentHash: source.contentHash,
      })),
    });
    if (match.status !== 'MATCHED' || !match.repoId || !match.prNumber) {
      const readiness = await standaloneReviewEvidenceReadiness(db, candidateId);
      return waitingForMatch(`Deterministic challenge matcher returned ${match.status}`, {
        terminal: true,
        diagnostics: diagnosticsForStandaloneReviewReadiness(readiness, {
          phase: 'repo_matching',
          repoMatchingStatus: 'blocked',
          repoMatchingDetail: `Deterministic challenge matcher returned ${match.status}`,
        }),
      });
    }

    const repo = await db.prepare(
      `SELECT github_url FROM qualified_repos WHERE id = ?1`,
    ).bind(match.repoId).first<{ github_url: string | null }>();
    if (!repo?.github_url) {
      const readiness = await standaloneReviewEvidenceReadiness(db, candidateId);
      return waitingForMatch('Matched challenge repository is unavailable', {
        terminal: true,
        diagnostics: diagnosticsForStandaloneReviewReadiness(readiness, {
          phase: 'repo_matching',
          repoMatchingStatus: 'blocked',
          repoMatchingDetail: 'Matched challenge repository is unavailable',
        }),
      });
    }

    await upsertCandidateChallengeAssignment(db, {
      id: crypto.randomUUID(),
      candidateId,
      stageId,
      challengeId,
      repoId: match.repoId,
      githubRepoUrl: repo.github_url,
      githubPrNumber: match.prNumber,
      issueNumber: null,
    });
    return { blocked: false };
  }

  // CODE_REVIEW returns above through matchCandidateToReviewChallenge. From
  // here down, repo recall is only for CODE_IMPLEMENTATION issue selection;
  // Neo4j projections must not become candidate-to-PR authority.
  if (nextChallengeType !== 'CODE_IMPLEMENTATION') {
    return waitingForMatch(`Unsupported code challenge type ${nextChallengeType}`);
  }

  const roleContext = await db.prepare(
    `SELECT id, persona_json, rcd_json, job_description_md, non_negotiable_skills_json
       FROM role_contexts
      WHERE pipeline_id = ?1
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(pipelineId).first<{
    id: string;
    persona_json: string | null;
    rcd_json: string | null;
    job_description_md: string | null;
    non_negotiable_skills_json: string | null;
  }>();
  const roleSemantics = roleContext
    ? await loadRoleChallengeSemantics(db, {
      ...roleContext,
      rcd_version: (() => {
        if (!roleContext.rcd_json) return null;
        try {
          const parsed = JSON.parse(roleContext.rcd_json) as { rcd_version?: unknown };
          return typeof parsed.rcd_version === 'string' ? parsed.rcd_version : null;
        } catch {
          return null;
        }
      })(),
    })
    : null;
  const roleConcepts = roleSemantics?.relevantConcepts ?? [];
  const requiredConcepts = roleSemantics?.requiredConcepts ?? [];

  // 2. No assignment — use source-backed implementation issue context first.
  let repoId: number | null = null;
  let githubRepoUrl: string | null = null;

  if (roleConcepts.length > 0) {
    try {
      const contextMatches = await matchImplementationReposByRoleConcepts(
        db,
        roleConcepts,
        requiredConcepts,
        5,
      );
      const top = contextMatches[0];
      if (top) {
        repoId = top.id;
        githubRepoUrl = top.githubUrl;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[checkMatchingGate] source-backed implementation matching failed for candidate ${candidateId}:`, msg);
    }
    if (!repoId) {
      return waitingForMatch('No source-backed implementation repo matched role evidence');
    }
  } else {
    // Compatibility path for legacy pipelines with no source-backed role context.
    const primaryStore = env.PRIMARY_MATCH_STORE ?? 'neo4j';
    if (primaryStore === 'neo4j') {
      let neo4jConfig = buildNeo4jConfig(env);
      if (!neo4jConfig) {
        neo4jConfig = { uri: 'bolt://localhost:7687', user: 'neo4j', password: 'pipe-local-dev' };
      }

      let driver;
      try {
        driver = createNeo4jDriver(neo4jConfig);
        // ADR-050: prefer grounded SIMILAR_TO edge traversal (multi-region
        // structural overlap); fall back to cosine ranking when the candidate
        // has no grounded edges yet.
        const groundedResults = await matchReposByGroundedEdges(driver, candidateId, { topK: 5 });
        if (groundedResults.length > 0) {
          const top = groundedResults[0]!;
          repoId = top.repoId;
          githubRepoUrl = `https://github.com/${top.fullName}`;
        } else {
          const neo4jResults = await matchReposForCandidateNeo4j(driver, candidateId, { topK: 5 });
          if (neo4jResults.length > 0) {
            const top = neo4jResults[0]!;
            repoId = top.repo_id;
            githubRepoUrl = `https://github.com/${top.full_name}`;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[checkMatchingGate] Neo4j matching failed for candidate ${candidateId}:`, msg);
      } finally {
        if (driver) {
          try {
            await driver.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }

    // Fallback to D1 SQL matcher if Neo4j returned nothing or failed.
    if (!repoId && roleContext) {
      try {
        const matchRequest = buildMatchRequest(roleContext as any);
        const d1Results = await matchRepos(db, matchRequest);
        if (d1Results.length > 0) {
          const top = d1Results[0]!;
          repoId = top.id;
          githubRepoUrl = top.githubUrl;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[checkMatchingGate] D1 fallback matching failed for candidate ${candidateId}:`, msg);
      }
    }
  }

  if (!repoId || !githubRepoUrl) {
    return waitingForMatch('No matching repos found for candidate');
  }

  // 3. Pick challenge content based on type
  let prNumber: number | null = null;
  let issueNumber: number | null = null;

  const issueResult = await pickImplementationIssue(
    db,
    repoId,
    undefined,
    roleConcepts,
  );
  if (!issueResult) {
    return waitingForMatch('No eligible implementation issue found for matched repo');
  }
  issueNumber = issueResult.issueNumber;

  // 4. Write assignment
  const assignmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO candidate_challenge_assignment
       (id, candidate_id, stage_id, challenge_id, repo_id, github_repo_url, github_pr_number, issue_number)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(assignmentId, candidateId, stageId, challengeId, repoId, githubRepoUrl, prNumber, issueNumber).run();

  return { blocked: false };
}

// ─── Standalone CV intake & code review ─────────────────────────────────────

const INTAKE_CHALLENGE_CONTENT = {
  id: 'intake-upload',
  type: 'INTAKE',
  title: 'Upload Your CV',
  instructions: 'Please upload your CV/resume so we can learn more about your background.',
  config: JSON.stringify({ acceptedFormats: ['pdf', 'docx', 'doc'], maxSizeMb: 10 }),
};

function profileReceivedChallengeContent(): {
  id: string;
  type: 'PROFILE_RECEIVED';
  title: string;
  instructions: string;
  config: Record<string, never>;
} {
  return {
    id: 'profile-received',
    type: 'PROFILE_RECEIVED',
    title: 'Profile received',
    instructions: 'Your profile has been received. PIPE will email you when your code review is ready.',
    config: {},
  };
}

function standaloneWaitingChallenge(options: {
  title?: string;
  instructions?: string;
  state?: 'pending' | 'blocked';
  reason?: string | null;
  autoRefresh?: boolean;
  diagnostics?: WaitingChallengeDiagnostics;
} = {}): WaitingChallenge {
  const state = options.state ?? 'pending';
  return {
    id: 'waiting-for-match',
    type: 'WAITING_FOR_MATCH',
    title: options.title ?? (state === 'blocked'
      ? 'Challenge needs attention'
      : 'Building your personalized challenge'),
    instructions: options.instructions ?? (state === 'blocked'
      ? 'We could not select a source-backed repo challenge from the available evidence. Please contact your recruiter so they can refresh the invite or add candidate evidence.'
      : 'We are analyzing your profile to find the best open-source project match.'),
    config: {
      autoRefresh: options.autoRefresh ?? state !== 'blocked',
      refreshIntervalSeconds: 30,
      state,
      reason: options.reason ?? undefined,
      diagnostics: options.diagnostics,
    },
  };
}

function candidateIntakeQueuedComplete(stageTitle = 'Profile received'): {
  isComplete: true;
  stageId: string;
  stageTitle: string;
  mode: 'INTAKE';
  timeLimit: null;
  challenges: [];
  currentIndex: 0;
  message: string;
} {
  return {
    isComplete: true,
    stageId: 'candidate-intake-queued',
    stageTitle,
    mode: 'INTAKE',
    timeLimit: null,
    challenges: [],
    currentIndex: 0,
    message: 'Your profile has been received. PIPE will email you when your code review is ready.',
  };
}

export function waitingStageConfigForGate(input: {
  candidateId: string;
  stageId: string;
  stageTitle: string;
  stageMode: string | null;
  timeLimit: number | null;
  waitingChallenge: WaitingChallenge;
}): {
  isComplete: false;
  stageId: string;
  candidateId: string;
  stageTitle: string;
  mode: string;
  timeLimit: number | null;
  challenges: Array<{ type: string; order: number; title: string }>;
  currentIndex: 0;
} {
  const challenges: Array<{ type: string; order: number; title: string }> = [
    { type: 'WELCOME', order: 0, title: 'Welcome' },
  ];
  if (input.stageMode === 'LIVE_VIDEO') {
    challenges.push({ type: 'LIVE_VIDEO', order: challenges.length, title: 'Video Interview' });
  }
  challenges.push({
    type: input.waitingChallenge.type,
    order: challenges.length,
    title: input.waitingChallenge.title,
  });

  return {
    isComplete: false,
    stageId: input.stageId,
    candidateId: input.candidateId,
    stageTitle: input.stageTitle,
    mode: input.stageMode ?? 'ASYNC',
    timeLimit: input.timeLimit,
    challenges,
    currentIndex: 0,
  };
}

function standaloneWaitingChallengeForReadiness(
  readiness: StandaloneReviewEvidenceReadiness,
): WaitingChallenge {
  const diagnostics = diagnosticsForStandaloneReviewReadiness(readiness);
  if (readiness.terminal) {
    return standaloneWaitingChallenge({
      state: 'blocked',
      autoRefresh: false,
      reason: readiness.reason,
      diagnostics,
      instructions: readiness.reason
        ?? 'Candidate evidence ingestion failed before a source-backed repo challenge could be selected.',
    });
  }
  return standaloneWaitingChallenge({
    state: 'pending',
    reason: readiness.reason,
    diagnostics,
  });
}

function diagnosticsForStandaloneReviewReadiness(
  readiness: StandaloneReviewEvidenceReadiness,
  options: {
    phase?: 'candidate_evidence' | 'repo_matching';
    repoMatchingStatus?: WaitingPipelineStepStatus;
    repoMatchingDetail?: string | null;
  } = {},
): WaitingChallengeDiagnostics {
  const phase = options.phase ?? 'candidate_evidence';
  return {
    phase,
    ingestionStatus: readiness.status,
    currentStep: readiness.currentStep,
    matchableNodeCount: readiness.nodeCount,
    rawNodeCount: readiness.rawNodeCount,
    updatedAt: readiness.updatedAt,
    estimatedCompletionAt: readiness.estimatedCompletionAt,
    staleAfterSeconds: STANDALONE_EVIDENCE_STALE_AFTER_MS / 1000,
    pipeline: standaloneCodeReviewPipeline(readiness, {
      phase,
      repoMatchingStatus: options.repoMatchingStatus,
      repoMatchingDetail: options.repoMatchingDetail,
    }),
  };
}

function standaloneCodeReviewPipeline(
  readiness: StandaloneReviewEvidenceReadiness,
  options: {
    phase: 'candidate_evidence' | 'repo_matching';
    repoMatchingStatus?: WaitingPipelineStepStatus;
    repoMatchingDetail?: string | null;
  },
): WaitingPipelineStep[] {
  const hasRawEvidence = readiness.rawNodeCount > 0;
  const hasMatchableEvidence = readiness.nodeCount > 0;
  const candidateEvidenceBlocked = readiness.terminal && !hasMatchableEvidence;
  const decompositionStatus: WaitingPipelineStepStatus = hasMatchableEvidence
    ? 'complete'
    : candidateEvidenceBlocked
      ? 'blocked'
      : 'active';
  const repoMatchingStatus: WaitingPipelineStepStatus = options.repoMatchingStatus
    ?? (options.phase === 'repo_matching'
      ? 'active'
      : hasMatchableEvidence
        ? 'active'
        : 'pending');

  return [
    {
      id: 'intake',
      label: 'CV intake',
      status: readiness.status || hasRawEvidence || hasMatchableEvidence ? 'complete' : 'active',
      detail: readiness.status,
      updatedAt: readiness.updatedAt,
    },
    {
      id: 'decomposition',
      label: 'Evidence decomposition',
      status: decompositionStatus,
      detail: readiness.currentStep,
      updatedAt: readiness.updatedAt,
    },
    {
      id: 'repo_matching',
      label: 'Repo matching',
      status: repoMatchingStatus,
      detail: options.repoMatchingDetail ?? null,
      updatedAt: readiness.updatedAt,
    },
    {
      id: 'challenge',
      label: 'Challenge assignment',
      status: 'pending',
    },
    {
      id: 'review',
      label: 'Candidate review',
      status: 'pending',
    },
    {
      id: 'scoring',
      label: 'Scoring',
      status: 'pending',
    },
  ];
}

function isInProgressStandaloneIngestionStatus(status: string | null): boolean {
  return status === 'pending'
    || status === 'profile_generated'
    || status === 'enriching';
}

function isCompletedStandaloneIngestionStatus(status: string | null): boolean {
  return status === 'embedded'
    || status === 'matched'
    || status === 'enriched';
}

function staleStandaloneEvidenceReason(
  currentStep: string | null,
  updatedAt: string | null,
): string {
  const step = currentStep ?? 'unknown step';
  const timestamp = updatedAt ?? 'unknown time';
  return `Candidate evidence ingestion stalled at ${step} without matchable source-backed evidence. Last update: ${timestamp}.`;
}

function standaloneEvidenceIsStale(status: string | null, updatedAt: string | null): boolean {
  if (!isInProgressStandaloneIngestionStatus(status) || !updatedAt) return false;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  return Date.now() - updatedMs >= STANDALONE_EVIDENCE_STALE_AFTER_MS;
}

const STANDALONE_REVIEW_CHALLENGE_CONFIG = {
  isMultiTurn: true,
  enableExplainer: false,
  enableFollowUp: true,
  implementerPersona: 'junior',
  maxRounds: 4,
};

const MATCHABLE_CANDIDATE_EVIDENCE_SQL = `
  cn.superseded_at IS NULL
  AND (
    cn.source_type IN (
      'resume',
      'github_enrichment',
      'automated_screener',
      'culture_interview',
      'culture_contextual',
      'code_review_session',
      'implementation_challenge'
    )
    OR cn.node_type = 'ReviewEvidence'
    OR (
      cn.source_type = 'meeting_session'
      AND cn.node_type NOT LIKE 'session_%'
    )
  )
`;

interface StandaloneReviewRow {
  id: string;
  status: string;
  created_at: string | null;
  matched_repo_id: number | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  submission_json: string | null;
}

interface StandaloneDevContainerRow {
  id: string;
  status: string;
  created_at: string | null;
  interview_type: 'DEV_CONTAINER_CHALLENGE' | 'OPEN_SOURCE_BUG_FIX';
  matched_repo_id: number | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  submission_json: string | null;
}

interface CandidateAssessmentSessionRow {
  id: string;
  mode: string;
  state: string;
}

interface CandidateAssessmentProgressPayload {
  mode: string;
  state: string;
  stage: AssessmentProgressSnapshot['stage'];
  nextAction: AssessmentProgressSnapshot['nextAction'];
  nextActionLabel: string;
  assignmentTrust: AssessmentProgressSnapshot['assignmentTrust'];
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasMessageEvidence: boolean;
  hasDevContainerEvidence: boolean;
  hasToolUsageEvidence: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  hasTestEvidence: boolean;
  hasVerificationGap: boolean;
  evidenceCounts: AssessmentProgressSnapshot['evidenceCounts'];
  sourceRefCounts: AssessmentProgressSnapshot['sourceRefCounts'];
  evidenceSnippets: AssessmentProgressSnapshot['evidenceSnippets'];
  challenge: {
    sourceRefType: string;
    evidenceRole: string;
    exactText: string;
    contentHash: string;
    locator: JsonObject;
  } | null;
  latestEvent: Omit<NonNullable<AssessmentProgressSnapshot['latestEvent']>, 'id'> | null;
  commit: Omit<NonNullable<AssessmentProgressSnapshot['commit']>, 'eventId'> | null;
  evaluation: Omit<NonNullable<AssessmentProgressSnapshot['evaluation']>, 'id'> | null;
}

const candidateAssessmentJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(candidateAssessmentJsonValueSchema),
  z.record(candidateAssessmentJsonValueSchema),
]));
const candidateAssessmentJsonObjectSchema: z.ZodType<JsonObject> = z.record(candidateAssessmentJsonValueSchema);

const candidateAssessmentSourceRefSchema = z.object({
  sourceRefType: z.string().trim().min(1),
  sourceRefId: z.string().trim().min(1),
  sourceSpanId: z.string().trim().min(1).nullable().optional(),
  evidenceRole: z.string().trim().min(1).optional(),
  locator: candidateAssessmentJsonObjectSchema.optional(),
  exactText: z.string().min(1),
  contentHash: z.string().trim().min(1),
  metadata: candidateAssessmentJsonObjectSchema.optional(),
});

const candidateCommitChangedFileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
] satisfies [CommitSubmissionChangedFileStatus, ...CommitSubmissionChangedFileStatus[]]);

const candidateCommitChangedFileSchema = z.object({
  path: z.string().trim().min(1),
  status: candidateCommitChangedFileStatusSchema,
  previousPath: z.string().trim().min(1).nullable().optional(),
  additions: z.number().int().min(0).nullable().optional(),
  deletions: z.number().int().min(0).nullable().optional(),
});

const candidateCommitSubmissionSchema = z.object({
  narrative: z.string().trim().min(1),
  repositoryUrl: z.string().trim().min(1),
  forkRepositoryUrl: z.string().trim().min(1).nullable().optional(),
  branchName: z.string().trim().min(1),
  baseCommitSha: z.string().trim().min(1),
  commitSha: z.string().trim().min(1),
  commitUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPullRequestUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPrConsent: z.boolean().optional(),
  changedFiles: z.array(candidateCommitChangedFileSchema).min(1),
  occurredAt: z.string().trim().min(1).nullable().optional(),
  sourceRefs: z.array(candidateAssessmentSourceRefSchema).min(2),
});

type CandidateSafeValidatorVerdict = CandidateSafeQualityGateVerdict | 'REJECTED';

interface CandidateSafeSourceRef {
  sourceRefType?: string;
  locator?: string;
  exactText?: string;
}

interface CandidateSafeRoleSourceRef {
  sourceRefType?: string;
  locator?: string;
  exactText?: string;
  conceptKeys: string[];
}

interface CandidateSafeMatchEvidence {
  purpose?: string;
  pairScore?: number;
  stretch?: {
    atomConcept: string;
    demandConcept: string;
    dimension: string;
  };
  roleSourceRefs: CandidateSafeRoleSourceRef[];
  candidateSourceRefs: CandidateSafeSourceRef[];
  challengeSourceRefs: CandidateSafeSourceRef[];
}

type CandidateSafeMatchHyperedgeNodeKind = 'person_evidence' | 'role_source' | 'repo_challenge';

interface CandidateSafeMatchHyperedgeNode {
  kind: CandidateSafeMatchHyperedgeNodeKind;
  label: string;
  sourceRef: CandidateSafeSourceRef & { conceptKeys?: string[] };
}

interface CandidateSafeMatchHyperedge {
  relation: 'candidate_role_repo_alignment' | 'candidate_repo_evidence_alignment';
  label: string;
  pairScore?: number;
  stretch?: CandidateSafeMatchEvidence['stretch'];
  nodes: CandidateSafeMatchHyperedgeNode[];
}

interface CandidateSafeMatchValidator {
  agentName: string;
  agentVersion: string;
  mode: 'deterministic';
  verdict: CandidateSafeValidatorVerdict;
  rationale: string;
  checks: Array<{
    id: string;
    passed: boolean;
    reason: string;
  }>;
  sourceBridge: {
    prNumber?: number;
    candidateSourceCount: number;
    repoSourceCount: number;
    roleSourceCount: number;
    alignedDemandCount: number;
    stretchCount: number;
    provenanceComplete: boolean;
  };
}

interface CandidateSafeAssessmentQualityMetric {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  reason: string;
}

interface CandidateSafeAssessmentQuality {
  verdict: string;
  score: number;
  maxScore: number;
  metrics: CandidateSafeAssessmentQualityMetric[];
}

interface CandidateSafeMatchExplanation {
  status: CandidateSafeMatchStatus;
  summary: string;
  score: number | null;
  assessmentQuality?: CandidateSafeAssessmentQuality;
  qualityGate: {
    verdict: CandidateSafeQualityGateVerdict;
    checks: string[];
  };
  candidateSourceCount: number;
  repoSourceCount: number;
  roleSourceCount: number;
  evidence: CandidateSafeMatchEvidence[];
  evidenceHyperedges: CandidateSafeMatchHyperedge[];
  validatorAgent?: CandidateSafeMatchValidator;
}

interface StandaloneReviewMatchResult {
  repoUrl: string;
  prNumber: number;
  matchExplanation: CandidateSafeMatchExplanation | null;
}

type StandaloneSourceBackedAssignmentRow = Pick<
  StandaloneReviewRow | StandaloneDevContainerRow,
  'id' | 'matched_repo_id' | 'github_repo_url' | 'github_pr_number'
>;

type StandaloneReviewMatcher = (
  db: D1Database,
  candidateId: string,
) => Promise<CandidateReviewChallengeMatch>;

interface StandaloneReviewEvidenceReadiness {
  ready: boolean;
  terminal: boolean;
  reason: string | null;
  status: string | null;
  currentStep: string | null;
  nodeCount: number;
  rawNodeCount: number;
  updatedAt: string | null;
  estimatedCompletionAt: string | null;
}

const STANDALONE_RETRY_REASON = STALE_WORKERS_AI_RETRY_REASON;
const STANDALONE_EVIDENCE_STALE_AFTER_MS = 10 * 60 * 1000;

interface PersistedMatchRunRow {
  status: string;
  ranked_results_json: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim() ? [entry.trim()] : [],
  );
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalPersistedNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function standaloneReviewBackingIds(interviewId: string): {
  pipelineId: string;
  stageId: string;
  challengeId: string;
} {
  return {
    pipelineId: `standalone-review-backing-pipeline-${interviewId}`,
    stageId: `standalone-review-backing-stage-${interviewId}`,
    challengeId: `standalone-review-backing-challenge-${interviewId}`,
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function safeValidatorVerdict(value: unknown): CandidateSafeValidatorVerdict | undefined {
  return value === 'PASSED' || value === 'NEEDS_REVIEW' || value === 'REJECTED'
    ? value
    : undefined;
}

function boundedExactText(value: unknown): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  return text.length > 1200 ? `${text.slice(0, 1197)}...` : text;
}

function safeSourceRef(ref: SourceRef): CandidateSafeSourceRef | null {
  const safe: CandidateSafeSourceRef = {
    ...(optionalString(ref.sourceRefType) ? { sourceRefType: optionalString(ref.sourceRefType) } : {}),
    ...(optionalString(ref.locator) ? { locator: optionalString(ref.locator) } : {}),
    ...(boundedExactText(ref.exactText) ? { exactText: boundedExactText(ref.exactText) } : {}),
  };
  return Object.keys(safe).length > 0 ? safe : null;
}

function safeSourceRefFromUnknown(value: unknown): CandidateSafeSourceRef | null {
  if (!isRecord(value)) return null;
  const safe: CandidateSafeSourceRef = {
    ...(optionalString(value.sourceRefType) ? { sourceRefType: optionalString(value.sourceRefType) } : {}),
    ...(optionalString(value.locator) ? { locator: optionalString(value.locator) } : {}),
    ...(boundedExactText(value.exactText) ? { exactText: boundedExactText(value.exactText) } : {}),
  };
  return Object.keys(safe).length > 0 ? safe : null;
}

function safeRoleSourceRef(ref: RoleSourceReference): CandidateSafeRoleSourceRef | null {
  const safe: CandidateSafeRoleSourceRef = {
    conceptKeys: ref.conceptKeys.filter((concept) => concept.trim().length > 0),
    ...(optionalString(ref.sourceRefType) ? { sourceRefType: optionalString(ref.sourceRefType) } : {}),
    ...(optionalString(ref.locator) ? { locator: optionalString(ref.locator) } : {}),
    ...(boundedExactText(ref.exactText) ? { exactText: boundedExactText(ref.exactText) } : {}),
  };
  return safe.conceptKeys.length > 0 || safe.locator || safe.exactText ? safe : null;
}

function safeRoleSourceRefFromUnknown(value: unknown): CandidateSafeRoleSourceRef | null {
  if (!isRecord(value)) return null;
  const safe: CandidateSafeRoleSourceRef = {
    conceptKeys: stringArray(value.conceptKeys),
    ...(optionalString(value.sourceRefType) ? { sourceRefType: optionalString(value.sourceRefType) } : {}),
    ...(optionalString(value.locator) ? { locator: optionalString(value.locator) } : {}),
    ...(boundedExactText(value.exactText) ? { exactText: boundedExactText(value.exactText) } : {}),
  };
  return safe.conceptKeys.length > 0 || safe.locator || safe.exactText ? safe : null;
}

function safeStretchFromUnknown(value: unknown): CandidateSafeMatchEvidence['stretch'] | undefined {
  if (!isRecord(value)) return undefined;
  const atomConcept = optionalString(value.atomConcept);
  const demandConcept = optionalString(value.demandConcept);
  const dimension = optionalString(value.dimension);
  if (!atomConcept || !demandConcept || !dimension) return undefined;
  return { atomConcept, demandConcept, dimension };
}

function safeValidatorChecksFromUnknown(value: unknown): CandidateSafeMatchValidator['checks'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = optionalString(entry.id);
    const passed = optionalBoolean(entry.passed);
    const reason = optionalString(entry.reason);
    if (!id || passed === undefined || !reason) return [];
    return [{ id, passed, reason }];
  });
}

function safeValidatorAgentFromUnknown(value: unknown): CandidateSafeMatchValidator | undefined {
  if (!isRecord(value)) return undefined;
  const agentName = optionalString(value.agentName);
  const agentVersion = optionalString(value.agentVersion);
  const mode = value.mode === 'deterministic' ? 'deterministic' : undefined;
  const verdict = safeValidatorVerdict(value.verdict);
  const rationale = optionalString(value.rationale);
  const bridge = isRecord(value.sourceBridge) ? value.sourceBridge : null;
  const candidateSourceCount = bridge ? optionalNumber(bridge.candidateSourceCount) : undefined;
  const repoSourceCount = bridge ? optionalNumber(bridge.repoSourceCount) : undefined;
  const roleSourceCount = bridge ? optionalNumber(bridge.roleSourceCount) : undefined;
  const alignedDemandCount = bridge ? optionalNumber(bridge.alignedDemandCount) : undefined;
  const stretchCount = bridge ? optionalNumber(bridge.stretchCount) : undefined;
  const provenanceComplete = bridge ? optionalBoolean(bridge.provenanceComplete) : undefined;
  if (
    !agentName
    || !agentVersion
    || !mode
    || !verdict
    || !rationale
    || candidateSourceCount === undefined
    || repoSourceCount === undefined
    || roleSourceCount === undefined
    || alignedDemandCount === undefined
    || stretchCount === undefined
    || provenanceComplete === undefined
  ) {
    return undefined;
  }
  return {
    agentName,
    agentVersion,
    mode,
    verdict,
    rationale,
    checks: safeValidatorChecksFromUnknown(value.checks),
    sourceBridge: {
      ...(bridge && optionalNumber(bridge.prNumber) ? { prNumber: optionalNumber(bridge.prNumber) } : {}),
      candidateSourceCount,
      repoSourceCount,
      roleSourceCount,
      alignedDemandCount,
      stretchCount,
      provenanceComplete,
    },
  };
}

function safeAssessmentQualityFromUnknown(value: unknown): CandidateSafeAssessmentQuality | undefined {
  if (!isRecord(value)) return undefined;
  const verdict = optionalString(value.verdict);
  const score = optionalNumber(value.score);
  const maxScore = optionalNumber(value.maxScore);
  const metrics = Array.isArray(value.metrics)
    ? value.metrics.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = optionalString(entry.id);
        const label = optionalString(entry.label);
        const metricScore = optionalNumber(entry.score);
        const metricMaxScore = optionalNumber(entry.maxScore);
        const reason = optionalString(entry.reason);
        if (!id || !label || metricScore === undefined || metricMaxScore === undefined || !reason) {
          return [];
        }
        return [{
          id,
          label,
          score: metricScore,
          maxScore: metricMaxScore,
          reason,
        }];
      })
    : [];
  if (!verdict || score === undefined || maxScore === undefined || metrics.length === 0) {
    return undefined;
  }
  return {
    verdict,
    score,
    maxScore,
    metrics,
  };
}

function dedupeSafeRefs<T>(refs: T[], keyOf: (ref: T) => string): T[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = keyOf(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceRefKey(ref: CandidateSafeSourceRef): string {
  return [ref.sourceRefType ?? '', ref.locator ?? '', ref.exactText ?? ''].join('|');
}

function roleSourceRefKey(ref: CandidateSafeRoleSourceRef): string {
  return [
    ref.sourceRefType ?? '',
    ref.locator ?? '',
    ref.exactText ?? '',
    ref.conceptKeys.join(','),
  ].join('|');
}

function buildMatchHyperedgeNodes(
  entry: CandidateSafeMatchEvidence,
): CandidateSafeMatchHyperedgeNode[] {
  return [
    ...entry.candidateSourceRefs.slice(0, 1).map((sourceRef): CandidateSafeMatchHyperedgeNode => ({
      kind: 'person_evidence',
      label: 'Person evidence',
      sourceRef,
    })),
    ...entry.roleSourceRefs.slice(0, 1).map((sourceRef): CandidateSafeMatchHyperedgeNode => ({
      kind: 'role_source',
      label: 'Role source',
      sourceRef,
    })),
    ...entry.challengeSourceRefs.slice(0, 1).map((sourceRef): CandidateSafeMatchHyperedgeNode => ({
      kind: 'repo_challenge',
      label: 'Repo challenge',
      sourceRef,
    })),
  ];
}

function buildMatchHyperedges(
  evidence: CandidateSafeMatchEvidence[],
): CandidateSafeMatchHyperedge[] {
  return evidence.flatMap((entry, index) => {
    const nodes = buildMatchHyperedgeNodes(entry);
    const hasPersonEvidence = nodes.some((node) => node.kind === 'person_evidence');
    const hasRoleSource = nodes.some((node) => node.kind === 'role_source');
    const hasRepoChallenge = nodes.some((node) => node.kind === 'repo_challenge');
    if (!hasPersonEvidence || !hasRepoChallenge) return [];
    return [{
      relation: hasRoleSource ? 'candidate_role_repo_alignment' : 'candidate_repo_evidence_alignment',
      label: hasRoleSource ? `Evidence bridge ${index + 1}` : `Candidate evidence bridge ${index + 1}`,
      ...(entry.pairScore !== undefined ? { pairScore: entry.pairScore } : {}),
      ...(entry.stretch ? { stretch: entry.stretch } : {}),
      nodes,
    }];
  });
}

export function qualityGateFor(
  status: CandidateSafeMatchStatus,
  candidateSourceCount: number,
  repoSourceCount: number,
  roleSourceCount: number,
  validatorAgent?: CandidateSafeMatchValidator,
  assessmentQuality?: CandidateSafeAssessmentQuality,
): CandidateSafeMatchExplanation['qualityGate'] {
  return candidateSafeQualityGateFor({
    status,
    candidateSourceCount,
    repoSourceCount,
    roleSourceCount,
    validatorVerdict: validatorAgent?.verdict,
    assessmentQualityVerdict: assessmentQuality?.verdict,
    assessmentQualityMetrics: assessmentQuality?.metrics,
    requireContrastSeparation: roleSourceCount > 0,
  });
}

function buildCandidateSafeMatchExplanation(input: {
  status: CandidateSafeMatchStatus;
  summary: string;
  score: number | null;
  assessmentQuality?: CandidateSafeAssessmentQuality;
  evidence: CandidateSafeMatchEvidence[];
  roleSources?: CandidateSafeRoleSourceRef[];
  validatorAgent?: CandidateSafeMatchValidator;
}): CandidateSafeMatchExplanation {
  const candidateRefs = dedupeSafeRefs(
    input.evidence.flatMap((entry) => entry.candidateSourceRefs),
    sourceRefKey,
  );
  const repoRefs = dedupeSafeRefs(
    input.evidence.flatMap((entry) => entry.challengeSourceRefs),
    sourceRefKey,
  );
  const roleRefs = dedupeSafeRefs(
    [
      ...input.evidence.flatMap((entry) => entry.roleSourceRefs),
      ...(input.roleSources ?? []),
    ],
    roleSourceRefKey,
  );
  return {
    status: input.status,
    summary: input.summary,
    score: input.score,
    qualityGate: qualityGateFor(
      input.status,
      candidateRefs.length,
      repoRefs.length,
      roleRefs.length,
      input.validatorAgent,
      input.assessmentQuality,
    ),
    candidateSourceCount: candidateRefs.length,
    repoSourceCount: repoRefs.length,
    roleSourceCount: roleRefs.length,
    evidence: input.evidence,
    evidenceHyperedges: buildMatchHyperedges(input.evidence),
    ...(input.assessmentQuality ? { assessmentQuality: input.assessmentQuality } : {}),
    ...(input.validatorAgent ? { validatorAgent: input.validatorAgent } : {}),
  };
}

function contrastSeparationScore(
  explanation: CandidateSafeMatchExplanation | null | undefined,
): number | null {
  const metric = explanation?.assessmentQuality?.metrics.find((entry) =>
    entry.id === 'contrast_separation'
  );
  return typeof metric?.score === 'number' && Number.isFinite(metric.score) ? metric.score : null;
}

function standaloneAutomaticMatchPasses(
  explanation: CandidateSafeMatchExplanation | null | undefined,
): boolean {
  const qualityChecks = new Set(explanation?.qualityGate.checks ?? []);
  const contrastAccepted = qualityChecks.has('contrast_separation_verified');
  return explanation?.status === 'MATCHED'
    && explanation.qualityGate.verdict === 'PASSED'
    && contrastAccepted;
}

function sanitizeMatchExplanation(explanation: MatchExplanation | undefined): CandidateSafeMatchExplanation | null {
  if (!explanation) return null;
  const evidence = explanation.evidence.flatMap((entry) => {
    const roleSourceRefs = entry.roleSourceRefs.flatMap((ref) => {
      const safe = safeRoleSourceRef(ref);
      return safe ? [safe] : [];
    });
    const candidateSourceRefs = entry.candidateSourceRefs.flatMap((ref) => {
      const safe = safeSourceRef(ref);
      return safe ? [safe] : [];
    });
    const challengeSourceRefs = entry.challengeSourceRefs.flatMap((ref) => {
      const safe = safeSourceRef(ref);
      return safe ? [safe] : [];
    });
    if (!roleSourceRefs.length && !candidateSourceRefs.length && !challengeSourceRefs.length) {
      return [];
    }
    return [{
      purpose: entry.purpose,
      pairScore: entry.pairScore,
      ...(entry.stretch ? { stretch: entry.stretch } : {}),
      roleSourceRefs,
      candidateSourceRefs,
      challengeSourceRefs,
    }];
  });
  const roleSources = explanation.roleSources.flatMap((ref) => {
    const safe = safeRoleSourceRef(ref);
    return safe ? [safe] : [];
  });
  return buildCandidateSafeMatchExplanation({
    status: explanation.status,
    summary: explanation.summary,
    score: explanation.score,
    assessmentQuality: safeAssessmentQualityFromUnknown(explanation.assessmentQuality),
    evidence,
    roleSources,
    validatorAgent: safeValidatorAgentFromUnknown(explanation.validatorAgent),
  });
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistedMatchStatus(value: string): CandidateSafeMatchStatus | null {
  if (value === 'MATCHED' || value === 'NEEDS_MORE_EVIDENCE' || value === 'NO_ROLE_SAFE_CHALLENGE') {
    return value;
  }
  return null;
}

function buildPersistedMatchRunExplanation(
  row: PersistedMatchRunRow,
  expectedRepoId: number | null,
  expectedPrNumber: number,
): CandidateSafeMatchExplanation | null {
  const status = persistedMatchStatus(row.status);
  if (!status) return null;
  const ranked = parseJsonArray(row.ranked_results_json);
  const selected = ranked.find((entry) => {
    if (!isRecord(entry)) return false;
    const repoId = optionalPersistedNumber(entry.repoId);
    const prNumber = optionalPersistedNumber(entry.prNumber);
    const repoMatches = expectedRepoId === null || repoId === expectedRepoId;
    return repoMatches && prNumber === expectedPrNumber && entry.eligible !== false;
  });
  if (!isRecord(selected)) return null;

  const alignments = Array.isArray(selected.alignments) ? selected.alignments : [];
  const evidence = alignments.flatMap((alignment) => {
    if (!isRecord(alignment)) return [];
    const roleSourceRefs = Array.isArray(alignment.roleSourceRefs)
      ? alignment.roleSourceRefs.flatMap((ref) => {
          const safe = safeRoleSourceRefFromUnknown(ref);
          return safe ? [safe] : [];
        })
      : [];
    const candidateSourceRefs = Array.isArray(alignment.candidateSourceRefs)
      ? alignment.candidateSourceRefs.flatMap((ref) => {
          const safe = safeSourceRefFromUnknown(ref);
          return safe ? [safe] : [];
        })
      : [];
    const challengeSourceRefs = Array.isArray(alignment.challengeSourceRefs)
      ? alignment.challengeSourceRefs.flatMap((ref) => {
          const safe = safeSourceRefFromUnknown(ref);
          return safe ? [safe] : [];
        })
      : [];
    if (!roleSourceRefs.length && !candidateSourceRefs.length && !challengeSourceRefs.length) {
      return [];
    }
    return [{
      ...(optionalString(alignment.purpose) ? { purpose: optionalString(alignment.purpose) } : {}),
      ...(optionalNumber(alignment.pairScore) ? { pairScore: optionalNumber(alignment.pairScore) } : {}),
      ...(safeStretchFromUnknown(alignment.stretch) ? { stretch: safeStretchFromUnknown(alignment.stretch) } : {}),
      roleSourceRefs,
      candidateSourceRefs,
      challengeSourceRefs,
    }];
  });

  const alignedDemandCount = optionalNumber(selected.alignedDemandCount) ?? evidence.length;
  const stretchCount = optionalNumber(selected.stretchCount) ?? 0;
  return buildCandidateSafeMatchExplanation({
    status,
    summary: status === 'MATCHED'
      ? `Matched ${alignedDemandCount} source-backed demand${alignedDemandCount === 1 ? '' : 's'} (${stretchCount} stretch).`
      : 'No source-backed review challenge passed the quality gate.',
    score: optionalNumber(selected.score) ?? null,
    assessmentQuality: safeAssessmentQualityFromUnknown(selected.assessmentQuality),
    evidence,
    validatorAgent: safeValidatorAgentFromUnknown(selected.validatorAgent),
  });
}

export function selectPreferredMatchExplanation(
  explanations: Array<CandidateSafeMatchExplanation | null | undefined>,
): CandidateSafeMatchExplanation | null {
  let fallback: CandidateSafeMatchExplanation | null = null;
  for (const explanation of explanations) {
    if (!explanation) continue;
    if (explanation.qualityGate.verdict === 'PASSED') return explanation;
    fallback ??= explanation;
  }
  return fallback;
}

async function loadCachedStandaloneReviewMatchExplanation(
  db: D1Database,
  candidateId: string,
  expectedRepoId: number | null,
  expectedPrNumber: number,
): Promise<CandidateSafeMatchExplanation | null> {
  const rows = await db.prepare(
    `SELECT status, ranked_results_json
       FROM match_runs
      WHERE candidate_id = ?1
      ORDER BY created_at DESC
      LIMIT 5`,
  ).bind(candidateId).all<PersistedMatchRunRow>();
  const explanations: CandidateSafeMatchExplanation[] = [];
  for (const row of rows.results ?? []) {
    const explanation = buildPersistedMatchRunExplanation(row, expectedRepoId, expectedPrNumber);
    if (explanation) explanations.push(explanation);
  }
  return selectPreferredMatchExplanation(explanations);
}

function sourceBackedManualReviewValidator(prNumber: number): CandidateSafeMatchValidator {
  return {
    agentName: 'source_backed_match_validator',
    agentVersion: 'v1',
    mode: 'deterministic',
    verdict: 'PASSED',
    rationale: `Recruiter-selected PR #${prNumber} is accepted as a manual CODE_REVIEW override because it has a production-ready source-backed review packet. Candidate-specific CV alignment is not inferred on this path.`,
    checks: [
      {
        id: 'repo_source_spans',
        passed: true,
        reason: 'The selected PR has persisted repository source spans and a production-ready review packet.',
      },
      {
        id: 'source_backed_manual_override',
        passed: true,
        reason: 'The recruiter explicitly selected this PR, so PIPE validates reviewability and provenance instead of claiming an automatic CV match.',
      },
      {
        id: 'provenance_complete',
        passed: true,
        reason: 'The manual override is backed by the same persisted packet/source-span contract used for automatic matching.',
      },
    ],
    sourceBridge: {
      prNumber,
      candidateSourceCount: 0,
      repoSourceCount: 1,
      roleSourceCount: 0,
      alignedDemandCount: 1,
      stretchCount: 0,
      provenanceComplete: true,
    },
  };
}

function sourceBackedManualReviewExplanation(prNumber: number): CandidateSafeMatchExplanation {
  const validatorAgent = sourceBackedManualReviewValidator(prNumber);
  const explanation = buildCandidateSafeMatchExplanation({
    status: 'MATCHED',
    summary: 'Manual override: recruiter-selected source-backed review challenge. PIPE validated that the PR is reviewable and source-backed, but did not infer candidate-specific CV alignment.',
    score: null,
    assessmentQuality: {
      verdict: 'USABLE',
      score: 8,
      maxScore: 12,
      metrics: [
        {
          id: 'skill_stack_overlap',
          label: 'Skill/stack overlap',
          score: 1,
          maxScore: 2,
          reason: 'Manual override does not infer candidate-specific CV alignment; the candidate still reviews a source-backed PR.',
        },
        {
          id: 'role_demand_overlap',
          label: 'Role/JD overlap',
          score: 1,
          maxScore: 2,
          reason: 'No role/JD source was supplied for this standalone manual override.',
        },
        {
          id: 'pr_reviewability',
          label: 'PR reviewability',
          score: 2,
          maxScore: 2,
          reason: 'The selected PR has a production-ready review packet and persisted source spans.',
        },
        {
          id: 'match_specificity',
          label: 'Match specificity',
          score: 2,
          maxScore: 2,
          reason: 'The challenge targets one concrete repository, PR, and set of changed source spans.',
        },
        {
          id: 'source_coverage',
          label: 'Source coverage',
          score: 2,
          maxScore: 2,
          reason: 'Repository-side provenance is complete; candidate-side fit was intentionally not inferred.',
        },
        {
          id: 'contrast_separation',
          label: 'Contrast separation',
          score: 0,
          maxScore: 2,
          reason: 'Manual override bypasses automatic candidate-to-PR ranking, so score separation was not measured.',
        },
      ],
    },
    evidence: [],
    validatorAgent,
  });
  return {
    ...explanation,
    qualityGate: {
      verdict: 'PASSED',
      checks: ['repo_source_spans', 'source_backed_manual_override', 'agent_validated_match'],
    },
    repoSourceCount: 1,
    validatorAgent,
  };
}

async function getPendingStandaloneReview(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneReviewRow | null> {
  try {
    return await db.prepare(
      `SELECT id, status, created_at, matched_repo_id, github_repo_url, github_pr_number, submission_json
       FROM scheduled_interviews
       WHERE candidate_id = ?1 AND interview_type = 'CODE_REVIEW' AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<StandaloneReviewRow>();
  } catch (err) {
    console.error('[standaloneReview] lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function getPendingDevContainerChallenge(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneDevContainerRow | null> {
  try {
    return await db.prepare(
      `SELECT id, status, created_at, interview_type, matched_repo_id, github_repo_url, github_pr_number, submission_json
       FROM scheduled_interviews
       WHERE candidate_id = ?1
         AND interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')
         AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<StandaloneDevContainerRow>();
  } catch (err) {
    console.error('[standaloneDevContainer] lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function standaloneInterviewTime(row: { created_at: string | null } | null): number {
  if (!row?.created_at) return 0;
  const timestamp = Date.parse(row.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function chooseLatestStandaloneAssessment(
  review: StandaloneReviewRow | null,
  devContainer: StandaloneDevContainerRow | null,
): StandaloneReviewRow | StandaloneDevContainerRow | null {
  if (!review) return devContainer;
  if (!devContainer) return review;
  return standaloneInterviewTime(devContainer) > standaloneInterviewTime(review)
    ? devContainer
    : review;
}

async function getPendingStandaloneAssessment(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneReviewRow | StandaloneDevContainerRow | null> {
  const [review, devContainer] = await Promise.all([
    getPendingStandaloneReview(db, candidateId),
    getPendingDevContainerChallenge(db, candidateId),
  ]);
  return chooseLatestStandaloneAssessment(review, devContainer);
}

async function hasReadyStandaloneCodeReviewAssignment(
  db: D1Database,
  candidateId: string,
  assessment: StandaloneReviewRow | StandaloneDevContainerRow | null,
): Promise<boolean> {
  return (await loadReadyStandaloneCodeReviewAssignment(db, candidateId, assessment)) !== null;
}

async function loadReadyStandaloneCodeReviewAssignment(
  db: D1Database,
  candidateId: string,
  assessment: StandaloneReviewRow | StandaloneDevContainerRow | null,
): Promise<StandaloneReviewMatchResult | null> {
  if (!assessment || 'interview_type' in assessment) return null;
  if (!assessment.github_repo_url || typeof assessment.github_pr_number !== 'number') {
    return null;
  }

  const isSourceBacked = await hasSourceBackedReviewPacket(
    db,
    assessment.github_repo_url,
    assessment.github_pr_number,
  );
  if (!isSourceBacked) return null;

  const cachedExplanation = await loadCachedStandaloneReviewMatchExplanation(
    db,
    candidateId,
    assessment.matched_repo_id,
    assessment.github_pr_number,
  );
  if (cachedExplanation && !standaloneAutomaticMatchPasses(cachedExplanation)) {
    return null;
  }

  return {
    repoUrl: assessment.github_repo_url,
    prNumber: assessment.github_pr_number,
    matchExplanation: cachedExplanation ?? sourceBackedManualReviewExplanation(assessment.github_pr_number),
  };
}

async function assessmentSessionsTableExists(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name = 'assessment_sessions'
      LIMIT 1`,
  ).first<{ name: string }>().catch(() => null);
  return row?.name === 'assessment_sessions';
}

async function loadLatestAssessmentSessionForCandidate(
  db: D1Database,
  candidateId: string,
): Promise<CandidateAssessmentSessionRow | null> {
  if (!await assessmentSessionsTableExists(db)) return null;
  return db.prepare(
    `SELECT s.id, s.mode, s.state
       FROM assessment_sessions s
       LEFT JOIN scheduled_interviews si ON si.id = s.interview_id
      WHERE s.state <> 'CANCELLED'
        AND s.mode IN ('OPEN_SOURCE_BUG_FIX', 'DEV_CONTAINER_REPO_TASK', 'DEV_CONTAINER_CHALLENGE')
        AND (s.candidate_id = ?1 OR si.candidate_id = ?1)
      ORDER BY s.created_at DESC
      LIMIT 1`,
  ).bind(candidateId).first<CandidateAssessmentSessionRow>();
}

function candidateSafeAssessmentLocator(locator: JsonObject): JsonObject {
  const safe: JsonObject = {};
  for (const key of [
    'repositoryUrl',
    'githubPrNumber',
    'pullRequestUrl',
    'baseCommitSha',
    'headCommitSha',
  ]) {
    const value = locator[key];
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || value === null
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function serializeCandidateAssessmentProgress(
  progress: AssessmentProgressSnapshot,
): CandidateAssessmentProgressPayload {
  return {
    mode: progress.session.mode,
    state: progress.session.state,
    stage: progress.stage,
    nextAction: progress.nextAction,
    nextActionLabel: progress.nextActionLabel,
    assignmentTrust: progress.assignmentTrust,
    hasChallengePacket: progress.hasChallengePacket,
    hasWorkEvidence: progress.hasWorkEvidence,
    hasMessageEvidence: progress.hasMessageEvidence,
    hasDevContainerEvidence: progress.hasDevContainerEvidence,
    hasToolUsageEvidence: progress.hasToolUsageEvidence,
    hasCommitSubmission: progress.hasCommitSubmission,
    hasFinalSubmission: progress.hasFinalSubmission,
    hasAiInteraction: progress.hasAiInteraction,
    hasTranscriptEvidence: progress.hasTranscriptEvidence,
    hasTestEvidence: progress.hasTestEvidence,
    hasVerificationGap: progress.hasVerificationGap,
    evidenceCounts: progress.evidenceCounts,
    sourceRefCounts: progress.sourceRefCounts,
    evidenceSnippets: progress.evidenceSnippets,
    challenge: progress.challenge
      ? {
          sourceRefType: progress.challenge.sourceRefType,
          evidenceRole: progress.challenge.evidenceRole,
          exactText: progress.challenge.exactText,
          contentHash: progress.challenge.contentHash,
          locator: candidateSafeAssessmentLocator(progress.challenge.locator),
        }
      : null,
    latestEvent: progress.latestEvent
      ? {
          kind: progress.latestEvent.kind,
          sequence: progress.latestEvent.sequence,
          occurredAt: progress.latestEvent.occurredAt,
        }
      : null,
    commit: progress.commit
      ? {
          repositoryUrl: progress.commit.repositoryUrl,
          forkRepositoryUrl: progress.commit.forkRepositoryUrl,
          branchName: progress.commit.branchName,
          baseCommitSha: progress.commit.baseCommitSha,
          commitSha: progress.commit.commitSha,
          commitUrl: progress.commit.commitUrl,
          submissionSource: progress.commit.submissionSource,
          submissionSourceLabel: progress.commit.submissionSourceLabel,
          changedFiles: progress.commit.changedFiles,
          occurredAt: progress.commit.occurredAt,
        }
      : null,
    evaluation: progress.evaluation
      ? {
          status: progress.evaluation.status,
          summary: progress.evaluation.summary,
          recommendation: progress.evaluation.recommendation,
          createdAt: progress.evaluation.createdAt,
          evidenceCoverage: progress.evaluation.evidenceCoverage,
          claims: progress.evaluation.claims,
          diagnostics: progress.evaluation.diagnostics,
        }
      : null,
  };
}

function candidateAssessmentErrorResponse(message: string, status = 422): Response {
  return new Response(JSON.stringify({
    error: {
      code: status === 404
        ? 'NOT_FOUND'
        : status === 409
          ? 'CONFLICT'
          : status >= 500
            ? 'INTERNAL_ERROR'
            : 'VALIDATION_ERROR',
      message,
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** True when the candidate has neither a stored resume nor matchable graph evidence yet. */
async function candidateNeedsCvIntake(db: D1Database, candidateId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT c.resume_s3_key,
            (SELECT COUNT(*)
               FROM candidate_nodes cn
              WHERE cn.candidate_id = c.id) AS raw_node_count,
            (SELECT COUNT(*)
               FROM candidate_nodes cn
              WHERE cn.candidate_id = c.id
                AND ${MATCHABLE_CANDIDATE_EVIDENCE_SQL}) AS node_count
     FROM candidates c WHERE c.id = ?1`,
  ).bind(candidateId).first<{
    resume_s3_key: string | null;
    raw_node_count: number;
    node_count: number;
  }>();
  if (!row) return false;
  return !row.resume_s3_key && (row.node_count ?? 0) === 0;
}

async function standaloneReviewEvidenceReadiness(
  db: D1Database,
  candidateId: string,
): Promise<StandaloneReviewEvidenceReadiness> {
  const row = await db.prepare(
    `SELECT c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text,
            ci.estimated_completion_at,
            ci.updated_at,
            (SELECT COUNT(*)
               FROM candidate_nodes cn
              WHERE cn.candidate_id = c.id
                AND cn.superseded_at IS NULL) AS raw_node_count,
            (SELECT COUNT(*)
               FROM candidate_nodes cn
              WHERE cn.candidate_id = c.id
                AND ${MATCHABLE_CANDIDATE_EVIDENCE_SQL}) AS node_count
       FROM candidates c
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.id = ?1`,
  ).bind(candidateId).first<{
    resume_s3_key: string | null;
    status: string | null;
    current_step: string | null;
    error_text: string | null;
    estimated_completion_at: string | null;
    updated_at: string | null;
    raw_node_count: number;
    node_count: number;
  }>();

  if (!row) {
    return {
      ready: false,
      terminal: true,
      reason: 'candidate not found',
      status: null,
      currentStep: null,
      nodeCount: 0,
      rawNodeCount: 0,
      updatedAt: null,
      estimatedCompletionAt: null,
    };
  }

  const nodeCount = row.node_count ?? 0;
  const rawNodeCount = row.raw_node_count ?? nodeCount;
  const status = row.status ?? null;
  const currentStep = row.current_step ?? null;
  const updatedAt = row.updated_at ?? null;
  const estimatedCompletionAt = row.estimated_completion_at ?? null;
  if (status === 'failed' && nodeCount <= 0) {
    return {
      ready: false,
      terminal: true,
      reason: row.error_text ?? 'candidate ingestion failed before source-backed evidence was created',
      status,
      currentStep,
      nodeCount,
      rawNodeCount,
      updatedAt,
      estimatedCompletionAt,
    };
  }

  if (nodeCount > 0) {
    return {
      ready: true,
      terminal: false,
      reason: null,
      status,
      currentStep,
      nodeCount,
      rawNodeCount,
      updatedAt,
      estimatedCompletionAt,
    };
  }

  if (isCompletedStandaloneIngestionStatus(status)) {
    return {
      ready: false,
      terminal: true,
      reason: 'Candidate evidence ingestion completed without matchable source-backed evidence.',
      status,
      currentStep,
      nodeCount,
      rawNodeCount,
      updatedAt,
      estimatedCompletionAt,
    };
  }

  if (standaloneEvidenceIsStale(status, updatedAt)) {
    return {
      ready: false,
      terminal: true,
      reason: staleStandaloneEvidenceReason(currentStep, updatedAt),
      status,
      currentStep,
      nodeCount,
      rawNodeCount,
      updatedAt,
      estimatedCompletionAt,
    };
  }

  if (nodeCount <= 0) {
    return {
      ready: false,
      terminal: false,
      reason: row.resume_s3_key
        ? 'candidate evidence graph is still being built'
        : 'candidate CV intake has not completed',
      status,
      currentStep,
      nodeCount,
      rawNodeCount,
      updatedAt,
      estimatedCompletionAt,
    };
  }

  return {
    ready: false,
    terminal: true,
    reason: 'Candidate evidence graph returned an invalid matchable evidence count.',
    status,
    currentStep,
    nodeCount,
    rawNodeCount,
    updatedAt,
    estimatedCompletionAt,
  };
}

function retryingStandaloneReviewReadiness(reason = STANDALONE_RETRY_REASON): StandaloneReviewEvidenceReadiness {
  return {
    ready: false,
    terminal: false,
    reason,
    status: 'pending',
    currentStep: 'retry_queued',
    nodeCount: 0,
    rawNodeCount: 0,
    updatedAt: new Date().toISOString(),
    estimatedCompletionAt: null,
  };
}

function optionalExecutionContext(c: { readonly executionCtx: ExecutionContext }): ExecutionContext | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

/** True when a pipeline code stage should be gated behind CV intake for this candidate. */
async function stageRequiresCvIntake(db: D1Database, candidateId: string, stageId: string): Promise<boolean> {
  const assignment = await db.prepare(
    `SELECT id FROM candidate_challenge_assignment WHERE candidate_id = ?1 AND stage_id = ?2`,
  ).bind(candidateId, stageId).first<{ id: string }>();
  if (assignment) return false;
  return candidateNeedsCvIntake(db, candidateId);
}

async function clearStandaloneReviewCachedMatch(
  db: D1Database,
  interviewId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_interviews
        SET matched_repo_id = NULL,
            github_repo_url = NULL,
            github_pr_number = NULL,
            updated_at = ?1
      WHERE id = ?2`,
  ).bind(new Date().toISOString(), interviewId).run();
}

/**
 * Match a standalone assessment to a repo + PR from the candidate's graph
 * alone (no role context). The match is cached on the scheduled_interviews row
 * because standalone sessions have no stage/challenge rows to hold an
 * assignment. The selected PR must pass the same source-backed candidate-safe
 * quality gate used by standalone code review.
 */
async function matchStandaloneSourceBackedAssignment(
  db: D1Database,
  candidateId: string,
  interview: StandaloneSourceBackedAssignmentRow,
  options: {
    logLabel: string;
    matcher?: StandaloneReviewMatcher;
  },
): Promise<StandaloneReviewMatchResult | null> {
  if (interview.github_repo_url && interview.github_pr_number) {
    const isSourceBacked = await hasSourceBackedReviewPacket(
      db,
      interview.github_repo_url,
      interview.github_pr_number,
    );
    if (isSourceBacked) {
      const cachedExplanation = await loadCachedStandaloneReviewMatchExplanation(
        db,
        candidateId,
        interview.matched_repo_id,
        interview.github_pr_number,
      );
      if (cachedExplanation) {
        if (standaloneAutomaticMatchPasses(cachedExplanation)) {
          return {
            repoUrl: interview.github_repo_url,
            prNumber: interview.github_pr_number,
            matchExplanation: cachedExplanation,
          };
        }
        console.warn(
          `[${options.logLabel}] refreshing cached automatic PR ${interview.github_pr_number} for ${candidateId} because its quality gate is ${cachedExplanation.qualityGate.verdict} and contrast score is ${contrastSeparationScore(cachedExplanation) ?? 'missing'}`,
        );
        await clearStandaloneReviewCachedMatch(db, interview.id);
      } else {
        return {
          repoUrl: interview.github_repo_url,
          prNumber: interview.github_pr_number,
          matchExplanation: sourceBackedManualReviewExplanation(interview.github_pr_number),
        };
      }
    } else {
      console.warn(
        `[${options.logLabel}] ignoring stale cached PR without source-backed graph context for ${candidateId}`,
      );
      await clearStandaloneReviewCachedMatch(db, interview.id);
    }
  }

  const readiness = await standaloneReviewEvidenceReadiness(db, candidateId);
  if (!readiness.ready) {
    console.log(
      `[${options.logLabel}] waiting for candidate evidence before matching ${candidateId}: ${readiness.reason ?? 'not ready'} (status=${readiness.status ?? 'none'}, matchableNodes=${readiness.nodeCount}, rawNodes=${readiness.rawNodeCount})`,
    );
    return null;
  }

  const matcher = options.matcher ?? matchCandidateToReviewChallenge;
  const match = await matcher(db, candidateId);
  if (match.status !== 'MATCHED' || !match.repoId || !match.prNumber) {
    console.log(`[${options.logLabel}] deterministic matcher returned ${match.status} for ${candidateId}`);
    return null;
  }
  const matchExplanation = sanitizeMatchExplanation(match.explanation);
  if (!standaloneAutomaticMatchPasses(matchExplanation)) {
    console.warn(
      `[${options.logLabel}] deterministic matcher selected ${match.repoId}#${match.prNumber} for ${candidateId}, but standalone quality gate did not pass (gate=${matchExplanation?.qualityGate.verdict ?? 'missing'}, contrast=${contrastSeparationScore(matchExplanation) ?? 'missing'})`,
    );
    return null;
  }
  const repo = await db.prepare(
    `SELECT github_url FROM qualified_repos WHERE id = ?1`,
  ).bind(match.repoId).first<{ github_url: string | null }>();
  if (!repo?.github_url) return null;

  await db.prepare(
    `UPDATE scheduled_interviews
     SET matched_repo_id = ?1, github_repo_url = ?2, github_pr_number = ?3, updated_at = ?4
     WHERE id = ?5`,
  ).bind(match.repoId, repo.github_url, match.prNumber, new Date().toISOString(), interview.id).run();
  return {
    repoUrl: repo.github_url,
    prNumber: match.prNumber,
    matchExplanation,
  };
}

async function matchStandaloneReview(
  db: D1Database,
  candidateId: string,
  interview: StandaloneReviewRow,
): Promise<StandaloneReviewMatchResult | null> {
  return matchStandaloneSourceBackedAssignment(db, candidateId, interview, {
    logLabel: 'standaloneReview',
  });
}

export async function matchStandaloneDevContainerAssessment(
  db: D1Database,
  candidateId: string,
  interview: StandaloneDevContainerRow,
  matcher?: StandaloneReviewMatcher,
): Promise<StandaloneReviewMatchResult | null> {
  return matchStandaloneSourceBackedAssignment(db, candidateId, interview, {
    logLabel: 'standaloneDevContainer',
    matcher,
  });
}

type SourceBackedReviewDiffResult = NonNullable<Awaited<ReturnType<typeof loadSourceBackedReviewDiff>>>;

async function ensureStandaloneReviewBackingChallenge(
  db: D1Database,
  candidateId: string,
  interviewId: string,
  match: {
    repoUrl: string;
    prNumber: number;
  },
  sourceBackedDiff: SourceBackedReviewDiffResult,
): Promise<{ stageId: string; challengeId: string }> {
  const candidate = await db.prepare(
    `SELECT owner_id FROM candidates WHERE id = ?1`,
  ).bind(candidateId).first<{ owner_id: string | null }>();
  if (!candidate?.owner_id) {
    throw new Error(`Standalone CODE_REVIEW candidate ${candidateId} is missing owner_id`);
  }

  const { pipelineId, stageId, challengeId } = standaloneReviewBackingIds(interviewId);
  const now = new Date().toISOString();
  const title = sourceBackedDiff.metadata.title ?? 'Code Review';
  const description = sourceBackedDiff.metadata.description
    ?? 'Source-backed pull request selected for async code review.';

  await db.prepare(
    `INSERT INTO pipelines (id, owner_id, title, status, creation_mode, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'ACTIVE', 'BLANK', ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       title = excluded.title,
       updated_at = excluded.updated_at`,
  ).bind(
    pipelineId,
    candidate.owner_id,
    'Standalone Code Review Backing',
    now,
  ).run();

  await db.prepare(
    `INSERT INTO stages
       (id, pipeline_id, title, description, sort_order, time_limit, mode, owner_id, created_at, updated_at)
     VALUES (?1, ?2, 'Code Review', 'Hidden backing stage for standalone code review sessions.', 0, NULL, 'ASYNC', ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       mode = excluded.mode,
       owner_id = excluded.owner_id,
       updated_at = excluded.updated_at`,
  ).bind(stageId, pipelineId, candidate.owner_id, now).run();

  await db.prepare(
    `INSERT INTO challenges
       (id, stage_id, type, sort_order, title, instructions, config, server_config,
        owner_id, github_repo_url, github_pr_number, github_pr_title, github_pr_description,
        cached_diff_json, cached_metadata, diff_cached_at, created_at, updated_at)
     VALUES (?1, ?2, 'CODE_REVIEW', 0, ?3, ?4, ?5, ?6,
             ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?14)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       instructions = excluded.instructions,
       config = excluded.config,
       server_config = excluded.server_config,
       owner_id = excluded.owner_id,
       github_repo_url = excluded.github_repo_url,
       github_pr_number = excluded.github_pr_number,
       github_pr_title = excluded.github_pr_title,
       github_pr_description = excluded.github_pr_description,
       cached_diff_json = excluded.cached_diff_json,
       cached_metadata = excluded.cached_metadata,
       diff_cached_at = excluded.diff_cached_at,
       updated_at = excluded.updated_at`,
  ).bind(
    challengeId,
    stageId,
    title,
    'Review this pull request as if a teammate opened it: leave inline comments, respond to the AI developer, choose a verdict, and explain your reasoning.',
    JSON.stringify(STANDALONE_REVIEW_CHALLENGE_CONFIG),
    JSON.stringify({
      source: 'standalone_code_review',
      repoUrl: match.repoUrl,
      prNumber: match.prNumber,
    }),
    candidate.owner_id,
    match.repoUrl,
    match.prNumber,
    sourceBackedDiff.metadata.title ?? null,
    description,
    JSON.stringify(sourceBackedDiff.diff),
    JSON.stringify(sourceBackedDiff.metadata),
    now,
  ).run();

  await db.prepare(
    `INSERT INTO assessments
       (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5, ?5, ?5)
     ON CONFLICT(candidate_id, stage_id) DO UPDATE SET
       owner_id = excluded.owner_id,
       updated_at = excluded.updated_at`,
  ).bind(
    `standalone-review-assessment-${interviewId}`,
    candidateId,
    stageId,
    candidate.owner_id,
    now,
  ).run();

  await db.prepare(
    `UPDATE candidates SET current_stage_id = ?1, updated_at = ?2 WHERE id = ?3`,
  ).bind(stageId, now, candidateId).run();

  return { stageId, challengeId };
}

/** Parse a submission (object or JSON string) and return it if it is a CV intake payload.
 *  Recognizes both R2-based uploads ({ resumeR2Key }) and text-based evidence ({ resumeText }).
 */
function parseIntakePayload(submission: unknown): Record<string, unknown> | null {
  const record = parseSubmissionObject(submission);
  if (!record) return null;
  if (typeof record.resumeR2Key === 'string') return record;
  if (typeof record.resumeText === 'string' && record.resumeText.length > 0) return record;
  return null;
}

function parseSubmissionObject(submission: unknown): Record<string, unknown> | null {
  let obj: unknown = submission;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  if (Array.isArray(obj)) return null;
  return obj as Record<string, unknown>;
}

/** Persist intake form data (resume / github / linkedin) and kick off enrichment. */
async function handleIntakePayload(
  env: Env,
  executionCtx: ExecutionContext,
  candidateId: string,
  submission: unknown,
  now: string,
): Promise<void> {
  let intakePayload: Record<string, unknown> = {};
  try {
    intakePayload = typeof submission === 'string' ? (JSON.parse(submission) as Record<string, unknown>) : (submission as Record<string, unknown>);
  } catch {
    intakePayload = {};
  }

  const resumeR2Key = typeof intakePayload.resumeR2Key === 'string' ? intakePayload.resumeR2Key : '';
  const resumeText = typeof intakePayload.resumeText === 'string' ? intakePayload.resumeText.trim() : '';
  const githubHandle = typeof intakePayload.githubHandle === 'string' ? intakePayload.githubHandle : '';
  const linkedinUrl = typeof intakePayload.linkedinUrl === 'string' ? intakePayload.linkedinUrl : '';

  if (resumeR2Key || resumeText.length >= 20) {
    try {
      await env.DB.prepare(
        `INSERT INTO candidate_ingestion (candidate_id, status, current_step, error_text, created_at, updated_at)
         VALUES (?1, 'pending', 'queued', NULL, ?2, ?2)
         ON CONFLICT(candidate_id) DO UPDATE SET
           status = 'pending',
           current_step = 'queued',
           error_text = NULL,
           updated_at = excluded.updated_at`,
      )
        .bind(candidateId, now)
        .run();
    } catch (err) {
      console.error(`[rpc/intake] failed to queue candidate ingestion:`, err);
    }
  }

  // 1a. R2-based resume upload — fetch and ingest from object storage
  if (resumeR2Key) {
    try {
      await env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(resumeR2Key, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/intake] failed to update candidate resume key:`, err);
    }

    executionCtx.waitUntil(
      (async () => {
        try {
          const result = await processResumeFromR2({
            env,
            db: env.DB,
            candidateId,
            r2Key: resumeR2Key,
          });
          console.log(`[rpc/intake] resume ingestion for candidate ${candidateId}:`, result.success);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/intake] resume ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  } else if (resumeText.length >= 20) {
    // 1b. Text-based resume evidence — run ingestion directly from plain text
    // Mark candidate as having a synthetic resume key so candidateNeedsCvIntake() returns false
    const syntheticKey = `text-intake/${candidateId}/${now}`;
    try {
      if (env.STORAGE) {
        await env.STORAGE.put(syntheticKey, resumeText, {
          httpMetadata: { contentType: 'text/plain;charset=utf-8' },
          customMetadata: {
            source: 'candidate_text_intake',
            candidateId,
          },
        });
      }
      await env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(syntheticKey, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/intake] failed to set synthetic resume key:`, err);
    }

    executionCtx.waitUntil(
      (async () => {
        try {
          const parsedCV = buildRuleBasedParsedCV(resumeText);
          await persistParsedCV(env.DB, candidateId, parsedCV);
          await runCandidateIngestion({
            env,
            db: env.DB,
            candidateId,
            parsed: parsedCV,
            resumeText,
            decompositionResult: null,
          });
          console.log(`[rpc/intake] text-based ingestion completed for candidate ${candidateId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/intake] text-based ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  }

  // 2. Queue GitHub enrichment
  if (githubHandle) {
    const githubUrl = `https://github.com/${githubHandle}`;
    try {
      await env.DB.prepare(
        `INSERT INTO candidate_ingestion (candidate_id, github_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(candidate_id) DO UPDATE SET
           github_url = excluded.github_url,
           updated_at = excluded.updated_at`,
      )
        .bind(candidateId, githubUrl, now)
        .run();

      await env.DB.prepare(
        `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
         VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`,
      )
        .bind(crypto.randomUUID(), candidateId, githubUrl)
        .run();

      console.log(`[rpc/intake] queued github enrichment for candidate ${candidateId}`);
    } catch (err) {
      console.error(`[rpc/intake] failed to queue github enrichment:`, err);
    }
  }

  // 3. Store LinkedIn URL
  if (linkedinUrl) {
    try {
      await env.DB.prepare(
        `INSERT INTO candidate_ingestion (candidate_id, linkedin_url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(candidate_id) DO UPDATE SET
           linkedin_url = excluded.linkedin_url,
           updated_at = excluded.updated_at`,
      )
        .bind(candidateId, linkedinUrl, now)
        .run();
      console.log(`[rpc/intake] stored linkedin url for candidate ${candidateId}`);
    } catch (err) {
      console.error(`[rpc/intake] failed to store linkedin url:`, err);
    }
  }
}

// ─── Public routes (no auth) ────────────────────────────────────────────────

const rpcPublic = new Hono<{ Bindings: Env }>();

type AssessmentStartClaimResult =
  | { ok: true; status: string; alreadyStarted: boolean }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      error: { code: string; message: string };
    };

async function claimCandidateInviteTokenForAssessmentStart(
  db: Env['DB'],
  candidateId: string,
  inviteToken: string | null,
): Promise<AssessmentStartClaimResult> {
  const candidate = await db
    .prepare('SELECT invite_token, status FROM candidates WHERE id = ?1')
    .bind(candidateId)
    .first<{ invite_token: string | null; status: string }>();

  if (!candidate) {
    return {
      ok: false,
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Candidate not found.' },
    };
  }

  if (candidate.status === 'COMPLETED') {
    return {
      ok: false,
      status: 403,
      error: { code: 'FORBIDDEN', message: 'Assessment already completed.' },
    };
  }

  const currentToken = candidate.invite_token?.trim() ?? '';
  if (!inviteToken) {
    if (candidate.status === 'IN_PROGRESS' || currentToken.startsWith('CLAIMED::')) {
      return { ok: true, status: candidate.status, alreadyStarted: true };
    }
    return {
      ok: false,
      status: 400,
      error: { code: 'START_TOKEN_MISSING', message: 'This session cannot claim an assessment invite.' },
    };
  }

  const claimedToken = `CLAIMED::${inviteToken}`;
  if (currentToken === claimedToken) {
    return { ok: true, status: candidate.status, alreadyStarted: true };
  }

  if (currentToken !== inviteToken) {
    return {
      ok: false,
      status: 409,
      error: currentToken.startsWith('CLAIMED::')
        ? { code: 'TOKEN_ALREADY_CLAIMED', message: 'This invite link has already been used.' }
        : { code: 'STALE_INVITE_TOKEN', message: 'This invite link is no longer current.' },
    };
  }

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE candidates
          SET invite_token = ?1,
              status = CASE WHEN status = 'INVITED' THEN 'IN_PROGRESS' ELSE status END,
              updated_at = ?2
        WHERE id = ?3
          AND invite_token = ?4`,
    )
    .bind(claimedToken, now, candidateId, inviteToken)
    .run();

  if (result.meta.changes === 0) {
    return {
      ok: false,
      status: 409,
      error: { code: 'TOKEN_ALREADY_CLAIMED', message: 'Token was already claimed.' },
    };
  }

  return {
    ok: true,
    status: candidate.status === 'INVITED' ? 'IN_PROGRESS' : candidate.status,
    alreadyStarted: false,
  };
}

function assessmentInviteTokenFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const assessIndex = segments.indexOf('assess');
    const token = assessIndex >= 0 ? segments[assessIndex + 1] : null;
    return token ? decodeURIComponent(token) : null;
  } catch {
    const match = /\/assess\/([^/?#]+)/.exec(trimmed);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

function parseInviteDeliveryMetadata(raw: string | null): {
  scheduledInterviewId: string | null;
  deliveredUrl: string | null;
} {
  if (!raw) return { scheduledInterviewId: null, deliveredUrl: null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { scheduledInterviewId: null, deliveredUrl: null };
    return {
      scheduledInterviewId: typeof parsed.scheduledInterviewId === 'string' ? parsed.scheduledInterviewId : null,
      deliveredUrl: typeof parsed.deliveredUrl === 'string' ? parsed.deliveredUrl : null,
    };
  } catch {
    return { scheduledInterviewId: null, deliveredUrl: null };
  }
}

async function loadDeliveredAssessmentInterviewIdForInviteToken(
  db: Env['DB'],
  inviteToken: string | null,
): Promise<string | null> {
  if (!inviteToken) return null;
  try {
    const rows = await db.prepare(
      `SELECT external_reference, metadata_json
         FROM interactions
        WHERE interaction_type = 'scheduled_interview_invite_delivery'
          AND metadata_json LIKE ?1
        ORDER BY started_at DESC, created_at DESC
        LIMIT 10`,
    ).bind(`%/assess/${inviteToken}%`).all<{
      external_reference: string | null;
      metadata_json: string | null;
    }>();

    for (const row of rows.results ?? []) {
      const metadata = parseInviteDeliveryMetadata(row.metadata_json);
      if (metadata.deliveredUrl && assessmentInviteTokenFromUrl(metadata.deliveredUrl) === inviteToken) {
        return metadata.scheduledInterviewId ?? row.external_reference ?? null;
      }
    }
  } catch (err) {
    console.error(
      '[start-assessment] failed to resolve delivered assessment invite:',
      err instanceof Error ? err.message : String(err),
    );
  }
  return null;
}

async function loadPendingAssessmentInterviewIdForStart(
  db: Env['DB'],
  candidateId: string,
  inviteToken: string | null,
): Promise<string | null> {
  const deliveredInterviewId = await loadDeliveredAssessmentInterviewIdForInviteToken(db, inviteToken);
  if (deliveredInterviewId) return deliveredInterviewId;

  const pending = await getPendingStandaloneAssessment(db, candidateId);
  return pending?.id ?? null;
}

async function markStartedAssessmentInterviewActive(
  db: Env['DB'],
  candidateId: string,
  inviteToken: string | null,
): Promise<void> {
  try {
    const interviewId = await loadPendingAssessmentInterviewIdForStart(db, candidateId, inviteToken);
    if (!interviewId) return;

    await db
      .prepare(
        `UPDATE scheduled_interviews
            SET status = 'ACTIVE',
                updated_at = ?1
          WHERE id = ?2
            AND candidate_id = ?3
            AND status IN ('INVITED', 'SCHEDULED')
            AND interview_type IN ('CODE_REVIEW', 'DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')`,
      )
      .bind(new Date().toISOString(), interviewId, candidateId)
      .run();
  } catch (err) {
    console.error(
      '[start-assessment] failed to mark linked assessment interview active:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── POST /rpc/resolve-token ─────────────────────────────────────────────────

rpcPublic.post('/resolve-token', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const inviteToken = body.inviteToken;

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'inviteToken is required.' } }, 400);
  }

  const trimmed = inviteToken.trim();

  // Reject already-claimed tokens
  if (trimmed.startsWith('CLAIMED::')) {
    return c.json({ error: { code: 'CONFLICT', message: 'Token already claimed.' } }, 409);
  }

  // Look up candidate by invite token
  let candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, status, name
     FROM candidates
     WHERE invite_token = ?1
     LIMIT 1`,
  )
    .bind(trimmed)
    .first<{
      id: string;
      pipeline_id: string | null;
      status: string;
      name: string | null;
    }>();

  if (!candidate) {
    // Check if the token was already claimed (handles sessionStorage loss scenario).
    // A claimed prefix is only terminal after the candidate has actually started.
    // Legacy/pre-fix rows may have the prefix while still INVITED; repair those
    // rows so opening a delivered link does not burn the invite.
    const claimedCandidate = await c.env.DB.prepare(
      `SELECT id, pipeline_id, status, name
       FROM candidates
       WHERE invite_token = ?1
       LIMIT 1`,
    )
      .bind(`CLAIMED::${trimmed}`)
      .first<{
        id: string;
        pipeline_id: string | null;
        status: string;
        name: string | null;
      }>();

    if (claimedCandidate) {
      if (claimedCandidate.status === 'INVITED') {
        const repair = await c.env.DB.prepare(
          `UPDATE candidates
              SET invite_token = ?1,
                  updated_at = ?2
            WHERE id = ?3
              AND invite_token = ?4`,
        )
          .bind(trimmed, new Date().toISOString(), claimedCandidate.id, `CLAIMED::${trimmed}`)
          .run();

        if (repair.meta.changes === 1) {
          candidate = claimedCandidate;
        } else {
          return c.json({
            error: { code: 'CONFLICT', message: 'This invite link changed while being opened. Please retry the link.' },
          }, 409);
        }
      } else {
        return c.json({
          error: { code: 'CONFLICT', message: 'This invite link has already been used. Please contact your recruiter for a new link.' },
          status: claimedCandidate.status,
        }, 409);
      }
    }

    if (!candidate) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Invalid invite token.' } }, 404);
    }
  }

  // Block completed candidates
  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'You have already completed this assessment.' },
      status: 'COMPLETED',
    }, 403);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    console.error('[resolve-token] SESSION_TOKEN_SECRET not configured');
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Issue JWT session token
  const sessionToken = await signJwt(
    { sub: candidate.id, pid: candidate.pipeline_id, itk: trimmed },
    secret,
  );

  return c.json({
    id: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: candidate.status,
    name: candidate.name,
    sessionToken,
  });
});

// ── POST /rpc/refresh-session ───────────────────────────────────────────────

rpcPublic.post('/refresh-session', async (c) => {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing session token.' } }, 401);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Verify signature but IGNORE expiry — this is the refresh flow
  const payload = await verifyJwt(token, secret, true);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid session token.' } }, 401);
  }

  // Check candidate still exists and is not completed
  const candidate = await c.env.DB.prepare(
    `SELECT id, status FROM candidates WHERE id = ?1`,
  )
    .bind(payload.sub)
    .first<{ id: string; status: string }>();

  if (!candidate) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }, 404);
  }

  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'Assessment already completed.' },
    }, 403);
  }

  // Issue fresh JWT
  const sessionToken = await signJwt(
    { sub: payload.sub, pid: payload.pid, itk: payload.itk ?? null },
    secret,
  );

  return c.json({ sessionToken });
});

// ─── Authenticated routes (candidate JWT) ───────────────────────────────────

const rpcAuth = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

rpcAuth.use('*', candidateAuth);

// ── POST /rpc/start-assessment ──────────────────────────────────────────────

rpcAuth.post('/start-assessment', async (c) => {
  const result = await claimCandidateInviteTokenForAssessmentStart(
    c.env.DB,
    c.get('candidateId'),
    c.get('inviteToken'),
  );

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  await markStartedAssessmentInterviewActive(c.env.DB, c.get('candidateId'), c.get('inviteToken'));

  return c.json({
    success: true,
    status: result.status,
    alreadyStarted: result.alreadyStarted,
  });
});

// ── POST /rpc/get-stage-config ──────────────────────────────────────────────

rpcAuth.post('/get-stage-config', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  // Fetch candidate to get owner_id and current_stage_id for Assessment creation
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, owner_id, current_stage_id, resume_s3_key FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ id: string; pipeline_id: string | null; owner_id: string | null; current_stage_id: string | null; resume_s3_key: string | null }>();

  if (!candidate) {
    return c.json({ isComplete: false, error: 'Candidate not found' });
  }
  const candidateRow = candidate; // narrow for nested function capture

  // Pipeline-free candidate (talent pool / standalone code review)
  if (!candidateRow.pipeline_id) {
    const needsResume = await candidateNeedsCvIntake(c.env.DB, candidateId);
    const standaloneAssessment = await getPendingStandaloneAssessment(c.env.DB, candidateId);

    // Standalone code-review interview: serve the assessment only after a
    // source-backed repo/PR assignment exists. Intake/matching stays upstream.
    if (!needsResume && standaloneAssessment && !('interview_type' in standaloneAssessment)) {
      const hasReadyAssignment = await hasReadyStandaloneCodeReviewAssignment(
        c.env.DB,
        candidateId,
        standaloneAssessment,
      );
      if (!hasReadyAssignment) {
        await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
        return c.json(candidateIntakeQueuedComplete('Profile received'));
      }
      return c.json({
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId,
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      });
    }

    // Standalone dev-container challenge interview: once the CV is in, serve
    // the challenge stage. When the repo has not been assigned yet, candidate
    // evidence is still required for source-backed matching.
    if (!needsResume && standaloneAssessment && 'interview_type' in standaloneAssessment) {
      const isOpenSourceBugFix = standaloneAssessment.interview_type === 'OPEN_SOURCE_BUG_FIX';
      if (!standaloneAssessment.github_repo_url) {
        const retryQueued = await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
        const readiness = retryQueued
          ? retryingStandaloneReviewReadiness(retryQueued.reason)
          : await standaloneReviewEvidenceReadiness(c.env.DB, candidateId);
        if (!readiness.ready) {
          return c.json(candidateIntakeQueuedComplete('Profile received'));
        }
        const match = await matchStandaloneDevContainerAssessment(
          c.env.DB,
          candidateId,
          standaloneAssessment,
        );
        if (!match) {
          return c.json(candidateIntakeQueuedComplete('Profile received'));
        }
      }
      return c.json({
        isComplete: false,
        stageId: 'standalone-dev-container',
        candidateId,
        stageTitle: isOpenSourceBugFix ? 'Open Source Bug Fix' : 'Dev Container Challenge',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{
          type: 'CODE_IMPLEMENTATION',
          order: 0,
          title: isOpenSourceBugFix ? 'Open Source Bug Fix' : 'Dev Container Challenge',
        }],
        currentIndex: 0,
      });
    }

    const hasPendingStandalone = Boolean(standaloneAssessment);
    const pendingIsDevContainer = Boolean(standaloneAssessment && 'interview_type' in standaloneAssessment);
    return c.json({
      isComplete: !needsResume && !hasPendingStandalone,
      stageId: 'talent-pool-intake',
      candidateId,
      stageTitle: needsResume
        ? 'Upload Your CV'
        : hasPendingStandalone
          ? (
              pendingIsDevContainer
                ? standaloneAssessment && 'interview_type' in standaloneAssessment && standaloneAssessment.interview_type === 'OPEN_SOURCE_BUG_FIX'
                  ? 'Open Source Bug Fix'
                  : 'Dev Container Challenge'
                : 'Code Review Interview'
            )
          : 'Thank You',
      mode: 'INTAKE',
      timeLimit: null,
      challenges: needsResume
        ? [{ type: 'INTAKE', order: 0, title: 'Profile & Resume' }]
        : [],
      upcoming: needsResume && hasPendingStandalone
        ? [{
            type: pendingIsDevContainer ? 'CODE_IMPLEMENTATION' : 'CODE_REVIEW',
            title: pendingIsDevContainer && standaloneAssessment && 'interview_type' in standaloneAssessment
              ? standaloneAssessment.interview_type === 'OPEN_SOURCE_BUG_FIX'
                ? 'Open Source Bug Fix'
                : 'Dev Container Challenge'
              : 'Code Review',
          }]
        : [],
      currentIndex: 0,
    });
  }

  // At this point pipeline_id is guaranteed non-null (early return above handles null)
  // Use DB value rather than JWT — candidate may have been assigned a pipeline after token issuance
  const effectivePipelineId = candidateRow.pipeline_id as string;

  // Fetch all stages with challenges in a single JOIN query
  // Include config so we can filter out empty/unconfigured challenges
  const rows = await c.env.DB.prepare(`
    SELECT
      s.id AS stage_id,
      s.title AS stage_title,
      s.sort_order AS stage_order,
      s.mode AS stage_mode,
      s.time_limit,
      s.screening_input_mode,
      s.video_config,
      ch.id AS challenge_id,
      ch.type AS challenge_type,
      ch.title AS challenge_title,
      ch.sort_order AS challenge_order,
      ch.config AS challenge_config,
      ch.instructions AS challenge_instructions
    FROM stages s
    LEFT JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?1
    ORDER BY s.sort_order ASC, ch.sort_order ASC
  `)
    .bind(effectivePipelineId)
    .all();

  if (!rows.results || rows.results.length === 0) {
    return c.json({ isComplete: true });
  }

  // Group by stage
  const stageMap = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      mode: string | null;
      timeLimit: number | null;
      screeningInputMode: string | null;
      videoConfig: string | null;
      challenges: Array<{ id: string; type: string; title: string; order: number }>;
    }
  >();

  for (const row of rows.results) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        id: sid,
        title: r.stage_title as string,
        order: r.stage_order as number,
        mode: (r.stage_mode as string | null) ?? null,
        timeLimit: (r.time_limit as number | null) ?? null,
        screeningInputMode: (r.screening_input_mode as string | null) ?? null,
        videoConfig: (r.video_config as string | null) ?? null,
        challenges: [],
      });
    }
    if (r.challenge_id) {
      // Filter out empty/unconfigured challenges — candidates should never see
      // placeholder challenges that have no meaningful content (Bug #11 fix).
      const rawConfig = r.challenge_config as string | null;
      const instructions = r.challenge_instructions as string | null;
      let hasContent = !!(instructions && instructions.trim().length > 0);
      if (rawConfig) {
        try {
          const parsed = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
          // A challenge has content if config has any truthy values
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            hasContent = true;
          }
        } catch {
          // Invalid JSON config — treat as empty
        }
      }

      if (hasContent) {
        stageMap.get(sid)!.challenges.push({
          id: r.challenge_id as string,
          type: r.challenge_type as string,
          title: (r.challenge_title as string) ?? 'Challenge',
          order: r.challenge_order as number,
        });
      }
    }
  }

  const stages = [...stageMap.values()].sort((a, b) => a.order - b.order);

  // Helper: evaluate a single stage and return config if it has unsubmitted challenges
  async function evaluateStage(stage: typeof stages[0]): Promise<Response | null> {
    if (stage.challenges.length === 0) return null;

    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ?1 AND a.stage_id = ?2
    `)
      .bind(candidateId, stage.id)
      .all();

    const submittedIds = new Set(
      (subs.results ?? []).map(
        (r) => (r as Record<string, unknown>).challenge_id as string,
      ),
    );

    let currentIndex = -1;
    for (let i = 0; i < stage.challenges.length; i++) {
      if (!submittedIds.has(stage.challenges[i]!.id)) {
        currentIndex = i;
        break;
      }
    }

    if (currentIndex === -1) return null;

    const existingAssessment = await c.env.DB.prepare(
      `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
    )
      .bind(candidateId, stage.id)
      .first<{ id: string }>();

    if (!existingAssessment) {
      const nextChallenge = stage.challenges[currentIndex];
      if (!nextChallenge) {
        return null;
      }
      // Code stages need a candidate graph before matching can run — if the
      // candidate has no CV and no graph yet, gate the stage behind CV intake.
      if (
        ['CODE_REVIEW', 'CODE_IMPLEMENTATION'].includes(nextChallenge.type) &&
        (await stageRequiresCvIntake(c.env.DB, candidateId, stage.id))
      ) {
        await c.env.DB.prepare(
          `UPDATE candidates SET current_stage_id = ?1 WHERE id = ?2`,
        )
          .bind(stage.id, candidateId)
          .run();
        return c.json({
          isComplete: false,
          stageId: stage.id,
          candidateId,
          stageTitle: stage.title,
          mode: 'INTAKE',
          timeLimit: null,
          challenges: [{ type: 'INTAKE', order: 0, title: 'Profile & Resume' }],
          upcoming: stage.challenges.map((ch) => ({ type: ch.type, title: ch.title })),
          currentIndex: 0,
        });
      }

      const gateResult = await checkMatchingGate(c.env.DB, candidateId, effectivePipelineId, stage.id, nextChallenge.id, nextChallenge.type, c.env);
      if (gateResult.blocked && gateResult.syntheticChallenge) {
        return c.json(candidateIntakeQueuedComplete('Profile received'));
      }

      const assessmentId = crypto.randomUUID();
      const now = new Date().toISOString();
      await c.env.DB.prepare(`
        INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5, ?5, ?5)
      `)
        .bind(assessmentId, candidateId, stage.id, candidateRow.owner_id, now)
        .run();
    }

    await c.env.DB.prepare(
      `UPDATE candidates SET current_stage_id = ?1 WHERE id = ?2`,
    )
      .bind(stage.id, candidateId)
      .run();

    const syntheticChallenges: Array<{ type: string; order: number }> = [];
    syntheticChallenges.push({ type: 'WELCOME', order: -2 });
    if (stage.mode === 'LIVE_VIDEO') {
      syntheticChallenges.push({ type: 'LIVE_VIDEO', order: -1 });
    }

    const allChallenges = [...syntheticChallenges, ...stage.challenges];
    const indexedChallenges = allChallenges.map((ch, i) => ({ type: ch.type, title: (ch as Record<string, unknown>).title as string | undefined, order: i }));
    const syntheticCount = syntheticChallenges.length;
    const hasSubmissions = currentIndex > 0;
    const adjustedIndex = hasSubmissions ? currentIndex + syntheticCount : 0;

    return c.json({
      isComplete: false,
      stageId: stage.id,
      candidateId,
      stageTitle: stage.title,
      mode: stage.mode ?? 'ASYNC',
      timeLimit: stage.timeLimit,
      screeningInputMode: stage.screeningInputMode,
      challenges: indexedChallenges,
      currentIndex: adjustedIndex,
    });
  }

  // If candidate has an explicit current_stage_id,
  // try that stage first so candidates start where they were assigned.
  if (candidate.current_stage_id) {
    const targetStage = stages.find((s) => s.id === candidate.current_stage_id);
    if (targetStage) {
      const targetConfig = await evaluateStage(targetStage);
      if (targetConfig) return targetConfig;
    }
  }

  // Walk stages to find the first with un-submitted challenges
  for (const stage of stages) {
    const result = await evaluateStage(stage);
    if (result) return result;
  }

  // All stages complete
  return c.json({ isComplete: true });
});

// ── POST /rpc/get-challenge ─────────────────────────────────────────────────

rpcAuth.post('/get-challenge', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
      400,
    );
  }

  // Pipeline-free candidate: INTAKE first, then standalone code review or dev container if invited
  if (!pipelineId) {
    if (await candidateNeedsCvIntake(c.env.DB, candidateId)) {
      return c.json(INTAKE_CHALLENGE_CONTENT);
    }

    const standaloneAssessment = await getPendingStandaloneAssessment(c.env.DB, candidateId);
    if (standaloneAssessment && 'interview_type' in standaloneAssessment) {
      let repoUrl = standaloneAssessment.github_repo_url;
      let prNumber = standaloneAssessment.github_pr_number;
      if (!repoUrl) {
        const retryQueued = await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
        if (retryQueued) {
          return c.json(standaloneWaitingChallengeForReadiness(retryingStandaloneReviewReadiness(retryQueued.reason)));
        }
        const readiness = await standaloneReviewEvidenceReadiness(c.env.DB, candidateId);
        if (!readiness.ready) {
          return c.json(standaloneWaitingChallengeForReadiness(readiness));
        }
        const match = await matchStandaloneDevContainerAssessment(
          c.env.DB,
          candidateId,
          standaloneAssessment,
        );
        if (!match) {
          const reason = 'The deterministic repo matcher did not return a quality-gated, source-backed repo challenge.';
          return c.json(standaloneWaitingChallenge({
            state: 'blocked',
            autoRefresh: false,
            reason,
            diagnostics: diagnosticsForStandaloneReviewReadiness(readiness, {
              phase: 'repo_matching',
              repoMatchingStatus: 'blocked',
              repoMatchingDetail: reason,
            }),
          }));
        }
        repoUrl = match.repoUrl;
        prNumber = match.prNumber;
      }
      const isOpenSourceBugFix = standaloneAssessment.interview_type === 'OPEN_SOURCE_BUG_FIX';
      return c.json({
        id: `standalone-dev-container-${standaloneAssessment.id}`,
        type: 'CODE_IMPLEMENTATION',
        title: isOpenSourceBugFix ? 'Open Source Bug Fix' : 'Dev Container Challenge',
        instructions: isOpenSourceBugFix
          ? 'Use the dev container workspace to investigate the matched open-source task, implement a source-backed solution, and verify your changes with tests or concrete checks.'
          : 'Complete the coding challenge in the dev container workspace provided below.',
        config: JSON.stringify({ starterCode: '' }),
        cachedDiffJson: null,
        githubPrTitle: null,
        githubPrNumber: prNumber ?? null,
        githubRepoUrl: repoUrl,
        githubPrDescription: null,
        reviewProfile: null,
        devContainerRepoUrl: repoUrl,
      });
    }

    if (!standaloneAssessment) {
      return c.json(INTAKE_CHALLENGE_CONTENT);
    }

    const match = await loadReadyStandaloneCodeReviewAssignment(c.env.DB, candidateId, standaloneAssessment);
    if (!match) {
      await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
      return c.json(profileReceivedChallengeContent());
    }

    let cachedDiffJson: unknown = null;
    let githubPrTitle: string | null = null;
    let githubPrDescription: string | null = null;
    let reviewProfile: unknown = null;
    const sourceBackedDiff = await loadSourceBackedReviewDiff(c.env.DB, match.repoUrl, match.prNumber);
    if (sourceBackedDiff) {
      cachedDiffJson = sourceBackedDiff.diff;
      githubPrTitle = sourceBackedDiff.metadata.title;
      githubPrDescription = sourceBackedDiff.metadata.description ?? null;
      reviewProfile = sourceBackedDiff.metadata.reviewProfile ?? null;
    }

    if (!sourceBackedDiff || !cachedDiffJson) {
      return c.json(profileReceivedChallengeContent());
    }
    const backing = await ensureStandaloneReviewBackingChallenge(
      c.env.DB,
      candidateId,
      standaloneAssessment.id,
      match,
      sourceBackedDiff,
    );

    return c.json({
      id: backing.challengeId,
      type: 'CODE_REVIEW',
      title: 'Code Review',
      instructions: 'Review this pull request as if a teammate opened it: call out bugs, risks, design concerns, and suggestions.',
      config: STANDALONE_REVIEW_CHALLENGE_CONFIG,
      cachedDiffJson,
      githubPrTitle,
      githubPrNumber: match.prNumber,
      githubRepoUrl: match.repoUrl,
      githubPrDescription,
      reviewProfile,
      devContainerRepoUrl: null,
      matchExplanation: match.matchExplanation,
      reviewSession: {
        requiresInit: true,
        challengeId: backing.challengeId,
      },
    });
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ error: 'No active stage' }, 404);
  }

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode, screening_input_mode FROM stages WHERE id = ?1`
  )
    .bind(candidate.current_stage_id)
    .first<{ mode: string | null; screening_input_mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0); // WELCOME + optional LIVE_VIDEO

  // Return synthetic challenges without DB lookup
  if (order < syntheticCount) {
    const syntheticType = order === 0 ? 'WELCOME' : 'LIVE_VIDEO';
    return c.json({
      id: `synthetic-${syntheticType.toLowerCase()}`,
      type: syntheticType,
      title: syntheticType === 'WELCOME' ? 'Welcome' : 'Video Interview',
      instructions: null,
      config: null,
      cachedDiffJson: null,
      githubPrTitle: null,
      githubPrNumber: null,
      githubRepoUrl: null,
      githubPrDescription: null,
      reviewProfile: null,
      devContainerRepoUrl: null,
    });
  }

  // Adjust order to account for synthetic entries
  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered.
  // LEFT JOIN candidate_challenge_assignment to apply per-candidate overrides.
  const challenges = await c.env.DB.prepare(`
    SELECT
      ch.id, ch.type, ch.title, ch.instructions, ch.config,
      ch.cached_diff_json, ch.cached_metadata, ch.github_pr_title, ch.github_pr_number,
      ch.github_repo_url, ch.github_pr_description,
      ch.dev_container_repo_url,
      cca.id as assignment_id,
      cca.github_repo_url as assignment_repo_url,
      cca.github_pr_number as assignment_pr_number,
      COALESCE(cca.github_repo_url, ch.github_repo_url) as effective_repo_url,
      COALESCE(cca.github_pr_number, ch.github_pr_number) as effective_pr_number,
      COALESCE(cca.issue_number, NULL) as effective_issue_number
    FROM challenges ch
    LEFT JOIN candidate_challenge_assignment cca
      ON cca.challenge_id = ch.id AND cca.candidate_id = ?2
    WHERE ch.stage_id = ?1
    ORDER BY ch.sort_order ASC
  `)
    .bind(candidate.current_stage_id, candidateId)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ error: 'Challenge not found at this order index' }, 404);
  }

  const ch = rows[dbOrder] as Record<string, unknown>;

  // Use the LEFT JOIN result to skip matching when an assignment already exists
  let hasAssignment = !!(ch.assignment_id as string | null);
  if (!hasAssignment) {
    const gateResult = await checkMatchingGate(c.env.DB, candidateId, pipelineId as string, candidate.current_stage_id, ch.id as string, ch.type as string, c.env);
    if (gateResult.blocked && gateResult.syntheticChallenge) {
      if (ch.type === 'CODE_REVIEW') {
        return c.json(profileReceivedChallengeContent());
      }
      return c.json(gateResult.syntheticChallenge);
    }
  } else if (
    ch.type === 'CODE_REVIEW'
    && typeof ch.assignment_repo_url === 'string'
    && typeof ch.assignment_pr_number === 'number'
    && !(await hasSourceBackedReviewPacket(
      c.env.DB,
      ch.assignment_repo_url,
      ch.assignment_pr_number,
    ))
  ) {
    const gateResult = await checkMatchingGate(
      c.env.DB,
      candidateId,
      pipelineId as string,
      candidate.current_stage_id,
      ch.id as string,
      ch.type as string,
      c.env,
    );
    if (gateResult.blocked && gateResult.syntheticChallenge) {
      return c.json(profileReceivedChallengeContent());
    }
    const refreshed = await c.env.DB.prepare(
      `SELECT github_repo_url, github_pr_number, issue_number
         FROM candidate_challenge_assignment
        WHERE candidate_id = ?1 AND stage_id = ?2`,
    ).bind(candidateId, candidate.current_stage_id).first<{
      github_repo_url: string | null;
      github_pr_number: number | null;
      issue_number: number | null;
    }>();
    if (!refreshed?.github_repo_url || typeof refreshed.github_pr_number !== 'number') {
      if ((ch.type as string) === 'CODE_REVIEW') {
        return c.json(profileReceivedChallengeContent());
      }
      return c.json(waitingForMatch('Source-backed review assignment is not ready').syntheticChallenge);
    }
    ch.effective_repo_url = refreshed.github_repo_url;
    ch.effective_pr_number = refreshed.github_pr_number;
    ch.effective_issue_number = refreshed.issue_number;
  }

  if ((ch.type as string) === 'CODE_REVIEW') {
    const currentAssignment = await c.env.DB.prepare(
      `SELECT id, repo_id, github_repo_url, github_pr_number, issue_number
         FROM candidate_challenge_assignment
        WHERE candidate_id = ?1 AND stage_id = ?2`,
    ).bind(candidateId, candidate.current_stage_id).first<{
      id: string;
      repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      issue_number: number | null;
    }>();
    if (currentAssignment) {
      hasAssignment = true;
      ch.assignment_id = currentAssignment.id;
      ch.repo_id = currentAssignment.repo_id;
      ch.assignment_repo_url = currentAssignment.github_repo_url;
      ch.assignment_pr_number = currentAssignment.github_pr_number;
      ch.effective_repo_url = currentAssignment.github_repo_url;
      ch.effective_pr_number = currentAssignment.github_pr_number;
      ch.effective_issue_number = currentAssignment.issue_number;
    }
  }

  // Apply per-candidate overrides from the LEFT JOIN
  if (ch.effective_repo_url) {
    ch.github_repo_url = ch.effective_repo_url;
  }
  if (typeof ch.effective_pr_number === 'number') {
    ch.github_pr_number = ch.effective_pr_number;
  }

  // Parse config JSON if stored as string
  let config: unknown = null;
  if (ch.config) {
    try {
      config =
        typeof ch.config === 'string' ? JSON.parse(ch.config) : ch.config;
    } catch {
      config = null;
    }
  }

  // Inject stage-level screening_input_mode into QUIZ_SHORT_ANSWER challenges
  // so candidates see the format (text / voice / video) configured by the recruiter.
  // Challenge-level config takes precedence — only fall back to stage default when
  // the challenge itself has not explicitly set an inputMode.
  if ((ch.type as string) === 'QUIZ_SHORT_ANSWER' && stageInfo?.screening_input_mode) {
    const cfg = (config ?? {}) as Record<string, unknown>;
    if (!cfg.inputMode) {
      cfg.inputMode = stageInfo.screening_input_mode;
      config = cfg;
    }
  }

  // Parse cached diff JSON if stored as string
  let cachedDiffJson: unknown = null;
  let cachedMetadata: Record<string, unknown> | null = null;
  const assignmentBackedReview = (ch.type as string) === 'CODE_REVIEW' && hasAssignment;
  if (!assignmentBackedReview && ch.cached_diff_json) {
    try {
      cachedDiffJson =
        typeof ch.cached_diff_json === 'string'
          ? JSON.parse(ch.cached_diff_json as string)
          : ch.cached_diff_json;
    } catch {
      cachedDiffJson = null;
    }
  }
  if (ch.cached_metadata) {
    try {
      const parsedMetadata = typeof ch.cached_metadata === 'string'
        ? JSON.parse(ch.cached_metadata as string)
        : ch.cached_metadata;
      cachedMetadata = typeof parsedMetadata === 'object'
        && parsedMetadata !== null
        && !Array.isArray(parsedMetadata)
        ? parsedMetadata as Record<string, unknown>
        : null;
    } catch {
      cachedMetadata = null;
    }
  }

  // Self-heal: if diff is missing but repo+PR exist, fetch and cache it now
  // Use the potentially overridden values from candidate_challenge_assignment
  const effectiveRepoUrl = ch.github_repo_url as string | null;
  const effectivePrNumber = ch.github_pr_number as number | null;
  let reviewProfile: unknown = cachedMetadata?.reviewProfile ?? null;
  if (assignmentBackedReview) {
    const sourceBackedDiff = effectiveRepoUrl && effectivePrNumber
      ? await loadSourceBackedReviewDiff(c.env.DB, effectiveRepoUrl, effectivePrNumber)
      : null;
    if (sourceBackedDiff) {
      cachedDiffJson = sourceBackedDiff.diff;
      ch.github_pr_title = sourceBackedDiff.metadata.title;
      ch.github_pr_description = sourceBackedDiff.metadata.description ?? null;
      reviewProfile = sourceBackedDiff.metadata.reviewProfile ?? null;
    } else {
      if ((ch.type as string) === 'CODE_REVIEW') {
        return c.json(profileReceivedChallengeContent());
      }
      return c.json(waitingForMatch('Source-backed review assignment is not ready').syntheticChallenge);
    }
  } else if (!cachedDiffJson && effectiveRepoUrl && effectivePrNumber) {
    try {
      const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
      const result = await fetchGitHubDiff(
        effectiveRepoUrl,
        effectivePrNumber,
        token,
      );
      if (result) {
        cachedDiffJson = result.diff;
        cachedMetadata = result.metadata;
        reviewProfile = result.metadata.reviewProfile ?? reviewProfile;
        // Persist so we don't fetch again next time
        await c.env.DB.prepare(
          `UPDATE challenges SET cached_diff_json = ?1, cached_metadata = ?2, diff_cached_at = ?3 WHERE id = ?4`,
        )
          .bind(
            JSON.stringify(result.diff),
            JSON.stringify(result.metadata),
            new Date().toISOString(),
            ch.id as string,
          )
          .run();
      }
    } catch (err) {
      console.error('[rpc/get-challenge] Self-heal diff fetch failed:', err);
    }
  }

  // SECURITY: Never expose server_config or ground truth.
  // Challenge ID (UUID) is safe — needed for file browser + review session scoping.
  const response: Record<string, unknown> = {
    id: ch.id,
    type: ch.type,
    title: ch.title,
    instructions: ch.instructions,
    config,
    cachedDiffJson,
    githubPrTitle: ch.github_pr_title ?? null,
    githubPrNumber: ch.github_pr_number ?? null,
    githubRepoUrl: ch.github_repo_url ?? null,
    githubPrDescription: ch.github_pr_description ?? null,
    reviewProfile,
    devContainerRepoUrl: (
      (ch.type as string) === 'CODE_IMPLEMENTATION'
        ? (ch.effective_repo_url as string | null)
        : null
    ) ?? (ch.dev_container_repo_url as string | null) ?? null,
  };

  if ((ch.type as string) === 'CODE_REVIEW') {
    const chConfig = typeof ch.config === 'string' ? JSON.parse(ch.config) : (ch.config as Record<string, unknown> | null);
    if (chConfig?.isMultiTurn === true) {
      response.reviewSession = {
        requiresInit: true,
        challengeId: ch.id as string,
      };
    }
    if (
      hasAssignment
      && typeof ch.github_pr_number === 'number'
    ) {
      response.matchExplanation = await loadCachedStandaloneReviewMatchExplanation(
        c.env.DB,
        candidateId,
        typeof (ch as { repo_id?: unknown }).repo_id === 'number' ? (ch as { repo_id: number }).repo_id : null,
        ch.github_pr_number,
      );
    }
  }

  // Fetch source issue text for CODE_IMPLEMENTATION challenges.
  const effectiveIssueNumber = ch.effective_issue_number as number | null;
  if (
    (ch.type as string) === 'CODE_IMPLEMENTATION' &&
    effectiveRepoUrl &&
    effectiveIssueNumber
  ) {
    try {
      const issueRow = await c.env.DB
        .prepare(
          `SELECT ri.title, ri.body, ri.labels_json, ri.body_cache_json
           FROM repo_issues ri
           JOIN qualified_repos qr ON ri.repo_id = qr.id
           WHERE qr.github_url = ?1 AND ri.issue_number = ?2`,
        )
        .bind(effectiveRepoUrl, effectiveIssueNumber)
        .first<{
          title: string;
          body: string | null;
          labels_json: string | null;
          body_cache_json: string | null;
        }>();

      if (issueRow?.body_cache_json) {
        try {
          const cache = JSON.parse(issueRow.body_cache_json) as {
            title?: string;
            body?: string;
            labels?: string[];
          };
          response.issueBody = {
            title: cache.title ?? null,
            body: cache.body ?? null,
            labels: cache.labels ?? [],
          };
        } catch {
          // malformed cache JSON — ignore
        }
      }
      if (issueRow && !response.issueBody) {
        let labels: string[] = [];
        try {
          const parsed = issueRow.labels_json ? JSON.parse(issueRow.labels_json) : [];
          labels = Array.isArray(parsed)
            ? parsed.filter((label): label is string => typeof label === 'string')
            : [];
        } catch {
          labels = [];
        }
        response.issueBody = {
          title: issueRow.title,
          body: issueRow.body,
          labels,
        };
      }
    } catch (err) {
      console.error('[rpc/get-challenge] Failed to load issue body cache:', err);
    }
  }

  return c.json(response);
});

// ── Candidate repo-task assessment progress/submission ─────────────────────

rpcAuth.get('/assessment/progress', async (c) => {
  const candidateId = c.get('candidateId');
  const assessmentSession = await loadLatestAssessmentSessionForCandidate(c.env.DB, candidateId);
  if (!assessmentSession) {
    return c.json({ progress: null });
  }

  try {
    const progress = await new RepoTaskInterviewSessionStore(c.env.DB).loadProgress(assessmentSession.id);
    return c.json({ progress: serializeCandidateAssessmentProgress(progress) });
  } catch (error) {
    console.error('[rpc/assessment/progress] failed:', {
      candidateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return candidateAssessmentErrorResponse('Assessment progress failed.', 500);
  }
});

rpcAuth.post('/assessment/commit-submission', async (c) => {
  const candidateId = c.get('candidateId');
  const body = candidateCommitSubmissionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return candidateAssessmentErrorResponse(
      body.error.issues[0]?.message ?? 'Invalid commit submission body.',
      422,
    );
  }

  const assessmentSession = await loadLatestAssessmentSessionForCandidate(c.env.DB, candidateId);
  if (!assessmentSession) {
    return candidateAssessmentErrorResponse(
      'No open-source assessment session is available for this candidate.',
      409,
    );
  }

  const store = new RepoTaskInterviewSessionStore(c.env.DB);
  const commitSha = body.data.commitSha.trim().toLowerCase();
  try {
    await store.submitCommit({
      sessionId: assessmentSession.id,
      ingestionKey: `assessment-event:candidate-commit:${assessmentSession.id}:${commitSha}`,
      actorType: 'candidate',
      actorId: candidateId,
      narrative: body.data.narrative,
      repositoryUrl: body.data.repositoryUrl,
      forkRepositoryUrl: body.data.forkRepositoryUrl,
      branchName: body.data.branchName,
      baseCommitSha: body.data.baseCommitSha,
      commitSha: body.data.commitSha,
      commitUrl: body.data.commitUrl,
      upstreamPullRequestUrl: body.data.upstreamPullRequestUrl,
      upstreamPrConsent: body.data.upstreamPrConsent,
      changedFiles: body.data.changedFiles,
      occurredAt: body.data.occurredAt,
      sourceRefs: body.data.sourceRefs,
    });
    const progress = await store.loadProgress(assessmentSession.id);
    return c.json({
      submission: {
        accepted: true,
        repositoryUrl: progress.commit?.repositoryUrl ?? body.data.repositoryUrl,
        branchName: progress.commit?.branchName ?? body.data.branchName,
        commitSha: progress.commit?.commitSha ?? commitSha,
        commitUrl: progress.commit?.commitUrl ?? body.data.commitUrl ?? null,
      },
      progress: serializeCandidateAssessmentProgress(progress),
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commit submission failed.';
    if (message.includes('does not exist')) {
      return candidateAssessmentErrorResponse(message, 404);
    }
    if (
      message.includes('requires')
      || message.includes('must')
      || message.includes('cannot transition')
    ) {
      return candidateAssessmentErrorResponse(message, 422);
    }
    console.error('[rpc/assessment/commit-submission] failed:', {
      candidateId,
      error: message,
    });
    return candidateAssessmentErrorResponse('Commit submission failed.', 500);
  }
});

// ── POST /rpc/submit-challenge-response ─────────────────────────────────────

rpcAuth.post('/submit-challenge-response', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  const submission = body.submission;

  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
      400,
    );
  }

  if (submission === undefined || submission === null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'submission is required.' } },
      400,
    );
  }

  const startClaim = await claimCandidateInviteTokenForAssessmentStart(
    c.env.DB,
    candidateId,
    c.get('inviteToken'),
  );
  if (!startClaim.ok) {
    return c.json({ error: startClaim.error }, startClaim.status);
  }

  // Pipeline-free candidate (talent pool / standalone code review)
  if (!pipelineId) {
    if (parseIntakePayload(submission)) {
      await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, new Date().toISOString());
      const standaloneReview = await getPendingStandaloneReview(c.env.DB, candidateId);
      if (await hasReadyStandaloneCodeReviewAssignment(c.env.DB, candidateId, standaloneReview)) {
        return c.json({
          success: true,
          next: true,
          message: 'INTAKE submission received',
        });
      }
      return c.json({
        success: true,
        complete: true,
        queued: true,
        message: 'INTAKE queued for background processing',
      });
    }

    const standaloneReview = await getPendingStandaloneReview(c.env.DB, candidateId);
    if (standaloneReview) {
      const match = await loadReadyStandaloneCodeReviewAssignment(c.env.DB, candidateId, standaloneReview);
      if (!match) {
        await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
        return c.json({
          success: true,
          complete: true,
          queued: true,
          message: 'Code review assignment is not ready yet',
        });
      }
      const now = new Date().toISOString();
      const responseJson = typeof submission === 'string' ? submission : JSON.stringify(submission);
      await c.env.DB.prepare(
        `UPDATE scheduled_interviews
         SET submission_json = ?1, status = 'COMPLETED', completed_at = ?2, updated_at = ?2
         WHERE id = ?3`,
      ).bind(responseJson, now, standaloneReview.id).run();
      return c.json({ success: true, next: true, message: 'Code review submission received' });
    }

    return c.json({ success: true, next: true, message: 'INTAKE submission received' });
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ success: false, error: 'No active stage' }, 404);
  }

  const stageId = candidate.current_stage_id;

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode FROM stages WHERE id = ?1`
  )
    .bind(stageId)
    .first<{ mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0);

  // Synthetic CV intake submission (code-stage gate): the stage has no INTAKE
  // challenge row, so persist the intake data directly.
  if (parseIntakePayload(submission)) {
    const codeChallenge = await c.env.DB.prepare(
      `SELECT id FROM challenges WHERE stage_id = ?1 AND type IN ('CODE_REVIEW', 'CODE_IMPLEMENTATION') LIMIT 1`,
    ).bind(stageId).first<{ id: string }>();
    const intakeChallenge = await c.env.DB.prepare(
      `SELECT id FROM challenges WHERE stage_id = ?1 AND type = 'INTAKE' LIMIT 1`,
    ).bind(stageId).first<{ id: string }>();
    if (codeChallenge && !intakeChallenge) {
      await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, new Date().toISOString());
      return c.json({
        success: true,
        complete: true,
        queued: true,
        message: 'INTAKE queued for background processing',
      });
    }
  }

  // Synthetic challenges (WELCOME, LIVE_VIDEO) — no DB write needed
  if (order < syntheticCount) {
    return c.json({ success: true, next: true });
  }

  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered
  const challenges = await c.env.DB.prepare(`
    SELECT id, type, sort_order, server_config
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(stageId)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ success: false, error: 'Challenge not found at this order index' }, 404);
  }

  const challenge = rows[dbOrder] as Record<string, unknown>;

  if (challenge.type === 'WAITING_FOR_MATCH') {
    return c.json({ error: 'Challenge not ready. Please wait for matching to complete.' }, 409);
  }

  const challengeId = challenge.id as string;

  // Get or create assessment for this stage
  let assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, stageId)
    .first<{ id: string }>();

  const now = new Date().toISOString();

  if (!assessment) {
    const assessmentId = crypto.randomUUID();
    const ownerRow = await c.env.DB.prepare(
      `SELECT owner_id FROM candidates WHERE id = ?1`,
    )
      .bind(candidateId)
      .first<{ owner_id: string }>();

    await c.env.DB.prepare(`
      INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'IN_PROGRESS', ?4, ?5, ?5, ?5)
    `)
      .bind(assessmentId, candidateId, stageId, ownerRow?.owner_id ?? null, now)
      .run();

    assessment = { id: assessmentId };
  }

  // Check for duplicate submission
  const existing = await c.env.DB.prepare(
    `SELECT id, response_json FROM challenge_submissions
     WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
  )
    .bind(assessment.id, challengeId)
    .first<{ id: string; response_json: string | null }>();

  const responseJson = typeof submission === 'string' ? submission : JSON.stringify(submission);
  let submissionId: string;

  if (existing) {
    // Allow resubmission if the previous response was empty (fixes React input
    // race-condition that creates blank submissions — Bug #1).
    let wasEmpty = false;
    try {
      const prev = JSON.parse(existing.response_json || '{}') as Record<string, unknown>;
      wasEmpty =
        !prev ||
        Object.keys(prev).length === 0 ||
        (prev.inputMode === 'text' && (prev.text as string)?.trim() === '');
    } catch {
      wasEmpty = true;
    }

    if (!wasEmpty) {
      const parsedSubmission = parseSubmissionObject(submission);
      const reviewSessionId = typeof parsedSubmission?.reviewSessionId === 'string'
        ? parsedSubmission.reviewSessionId
        : null;
      if (challenge.type === 'CODE_REVIEW' && reviewSessionId) {
        const completedReviewSession = await c.env.DB.prepare(
          `SELECT id FROM review_sessions
           WHERE id = ?1
             AND assessment_id = ?2
             AND challenge_id = ?3
             AND candidate_id = ?4
             AND status IN ('verdict_submitted', 'scoring', 'scored', 'scoring_failed')
           LIMIT 1`,
        )
          .bind(reviewSessionId, assessment.id, challengeId, candidateId)
          .first<{ id: string }>();

        if (completedReviewSession) {
          return c.json({
            success: true,
            next: true,
            message: 'Code review session already completed',
          });
        }
      }

      return c.json(
        { success: false, error: 'Challenge already submitted' },
        409,
      );
    }

    // Update existing empty submission with new response
    submissionId = existing.id;
    await c.env.DB.prepare(`
      UPDATE challenge_submissions
      SET response_json = ?1, updated_at = ?2, submitted_at = ?2
      WHERE id = ?3
    `)
      .bind(responseJson, now, submissionId)
      .run();
  } else {
    // Create ChallengeSubmission
    submissionId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO challenge_submissions (id, assessment_id, challenge_id, candidate_id, response_json, submitted_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
    `)
      .bind(submissionId, assessment.id, challengeId, candidateId, responseJson, now)
      .run();
  }

  // ── INTAKE challenge: trigger background enrichment ────────────────────────
  if (challenge.type === 'INTAKE') {
    await handleIntakePayload(c.env, c.executionCtx, candidateId, submission, now);
    return c.json({
      success: true,
      complete: true,
      queued: true,
      message: 'INTAKE queued for background processing',
    });
  }

  return c.json({
    success: true,
    challengeSubmissionId: submissionId,
  });
});

// ── POST /rpc/score-submission ──────────────────────────────────────────────

rpcAuth.post('/score-submission', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeSubmissionId = body.challengeSubmissionId;
  if (typeof challengeSubmissionId !== 'string' || !challengeSubmissionId) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeSubmissionId is required.' } },
      400,
    );
  }

  // Fetch submission + challenge
  const sub = await c.env.DB.prepare(`
    SELECT cs.id, cs.response_json, cs.assessment_id,
           ch.type, ch.server_config
    FROM challenge_submissions cs
    JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE cs.id = ?1
  `)
    .bind(challengeSubmissionId)
    .first<{
      id: string;
      response_json: string | null;
      assessment_id: string;
      type: string;
      server_config: string | null;
    }>();

  if (!sub) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Submission not found.' } }, 404);
  }

  // CODE_IMPLEMENTATION: trigger async Sherlock scoring, return 202 immediately
  if (sub.type === 'CODE_IMPLEMENTATION') {
    console.log(`[submissions] implementation scoring triggered for submission ${challengeSubmissionId}`);
    c.executionCtx.waitUntil(scoreImplementationSubmission(challengeSubmissionId, c.env));
    return c.json({ success: true, status: 'scoring_in_progress' }, 202);
  }

  let score: number | null = null;
  let feedback: string | null = null;
  const now = new Date().toISOString();

  // Deterministic scoring for QUIZ_MCQ
  if (sub.type === 'QUIZ_MCQ') {
    let serverConfig: Record<string, unknown> = {};
    if (sub.server_config) {
      try {
        serverConfig = JSON.parse(sub.server_config) as Record<string, unknown>;
      } catch { /* empty config */ }
    }

    let response: Record<string, unknown> = {};
    if (sub.response_json) {
      try {
        response = JSON.parse(sub.response_json) as Record<string, unknown>;
      } catch { /* empty response */ }
    }

    const correctOptionId = serverConfig.correctOptionId as string | undefined;
    const answers = response.answers as Record<string, string> | undefined;
    const selectedAnswer = answers?.current;

    if (correctOptionId && selectedAnswer) {
      score = selectedAnswer === correctOptionId ? 100 : 0;
      feedback = score === 100 ? 'Correct answer' : 'Incorrect answer';
    } else {
      // No correct answer configured — score as 0
      score = 0;
      feedback = 'No scoring criteria configured for this challenge';
    }
  }

  // Auto-scoring for QUIZ_SHORT_ANSWER (heuristic + keyword-based)
  if (sub.type === 'QUIZ_SHORT_ANSWER') {
    let serverConfig: Record<string, unknown> = {};
    if (sub.server_config) {
      try {
        serverConfig = JSON.parse(sub.server_config) as Record<string, unknown>;
      } catch { /* empty config */ }
    }

    let response: Record<string, unknown> = {};
    if (sub.response_json) {
      try {
        response = JSON.parse(sub.response_json) as Record<string, unknown>;
      } catch { /* empty response */ }
    }

    // QUIZ_SHORT_ANSWER submissions use either { text: '...' } or { answers: { current: '...' } }
    const textAnswer = (response.text as string | undefined)?.trim() ?? '';
    const answers = response.answers as Record<string, string> | undefined;
    const answerText = textAnswer || (answers?.current ?? '').trim();

    if (!answerText) {
      score = 0;
      feedback = 'No answer provided.';
    } else {
      // Keyword-based scoring if configured
      const keywords = serverConfig.keywords as Array<{ word: string; weight: number }> | undefined;
      if (keywords && keywords.length > 0) {
        const normalized = answerText.toLowerCase();
        const totalWeight = keywords.reduce((s, k) => s + k.weight, 0);
        const earned = keywords.reduce((s, k) =>
          normalized.includes(k.word.toLowerCase()) ? s + k.weight : s, 0);
        score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 70;
        feedback = `Auto-scored: ${earned}/${totalWeight} keyword criteria matched.`;
      } else {
        // Heuristic length-based scoring for engagement
        const len = answerText.length;
        if (len < 5) {
          score = 20;
          feedback = 'Very brief answer — auto-scored at 20.';
        } else if (len < 20) {
          score = 50;
          feedback = 'Short answer — auto-scored at 50.';
        } else if (len < 50) {
          score = 70;
          feedback = 'Reasonable answer — auto-scored at 70.';
        } else {
          score = 90;
          feedback = 'Detailed answer — auto-scored at 90.';
        }
      }
    }
  }

  // Update submission with score
  if (score !== null) {
    await c.env.DB.prepare(`
      UPDATE challenge_submissions
      SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
      WHERE id = ?4
    `)
      .bind(score, feedback, now, challengeSubmissionId)
      .run();

    // Re-aggregate assessment score (average of all child submissions)
    await c.env.DB.prepare(`
      UPDATE assessments
      SET score = (
        SELECT AVG(score) FROM challenge_submissions
        WHERE assessment_id = ?1 AND score IS NOT NULL
      ), updated_at = ?2
      WHERE id = ?1
    `)
      .bind(sub.assessment_id, now)
      .run();
  }

  return c.json({
    success: true,
    score,
    feedback,
  });
});

// ── POST /rpc/submit-status ────────────────────────────────────────────────

rpcAuth.post('/submit-status', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const status = body.status;
  if (typeof status !== 'string' || !['COMPLETED', 'ABANDONED'].includes(status)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'status must be COMPLETED or ABANDONED.' } },
      400,
    );
  }

  const now = new Date().toISOString();

  // Update candidate status
  await c.env.DB.prepare(
    `UPDATE candidates SET status = ?1, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(status, now, candidateId)
    .run();

  // Also update any in-progress assessments for this candidate
  await c.env.DB.prepare(
    `UPDATE assessments SET status = ?1, completed_at = ?2, updated_at = ?2
     WHERE candidate_id = ?3 AND status = 'IN_PROGRESS'`,
  )
    .bind(status, now, candidateId)
    .run();

  return c.json({ success: true });
});

// ── GET /rpc/candidate-profile ──────────────────────────────────────────────

rpcAuth.get('/candidate-profile', async (c) => {
  const candidateId = c.get('candidateId');
  const db = c.env.DB;

  const row = await db.prepare(
    `SELECT candidate_profile_json FROM candidate_ingestion WHERE candidate_id = ?1`
  )
    .bind(candidateId)
    .first<{ candidate_profile_json: string | null }>();

  if (!row || !row.candidate_profile_json) {
    return c.json({ profile: null, error: 'profile_not_found' }, 404);
  }

  try {
    const profile = JSON.parse(row.candidate_profile_json) as unknown;
    return c.json({ profile });
  } catch {
    return c.json({ profile: null, error: 'profile_parse_error' }, 500);
  }
});

// ── POST /rpc/upload-media ──────────────────────────────────────────────────
//
// Accepts a media file (audio or video) as multipart/form-data and writes it
// directly to R2. Returns the R2 key so the frontend can store it in the
// submission JSON.
//
// Field layout:
//   file        — the binary blob (Blob/File)
//   challengeId — string identifier for the challenge (used in R2 path)
//
// R2 path: candidate-submissions/{candidateId}/{challengeId}.webm
// Auth: candidate JWT (candidateId extracted from verified token)

/** Maximum accepted media file size: 50 MB. */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** MIME type guard — accepts audio/*, video/*, and document uploads. */
function isAllowedMime(mimeType: string): boolean {
  return (
    /^(audio|video)\//.test(mimeType) ||
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

// ── GET /rpc/ingestion-status ───────────────────────────────────────────────
// Candidate-facing ingestion status — returns the current state of the
// candidate_ingestion row so the intake app can show live progress.

rpcAuth.get('/ingestion-status', async (c) => {
  const candidateId = c.get('candidateId');

  const row = await c.env.DB.prepare(
    `SELECT status, current_step, candidate_searchable_profile, key_concepts_json,
            error_text, estimated_completion_at, updated_at
     FROM candidate_ingestion
     WHERE candidate_id = ?1`,
  )
    .bind(candidateId)
    .first<{
      status: string;
      current_step: string | null;
      candidate_searchable_profile: string | null;
      key_concepts_json: string | null;
      error_text: string | null;
      estimated_completion_at: string | null;
      updated_at: string | null;
    }>();

  if (!row) {
    return c.json({ status: 'not_started', current_step: null, candidate_searchable_profile: null, key_concepts_json: null, error_text: null, estimated_completion_at: null });
  }

  const retryQueued = await maybeQueueRetryableStandaloneIngestion(c.env, optionalExecutionContext(c), candidateId);
  if (retryQueued) {
    return c.json({
      status: 'pending',
      current_step: 'retry_queued',
      candidate_searchable_profile: row.candidate_searchable_profile,
      key_concepts_json: row.key_concepts_json,
      error_text: null,
      estimated_completion_at: row.estimated_completion_at,
      updated_at: new Date().toISOString(),
      retry_queued: true,
      retry_reason: retryQueued.reason,
    });
  }

  return c.json(row);
});

rpcAuth.post('/upload-media', async (c) => {
  const candidateId = c.get('candidateId');

  // Parse multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request must be multipart/form-data.' } },
      400,
    );
  }

  const fileEntry = formData.get('file') as File | string | null;
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'No "file" field found in the request.' } },
      400,
    );
  }

  const challengeIdEntry = formData.get('challengeId');
  if (typeof challengeIdEntry !== 'string' || !challengeIdEntry.trim()) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: '"challengeId" field is required.' } },
      400,
    );
  }
  const challengeId = challengeIdEntry.trim();

  // Validate MIME type — must be audio/*, video/*, PDF, or DOCX
  if (!isAllowedMime(fileEntry.type)) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Only audio/*, video/*, application/pdf, and application/vnd.openxmlformats-officedocument.wordprocessingml.document MIME types are accepted.',
        },
      },
      415,
    );
  }

  // Validate size
  if (fileEntry.size > MAX_MEDIA_BYTES) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'File exceeds the 50 MB limit.' } },
      413,
    );
  }

  // Derive R2 key and extension based on file type
  const isDocument = fileEntry.type === 'application/pdf' || fileEntry.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  let ext: string;
  let r2Key: string;
  if (isDocument) {
    ext = fileEntry.type === 'application/pdf' ? 'pdf' : 'docx';
    const rawName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    r2Key = `candidate-documents/${candidateId}/${rawName}`;
  } else {
    const mimeSubtype = fileEntry.type.split('/')[1] ?? 'webm';
    ext = mimeSubtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'webm';
    r2Key = `candidate-submissions/${candidateId}/${challengeId}.${ext}`;
  }

  // Write to R2
  if (!c.env.STORAGE) {
    console.error('[rpc/upload-media] R2 STORAGE binding not configured');
    return c.json(
      { error: { code: 'SERVER_ERROR', message: 'Storage not configured.' } },
      503,
    );
  }
  const arrayBuffer = await fileEntry.arrayBuffer();
  await c.env.STORAGE.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: fileEntry.type },
    customMetadata: { candidateId, challengeId },
  });

  console.log('[rpc/upload-media] Stored media', { candidateId, challengeId, r2Key, size: fileEntry.size });

  // ── Auto-ingest resume documents ───────────────────────────────────────────
  // Document uploads (PDF/DOCX) are always resumes. Run ingestion immediately
  // so the candidate graph is live before they proceed to the next stage.
  if (isDocument) {
    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(`UPDATE candidates SET resume_s3_key = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(r2Key, now, candidateId)
        .run();
    } catch (err) {
      console.error(`[rpc/upload-media] failed to update candidate resume key:`, err);
    }

    // Run ingestion immediately — candidate graph must be live before they proceed
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const result = await processResumeFromR2({
            env: c.env,
            db: c.env.DB,
            candidateId,
            r2Key,
          });
          console.log(`[rpc/upload-media] resume ingestion for candidate ${candidateId}:`, result.success);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rpc/upload-media] resume ingestion failed for ${candidateId}:`, msg);
        }
      })(),
    );
  }

  // Auto-transcribe audio files via Workers AI Whisper (free, at-edge)
  let transcript: string | null = null;
  if (fileEntry.type.startsWith('audio/') && c.env.AI) {
    try {
      const result = await c.env.AI.run('@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0], {
        audio: [...new Uint8Array(arrayBuffer)],
      }) as { text?: string };
      transcript = result.text?.trim() || null;
      console.log('[rpc/upload-media] Whisper transcript:', transcript?.slice(0, 100));
    } catch (err) {
      console.error('[rpc/upload-media] Whisper transcription failed:', err);
    }
  }

  return c.json({ r2Key, uploadUrl: null, transcript }, 201);
});

// ── POST /rpc/get-scheduled-interview ──────────────────────────────────────

rpcAuth.post('/get-scheduled-interview', async (c) => {
  const candidateId = c.get('candidateId');
  const db = c.env.DB;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const stageId = body['stageId'];
  if (!stageId || typeof stageId !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'stageId is required.' } }, 400);
  }

  const interview = await db
    .prepare(
      `SELECT id, candidate_id, pipeline_id, stage_id, status,
              scheduled_at, meeting_url, scheduling_provider, scheduling_url,
              created_at, updated_at
       FROM scheduled_interviews
       WHERE candidate_id = ? AND stage_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(candidateId, stageId)
    .first<{
      id: string;
      candidate_id: string;
      pipeline_id: string;
      stage_id: string;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!interview) {
    return c.json({ interview: null });
  }

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      meetingUrl: interview.meeting_url,
      schedulingProvider: interview.scheduling_provider,
      schedulingUrl: interview.scheduling_url,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
});

// ─── Mount multi-turn review sub-router ─────────────────────────────────────

rpcAuth.route('/review', review);
rpcAuth.route('/repo', repo);
rpcAuth.route('/dev-container', devContainer);

// ─── Mount agent-interview bridge router ──────────────────────────────────────
// Bridges frontend candidateConversationAdapter to the culture interview engine.
import { agentInterviewRouter } from './assessment/agentInterview';
rpcAuth.route('/agent-interview', agentInterviewRouter);

// ─── Mount culture interview candidate sub-router ────────────────────────────
// Culture routes use path-param token auth (the session JWT is the :token URL
// param, not an Authorization header). Mount on rpcPublic so candidateAuth
// middleware doesn't intercept before the route handler reads its own token.
// Each handler calls verifyJwt internally. See screening/culture.ts.
rpcPublic.route('/culture', cultureCandidate);

// ─── Mount dev-container exchange-token proxy (public) ────────────────────────
// The iframe proxy accepts exchange tokens instead of JWTs to prevent token
// leakage via Referer headers. Exchange tokens are single-use, 30-second TTL.
// The client calls POST /rpc/dev-container/:sessionId/exchange-token (authed)
// to get a token, then loads the iframe at /rpc/dev-container-proxy/:sessionId/?exchangeToken=...
rpcPublic.route('/dev-container-proxy', devContainerProxyPublic);

export { rpcPublic, rpcAuth };
