/**
 * Scheduling routes — OAuth, webhooks, and interview management.
 *
 * Recruiter routes (Clerk JWT auth):
 *   POST   /api/v1/scheduling/connect       — initiate OAuth flow
 *   POST   /api/v1/scheduling/callback       — OAuth token exchange
 *   GET    /api/v1/scheduling/connection      — get current connection
 *   DELETE /api/v1/scheduling/connection      — disconnect provider
 *   GET    /api/v1/scheduling/event-types     — list provider event types
 *   GET    /api/v1/scheduling/interviews      — list scheduled interviews
 *   GET    /api/v1/scheduling/interviews/:id  — scheduled interview detail
 *   POST   /api/v1/scheduling/interviews      — create scheduled interview
 *   PATCH  /api/v1/scheduling/interviews/:id  — update interview status
 *
 * Public route (webhook, no auth):
 *   POST   /api/v1/scheduling/webhook         — receive provider webhook events
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { sendTransactionalEmail } from '../../lib/transactionalEmail';
import { buildPipeEmailLogoImg, resolvePipeEmailLogoUrl } from '../../lib/emailAssets';
import { ensureUsableCandidateInviteToken, isClaimedInviteToken } from '../../lib/candidateInviteTokens';
import { ensureMeetingRoomLinks, withDevBasicAuth } from '../meetingRooms';
import {
  OPEN_TERM_RESOLVER_VERSION,
  LivingContextStore,
  openSemanticTerm,
  deterministicEntityId,
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  loadCandidateLivingContext,
  loadCandidateLivingContextSummary,
  loadContactLivingContextSummary,
  type ContextRecordConceptInput,
  type ContextRecordEntityInput,
  type ContextRecordSourceInput,
  type JsonObject,
} from '../../lib/livingContext';
import { AssessmentLayerStore, type AssessmentEvidenceSourceRefInput } from '../../lib/assessmentLayer/persistence';
import { recordAssessmentCandidateProfileEvidence } from '../../lib/assessmentLayer/candidateProfileEvidence';
import {
  MATCHED_ASSESSMENT_ASSIGNMENT_DETAIL,
  RepoTaskInterviewSessionStore,
  type AssessmentEvidenceCoverageItem,
  type AssessmentEvidenceCoverageSnapshot,
  type AssessmentProgressSnapshot,
  type HumanAssessmentDecisionValue,
} from '../../lib/repoTaskInterviewSession';
import { evaluateRepoTaskAssessmentSession } from '../../lib/repoTaskAssessmentEvaluator';
import * as d1Matcher from '../../lib/challengeMatching/d1Matcher';
import type { CandidateReviewChallengeOptions } from '../../lib/challengeMatching/d1Matcher';
import {
  candidateSafeQualityGateFor,
  type CandidateSafeMatchStatus,
  type CandidateSafeQualityGateDiagnostic,
  type CandidateSafeQualityGateVerdict,
} from '../../lib/challengeMatching/candidateSafeQualityGate';
import { loadRoleChallengeSemantics } from '../../lib/challengeMatching/roleGuardrails';
import type { ChallengePacket, ChallengeReviewProfile } from '../../lib/repoSemanticGraph';
import type { Env, Variables } from '../../types';

// ─── Provider config ────────────────────────────────────────────────────────

interface ProviderOAuthConfig {
  tokenUrl: string;
  userInfoUrl?: string;
  eventTypesUrl?: string;
  webhookUrl?: string;
  clientId: string;
  clientSecret: string;
}

interface ProviderEventTypeSummary {
  id: string;
  name: string;
  durationMinutes: number;
  url: string;
  schedulingUrl: string;
}

interface CalendlyUserResource {
  uri?: string;
  name?: string;
  scheduling_url?: string;
  current_organization?: string;
}

interface CalendlyEventTypeResource {
  uri?: string;
  name?: string;
  duration?: number;
  scheduling_url?: string;
  slug?: string;
}

function getProviderConfig(providerId: string, env: Env): ProviderOAuthConfig | null {
  const calendlyClientId = (env as unknown as Record<string, string>)['CALENDLY_CLIENT_ID'] ?? '';
  const calendlyClientSecret = (env as unknown as Record<string, string>)['CALENDLY_CLIENT_SECRET'] ?? '';
  const calcomClientId = (env as unknown as Record<string, string>)['CALCOM_CLIENT_ID'] ?? '';
  const calcomClientSecret = (env as unknown as Record<string, string>)['CALCOM_CLIENT_SECRET'] ?? '';

  switch (providerId) {
    case 'CALENDLY':
      return {
        tokenUrl: 'https://auth.calendly.com/oauth/token',
        userInfoUrl: 'https://api.calendly.com/users/me',
        eventTypesUrl: 'https://api.calendly.com/event_types',
        webhookUrl: 'https://api.calendly.com/webhook_subscriptions',
        clientId: calendlyClientId.trim(),
        clientSecret: calendlyClientSecret.trim(),
      };
    case 'CAL_COM':
      return {
        tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
        eventTypesUrl: 'https://api.cal.com/v1/event-types',
        webhookUrl: 'https://api.cal.com/v1/webhooks',
        clientId: calcomClientId.trim(),
        clientSecret: calcomClientSecret.trim(),
      };
    default:
      return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

const SCHEDULED_INTERVIEWS_DEFAULT_LIMIT = 20;
const SCHEDULED_INTERVIEWS_MAX_LIMIT = 100;
type ScheduledInterviewsSort = 'created_desc' | 'created_asc' | 'scheduled_asc';

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function parseScheduledInterviewsSort(value: string | undefined): ScheduledInterviewsSort {
  if (value === 'created_asc' || value === 'scheduled_asc') return value;
  return 'created_desc';
}

function scheduledInterviewsOrderByClause(sort: ScheduledInterviewsSort): string {
  switch (sort) {
    case 'created_asc':
      return 'si.created_at ASC, si.id ASC';
    case 'scheduled_asc':
      return 'si.scheduled_at IS NULL ASC, si.scheduled_at ASC, si.created_at DESC, si.id ASC';
    case 'created_desc':
    default:
      return 'si.created_at DESC, si.id ASC';
  }
}

const connectSchema = z.object({
  providerId: z.enum(['CALENDLY', 'CAL_COM']),
  redirectUri: z.string().url(),
  codeChallenge: z.string().optional(),
});

const callbackSchema = z.object({
  providerId: z.enum(['CALENDLY', 'CAL_COM']),
  code: z.string().min(1),
  redirectUri: z.string().url(),
  codeVerifier: z.string().optional(),
});

export const INTERVIEW_TYPE_VALUES = [
  'VIDEO',
  'SCREENING',
  'CODE_REVIEW',
  'DEV_CONTAINER_CHALLENGE',
  'OPEN_SOURCE_BUG_FIX',
] as const;

type InterviewTypeValue = typeof INTERVIEW_TYPE_VALUES[number];

function isWorkspaceAssessmentInterviewType(value: string | null | undefined): value is Extract<
  InterviewTypeValue,
  'CODE_REVIEW' | 'DEV_CONTAINER_CHALLENGE' | 'OPEN_SOURCE_BUG_FIX'
> {
  return value === 'CODE_REVIEW'
    || value === 'DEV_CONTAINER_CHALLENGE'
    || value === 'OPEN_SOURCE_BUG_FIX';
}

function isAssessmentOnlyInviteInterviewType(value: string | null | undefined): value is 'CODE_REVIEW' {
  return value === 'CODE_REVIEW';
}

function isRoomBackedWorkspaceAssessmentInterviewType(
  value: string | null | undefined,
): value is Extract<InterviewTypeValue, 'DEV_CONTAINER_CHALLENGE' | 'OPEN_SOURCE_BUG_FIX'> {
  return value === 'DEV_CONTAINER_CHALLENGE' || value === 'OPEN_SOURCE_BUG_FIX';
}

interface ScheduledInterviewRoomFeatures {
  videoEnabled: boolean;
  workspaceEnabled: boolean;
  recordingEnabled: boolean;
  agentEnabled: boolean;
}

export function scheduledInterviewRoomFeatures(
  interviewType: string | null | undefined,
): ScheduledInterviewRoomFeatures {
  const workspaceAssessment = isWorkspaceAssessmentInterviewType(interviewType);
  return {
    videoEnabled: true,
    workspaceEnabled: workspaceAssessment,
    recordingEnabled: true,
    agentEnabled: workspaceAssessment,
  };
}

function scheduledInterviewAssessmentLabel(interviewType: string | null | undefined): string | null {
  switch (interviewType) {
    case 'OPEN_SOURCE_BUG_FIX':
      return 'open-source bug-fix assessment';
    case 'DEV_CONTAINER_CHALLENGE':
      return 'dev-container assessment';
    case 'CODE_REVIEW':
      return 'code-review assessment';
    default:
      return null;
  }
}

export function scheduledInterviewMeetingCopy(input: {
  candidateName: string;
  roleTitle: string;
  stageTitle: string;
  interviewType: string | null | undefined;
}): { title: string; description: string } {
  const assessmentLabel = scheduledInterviewAssessmentLabel(input.interviewType);
  if (!assessmentLabel) {
    return {
      title: `${input.candidateName} interview`,
      description: `${input.roleTitle} · ${input.stageTitle}`,
    };
  }
  return {
    title: `${input.candidateName} ${assessmentLabel}`,
    description: [
      input.roleTitle,
      input.stageTitle,
      'Controlled workspace with video, recording, chat, terminal, code-server, and real AI-bridge evidence',
    ].join(' · '),
  };
}

type ScheduledAssessmentSetupStatus =
  | 'not_applicable'
  | 'reviewable_task_assigned'
  | 'missing_reviewable_task'
  | 'waiting_for_candidate_evidence'
  | 'waiting_for_source_backed_match';

type ScheduledAssessmentSetupKind =
  | 'not_applicable'
  | 'github_pr'
  | 'manual_open_source_task'
  | 'matched_repo_without_pr'
  | 'auto_match';

type ScheduledAssessmentSetupSource =
  | 'not_workspace_assessment'
  | 'recruiter_manual_override'
  | 'matched_repo_id'
  | 'candidate_challenge_assignment'
  | 'contact_first_invite'
  | 'candidate_id';

type ScheduledAssessmentSetupNextAction =
  | 'NONE'
  | 'OPEN_ROOM_OR_WORKSPACE'
  | 'COLLECT_CANDIDATE_EVIDENCE'
  | 'RERUN_OR_ENRICH_MATCHING'
  | 'ATTACH_CHALLENGE_PACKET';

interface ScheduledAssessmentSetupProjection {
  status: ScheduledAssessmentSetupStatus;
  kind: ScheduledAssessmentSetupKind;
  source: ScheduledAssessmentSetupSource;
  blocksPositiveAssessment: boolean;
  message: string | null;
  nextAction: ScheduledAssessmentSetupNextAction;
  nextActionLabel: string | null;
  selectionRationale?: {
    summary: string;
    whyThisChallenge: string;
    whyNotAlternatives: string;
    residualRisk: string;
    nextAction: string;
  } | null;
  lastDeliveredUrl?: string | null;
  lastDeliveredUrlState?: 'active' | 'claimed' | 'stale' | null;
  lastDeliveredUrlMessage?: string | null;
}

interface ScheduledPendingMatchDiagnostic {
  matchRunId: string;
  status: string;
  selectedPacketId: string | null;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  assessmentQualityVerdict: string | null;
  assessmentQualityScore: string | null;
  contrastScore: number | null;
  contrastReason: string | null;
}

interface WorkspaceSessionProjection {
  status: string;
  errorMessage: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  repoGitUrl: string | null;
  baseCommitSha: string | null;
}

function buildWorkspaceSessionProjection(input: {
  workspace_status: string | null;
  workspace_error_message: string | null;
  workspace_expires_at: string | null;
  workspace_updated_at: string | null;
  workspace_repo_git_url: string | null;
  workspace_base_commit_sha: string | null;
}): WorkspaceSessionProjection | null {
  if (!input.workspace_status) return null;
  return {
    status: input.workspace_status,
    errorMessage: input.workspace_error_message,
    expiresAt: input.workspace_expires_at,
    updatedAt: input.workspace_updated_at,
    repoGitUrl: input.workspace_repo_git_url,
    baseCommitSha: input.workspace_base_commit_sha,
  };
}

function scheduledMatchDiagnosticForAssignment(input: {
  diagnostic: ScheduledPendingMatchDiagnostic | null | undefined;
  githubRepoUrl: string | null | undefined;
  githubPrNumber: number | null | undefined;
}): ScheduledPendingMatchDiagnostic | null {
  const diagnostic = input.diagnostic ?? null;
  if (!diagnostic) return null;
  if (input.githubPrNumber && diagnostic.githubPrNumber && diagnostic.githubPrNumber !== input.githubPrNumber) {
    return null;
  }
  const diagnosticRepoUrl = diagnostic.githubRepoUrl?.trim() || null;
  const assignmentRepoUrl = input.githubRepoUrl?.trim() || null;
  if (diagnosticRepoUrl && assignmentRepoUrl && diagnosticRepoUrl !== assignmentRepoUrl) {
    return null;
  }
  return diagnostic;
}

function scheduledMatchDiagnosticQualityLabel(
  diagnostic: ScheduledPendingMatchDiagnostic | null,
): string | null {
  if (!diagnostic?.assessmentQualityVerdict && !diagnostic?.assessmentQualityScore) return null;
  return [
    diagnostic.assessmentQualityVerdict,
    diagnostic.assessmentQualityScore,
  ].filter(Boolean).join(' ');
}

function scheduledMatchDiagnosticContrastLabel(
  diagnostic: ScheduledPendingMatchDiagnostic | null,
): string | null {
  if (!diagnostic) return null;
  return diagnostic.contrastReason
    ?? (diagnostic.contrastScore !== null
      ? `Contrast score ${diagnostic.contrastScore}.`
      : null);
}

function buildScheduledAssessmentSetup(input: {
  interviewType: string | null | undefined;
  candidateId: string | null | undefined;
  matchedRepoId: number | null | undefined;
  githubRepoUrl: string | null | undefined;
  githubPrNumber: number | null | undefined;
  matchedRepoSource?: Extract<ScheduledAssessmentSetupSource, 'matched_repo_id' | 'candidate_challenge_assignment'> | undefined;
  manualOpenSourceChallengePacket?: boolean | undefined;
  pendingMatchDiagnostic?: ScheduledPendingMatchDiagnostic | null | undefined;
  lastDeliveredUrl?: string | null | undefined;
  lastDeliveredUrlState?: 'active' | 'claimed' | 'stale' | null | undefined;
  lastDeliveredUrlMessage?: string | null | undefined;
}): ScheduledAssessmentSetupProjection {
  const lastDeliveredUrl = input.lastDeliveredUrl ?? null;
  const lastDeliveredUrlState = lastDeliveredUrl
    ? input.lastDeliveredUrlState ?? 'active'
    : null;
  const lastDeliveredUrlMessage = lastDeliveredUrl
    ? input.lastDeliveredUrlMessage ?? null
    : null;
  if (!isWorkspaceAssessmentInterviewType(input.interviewType)) {
    return {
      status: 'not_applicable',
      kind: 'not_applicable',
      source: 'not_workspace_assessment',
      blocksPositiveAssessment: false,
      message: null,
      nextAction: 'NONE',
      nextActionLabel: null,
      lastDeliveredUrl: null,
      lastDeliveredUrlState: null,
      lastDeliveredUrlMessage: null,
    };
  }

  if (input.githubRepoUrl && input.manualOpenSourceChallengePacket) {
    return {
      status: 'reviewable_task_assigned',
      kind: 'manual_open_source_task',
      source: 'recruiter_manual_override',
      blocksPositiveAssessment: false,
      message: 'A concrete open-source task packet was assigned by the recruiter. PIPE can launch that repo task from the exact base commit without inferring candidate-specific alignment.',
      nextAction: 'OPEN_ROOM_OR_WORKSPACE',
      nextActionLabel: 'Open the assessment room and launch the controlled workspace from the assigned base commit.',
      selectionRationale: {
        summary: 'Recruiter-assigned task packet',
        whyThisChallenge: 'The task is reviewable because the recruiter supplied a concrete repo URL, immutable base commit, task brief, success criteria, and expected evidence.',
        whyNotAlternatives: 'Automatic candidate-to-repo contrast ranking was not used on this path, so PIPE is not claiming this was the best candidate-specific match.',
        residualRisk: 'Use the completed commit, diff, tests, transcript, chat, and AI-use trail as assessment evidence; do not treat the manual assignment itself as fit proof.',
        nextAction: 'Open the controlled workspace and capture the candidate work against the assigned source-backed packet.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  if (input.matchedRepoId && input.githubRepoUrl && input.githubPrNumber) {
    const diagnostic = scheduledMatchDiagnosticForAssignment({
      diagnostic: input.pendingMatchDiagnostic,
      githubRepoUrl: input.githubRepoUrl,
      githubPrNumber: input.githubPrNumber,
    });
    const quality = scheduledMatchDiagnosticQualityLabel(diagnostic);
    const contrast = scheduledMatchDiagnosticContrastLabel(diagnostic);
    return {
      status: 'reviewable_task_assigned',
      kind: 'auto_match',
      source: input.matchedRepoSource ?? 'matched_repo_id',
      blocksPositiveAssessment: false,
      message: [
        MATCHED_ASSESSMENT_ASSIGNMENT_DETAIL,
        quality ? `Assessment quality: ${quality}.` : null,
        contrast,
      ].filter(Boolean).join(' '),
      nextAction: 'OPEN_ROOM_OR_WORKSPACE',
      nextActionLabel: 'Open the assessment room and capture the candidate work against the matched PR task.',
      selectionRationale: {
        summary: 'PIPE-selected repo task',
        whyThisChallenge: quality
          ? `PIPE selected this concrete GitHub PR from source-backed candidate evidence, role requirements when present, and repository demand; latest match proof reported ${quality} assessment quality.`
          : 'PIPE selected this concrete GitHub PR from source-backed candidate evidence, role requirements when present, and repository demand instead of handing the candidate a generic repo.',
        whyNotAlternatives: contrast
          ?? 'Lower-ranked or withheld challenges did not provide stronger source-backed alignment, reviewability, or contrast for automatic assignment.',
        residualRisk: 'The assignment proves challenge fit only; the hiring signal still depends on the captured branch commit, diff, tests or verification gap, transcript/chat, AI-use trail, evaluator report, and human review.',
        nextAction: 'Run the controlled workspace assessment and review the source-backed evidence before making a hiring decision.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  if (input.githubRepoUrl && input.githubPrNumber) {
    return {
      status: 'reviewable_task_assigned',
      kind: 'github_pr',
      source: 'recruiter_manual_override',
      blocksPositiveAssessment: false,
      message: 'A concrete GitHub PR was assigned by the recruiter. PIPE can launch that task, but candidate-specific alignment is not inferred from this manual override.',
      nextAction: 'OPEN_ROOM_OR_WORKSPACE',
      nextActionLabel: 'Open the assessment room and capture source-backed review or implementation evidence.',
      selectionRationale: {
        summary: 'Recruiter-selected PR',
        whyThisChallenge: 'The PR gives the candidate a concrete source-backed repo task that PIPE can launch and observe.',
        whyNotAlternatives: 'Automatic candidate-to-PR ranking was bypassed, so alternative challenge fit was not measured.',
        residualRisk: 'The PR assignment is not candidate-fit proof; rely on the candidate review or implementation evidence and human calibration.',
        nextAction: 'Capture the source-backed review or workspace evidence, then evaluate the submitted work.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  if (input.matchedRepoId) {
    return {
      status: 'missing_reviewable_task',
      kind: 'matched_repo_without_pr',
      source: input.matchedRepoSource ?? 'matched_repo_id',
      blocksPositiveAssessment: true,
      message: 'A matched repository exists, but no GitHub PR or task was assigned. Treat this as an assessment setup gap, not candidate evidence.',
      nextAction: 'ATTACH_CHALLENGE_PACKET',
      nextActionLabel: 'Attach a source-backed PR/task packet for the matched repo, or ingest more eligible repo challenges before inviting the candidate to work.',
      selectionRationale: {
        summary: 'Matched repo needs a task',
        whyThisChallenge: 'PIPE found a repository-level match, but there is no concrete PR, issue, base commit, task brief, success criteria, or expected evidence packet yet.',
        whyNotAlternatives: 'No eligible reviewable task has been approved for automatic delivery from this match.',
        residualRisk: 'Do not send this as a positive assessment until a concrete source-backed challenge packet exists.',
        nextAction: 'Attach a task packet for the matched repo or ingest more eligible repo challenges before launching the room.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  if (!input.candidateId) {
    return {
      status: 'waiting_for_candidate_evidence',
      kind: 'auto_match',
      source: 'contact_first_invite',
      blocksPositiveAssessment: true,
      message: 'This contact-first assessment invite has no candidate evidence yet. PIPE must ingest source-backed resume, transcript, chat, or interview evidence before selecting a PR task.',
      nextAction: 'COLLECT_CANDIDATE_EVIDENCE',
      nextActionLabel: 'Send the intake link or schedule a context call that captures source-backed examples of the candidate’s real engineering work.',
      selectionRationale: {
        summary: 'Needs candidate evidence',
        whyThisChallenge: 'No repo task should be selected until PIPE has source-backed evidence about the candidate.',
        whyNotAlternatives: 'Any automatic challenge assignment would be a guess because there is no candidate evidence to compare against repo demands.',
        residualRisk: 'Launching a coding assessment now would measure task survival, not candidate-role fit.',
        nextAction: 'Collect resume, profile, transcript, chat, or context-call evidence before matching a repo task.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  if (input.pendingMatchDiagnostic) {
    const diagnostic = input.pendingMatchDiagnostic;
    const candidate = [
      diagnostic.githubRepoUrl,
      diagnostic.githubPrNumber ? `#${diagnostic.githubPrNumber}` : null,
    ].filter(Boolean).join(' ');
    const quality = [
      diagnostic.assessmentQualityVerdict,
      diagnostic.assessmentQualityScore,
    ].filter(Boolean).join(' ');
    const contrast = diagnostic.contrastReason
      ?? (diagnostic.contrastScore !== null
        ? `Contrast score ${diagnostic.contrastScore}.`
        : null);
    return {
      status: 'waiting_for_source_backed_match',
      kind: 'auto_match',
      source: 'candidate_id',
      blocksPositiveAssessment: true,
      message: [
        candidate
          ? `PIPE found a source-backed candidate challenge (${candidate}) but held back automatic assignment because the match did not pass the auto-assignment quality gate.`
          : 'PIPE found a source-backed candidate challenge but held back automatic assignment because the match did not pass the auto-assignment quality gate.',
        quality ? `Assessment quality: ${quality}.` : null,
        contrast,
      ].filter(Boolean).join(' '),
      nextAction: 'RERUN_OR_ENRICH_MATCHING',
      nextActionLabel: 'Review the latest match run, add differentiating role or candidate evidence, or manually assign a source-backed PR once approved.',
      selectionRationale: {
        summary: 'Candidate challenge held back',
        whyThisChallenge: candidate
          ? `The strongest current candidate challenge is ${candidate}${quality ? ` with ${quality} assessment quality` : ''}.`
          : `The strongest current candidate challenge has ${quality || 'insufficient'} assessment quality.`,
        whyNotAlternatives: contrast ?? 'The matcher did not find enough contrast against alternatives for safe automatic assignment.',
        residualRisk: 'Sending this automatically would overstate match confidence; treat it as a review queue item, not candidate evidence.',
        nextAction: 'Add differentiating candidate or role evidence, approve the source-backed PR manually, or rerun matching after repo challenge ingestion improves.',
      },
      lastDeliveredUrl,
      lastDeliveredUrlState,
      lastDeliveredUrlMessage,
    };
  }

  return {
    status: 'waiting_for_source_backed_match',
    kind: 'auto_match',
    source: 'candidate_id',
    blocksPositiveAssessment: true,
    message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
    nextAction: 'RERUN_OR_ENRICH_MATCHING',
    nextActionLabel: 'Rerun repo matching after adding role requirements, candidate work evidence, or more eligible source-backed repo challenges.',
    selectionRationale: {
      summary: 'Needs source-backed match',
      whyThisChallenge: 'No concrete repo challenge is selected yet.',
      whyNotAlternatives: 'The current evidence did not produce an eligible automatic assignment.',
      residualRisk: 'Do not launch an assessment until PIPE can point to a source-backed task or a deliberate manual override.',
      nextAction: 'Ingest candidate evidence or repo challenge packets, then rerun matching.',
    },
    lastDeliveredUrl,
    lastDeliveredUrlState,
    lastDeliveredUrlMessage,
  };
}

const GIT_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function githubRepositoryPathFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, repoWithSuffix] = segments;
  const repo = repoWithSuffix?.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function isGitHubRepositoryUrl(value: string): boolean {
  return githubRepositoryPathFromUrl(value) !== null;
}

type GitHubCommitVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'unavailable'; status?: number };

const GITHUB_COMMIT_VERIFY_MAX_ATTEMPTS = 3;

async function verifyGitHubCommitPageReachable(input: {
  owner: string;
  repo: string;
  commitSha: string;
}): Promise<GitHubCommitVerificationResult> {
  const url = `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commit/${input.commitSha.toLowerCase()}`;
  const headers: Record<string, string> = {
    Accept: 'text/html',
    'User-Agent': 'PIPE-OS-assessment-validator',
  };

  try {
    const response = await fetch(url, { headers, method: 'HEAD' });
    if (response.ok) return { ok: true };
    if (response.status === 404) {
      return { ok: false, reason: 'not_found', status: response.status };
    }
    return { ok: false, reason: 'unavailable', status: response.status };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

async function verifyGitHubCommitReachable(input: {
  repositoryUrl: string;
  commitSha: string;
  githubToken?: string;
}): Promise<GitHubCommitVerificationResult> {
  const repoPath = githubRepositoryPathFromUrl(input.repositoryUrl);
  if (!repoPath) return { ok: false, reason: 'not_found' };

  const [owner, repo] = repoPath.split('/');
  if (!owner || !repo) return { ok: false, reason: 'not_found' };
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'PIPE-OS-assessment-validator',
  };
  if (input.githubToken) {
    headers.Authorization = `Bearer ${input.githubToken}`;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${input.commitSha.toLowerCase()}`;
  let lastUnavailableStatus: number | undefined;
  for (let attempt = 1; attempt <= GITHUB_COMMIT_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        url,
        { headers },
      );
    } catch {
      if (attempt === GITHUB_COMMIT_VERIFY_MAX_ATTEMPTS) {
        return { ok: false, reason: 'unavailable' };
      }
      continue;
    }

    if (response.ok) return { ok: true };
    if (response.status === 404 || response.status === 422) {
      return { ok: false, reason: 'not_found', status: response.status };
    }
    lastUnavailableStatus = response.status;
  }

  const pageVerification = await verifyGitHubCommitPageReachable({
    owner,
    repo,
    commitSha: input.commitSha,
  });
  if (pageVerification.ok || pageVerification.reason === 'not_found') {
    return pageVerification;
  }

  return { ok: false, reason: 'unavailable', status: pageVerification.status ?? lastUnavailableStatus };
}

const createInterviewSchema = z.object({
  candidateId: z.string().min(1).optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  recipientName: z.string().trim().min(1).max(200).optional(),
  recipientEmail: z.string().trim().email().optional(),
  meetingType: z.enum(['DIRECT_VIDEO_CALL', 'SCREENING_INTERVIEW']).optional(),
  interviewType: z.enum(INTERVIEW_TYPE_VALUES).optional(),
  scheduledAt: z.string().optional(),
  schedulingProvider: z.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).optional(),
  schedulingUrl: z.string().optional(),
  matchedRepoId: z.number().int().positive().nullable().optional(),
  githubRepoUrl: z.string().trim().url().nullable().optional(),
  githubPrNumber: z.number().int().positive().nullable().optional(),
  challengeBaseCommitSha: z.string().trim().regex(GIT_COMMIT_SHA_PATTERN, 'challengeBaseCommitSha must be a 40-character Git commit SHA.').optional(),
  challengeTitle: z.string().trim().min(1).max(240).optional(),
  challengeInstructions: z.string().trim().min(1).max(5000).optional(),
  challengeSuccessCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(12).optional(),
  challengeExpectedEvidence: z.array(z.string().trim().min(1).max(500)).min(1).max(12).optional(),
  challengeVerificationCommand: z.string().trim().min(1).max(1000).optional(),
  recruiterNotes: z.string().trim().max(5000).optional(),
}).superRefine((value, ctx) => {
  const hasCandidate = Boolean(value.candidateId);
  const hasRecipient = Boolean(value.recipientName && value.recipientEmail);
  if (!hasCandidate && !hasRecipient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'candidateId or recipientName plus recipientEmail is required.',
      path: ['recipientEmail'],
    });
  }
  if (!hasCandidate && (value.pipelineId || value.stageId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'pipelineId and stageId require candidateId.',
      path: ['candidateId'],
    });
  }
  // Workspace-backed assessments can attach a source-backed repo/PR task as a
  // manual override. When no repo is specified, matching selects a source-backed
  // challenge from candidate evidence at runtime.
  if (isWorkspaceAssessmentInterviewType(value.interviewType)) {
    const hasMatchedRepo = value.matchedRepoId != null && value.matchedRepoId > 0;
    const hasRepoUrl = Boolean(value.githubRepoUrl);
    const hasPrNumber = Boolean(value.githubPrNumber);
    const hasRepoUrlAndPr = hasRepoUrl && hasPrNumber;
    const challengeFields = [
      value.challengeBaseCommitSha,
      value.challengeTitle,
      value.challengeInstructions,
      value.challengeSuccessCriteria,
      value.challengeExpectedEvidence,
      value.challengeVerificationCommand,
    ];
    const hasAnyChallengePacketField = challengeFields.some((field) =>
      Array.isArray(field) ? field.length > 0 : Boolean(field));
    const hasCompleteChallengePacket = Boolean(
      value.challengeBaseCommitSha
      && value.challengeTitle
      && value.challengeInstructions
      && value.challengeSuccessCriteria?.length
      && value.challengeExpectedEvidence?.length,
    );
    const hasManualOpenSourceTaskPacket = value.interviewType === 'OPEN_SOURCE_BUG_FIX'
      && hasRepoUrl
      && hasCompleteChallengePacket;
    const hasPartialManual = hasRepoUrl !== hasPrNumber;
    if (hasPartialManual && !hasManualOpenSourceTaskPacket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Manual repo override requires both githubRepoUrl and githubPrNumber, or omit both for auto-match.',
        path: ['githubRepoUrl'],
      });
    }
    if (value.githubRepoUrl && !isGitHubRepositoryUrl(value.githubRepoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'githubRepoUrl must be a GitHub HTTPS repository URL.',
        path: ['githubRepoUrl'],
      });
    }
    if (hasMatchedRepo && (hasRepoUrlAndPr || hasManualOpenSourceTaskPacket)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide either matchedRepoId or a manual repo challenge, not both.',
        path: ['matchedRepoId'],
      });
    }
    if (hasAnyChallengePacketField && value.interviewType !== 'OPEN_SOURCE_BUG_FIX') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manual open-source challenge packets can only be attached to OPEN_SOURCE_BUG_FIX interviews.',
        path: ['interviewType'],
      });
    }
    if (hasAnyChallengePacketField && !hasCompleteChallengePacket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manual open-source challenge packets require challengeBaseCommitSha, challengeTitle, challengeInstructions, challengeSuccessCriteria, and challengeExpectedEvidence.',
        path: ['challengeBaseCommitSha'],
      });
    }
    if (hasAnyChallengePacketField && !hasRepoUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manual open-source challenge packets require githubRepoUrl.',
        path: ['githubRepoUrl'],
      });
    }
  } else if (
    value.challengeBaseCommitSha
    || value.challengeTitle
    || value.challengeInstructions
    || value.challengeSuccessCriteria?.length
    || value.challengeExpectedEvidence?.length
    || value.challengeVerificationCommand
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Challenge packet fields require OPEN_SOURCE_BUG_FIX.',
      path: ['interviewType'],
    });
  }
});

export const INTERVIEW_STATUS_VALUES = [
  'INVITED',
  'SCHEDULED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

const updateInterviewSchema = z.object({
  status: z.enum(INTERVIEW_STATUS_VALUES).optional(),
  scheduledAt: z.string().optional(),
  meetingUrl: z.string().optional(),
  recruiterNotes: z.string().optional(),
  matchedRepoId: z.number().int().positive().nullable().optional(),
  githubRepoUrl: z.string().trim().url().nullable().optional(),
  githubPrNumber: z.number().int().positive().nullable().optional(),
});

const humanAssessmentDecisionSchema = z.enum([
  'advance',
  'hold',
  'reject',
  'needs_more_evidence',
] satisfies [HumanAssessmentDecisionValue, ...HumanAssessmentDecisionValue[]]);

const recordHumanAssessmentDecisionSchema = z.object({
  decision: humanAssessmentDecisionSchema,
  summary: z.string().trim().min(1).max(2000),
  notes: z.string().trim().min(1).max(5000).nullable().optional(),
});

const inviteToCallSchema = z.object({
  email: z.string().email(),
  message: z.string().max(1000).optional(),
  sendEmail: z.boolean().optional(),
});

const SOURCE_BACKED_WORK_EVIDENCE_QUESTION =
  'Describe one real PR, bug, or code review you personally handled that best represents the work PIPE should assess. Include the codebase context, your role, trade-offs, verification/tests, and outcome.';
const SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP =
  'What did you inspect, which constraints mattered, and what source evidence would help PIPE map that work to a fair repo challenge?';
const CANDIDATE_ALIGNMENT_QUESTION =
  'Describe a project closest to this kind of repo challenge. Include the stack, behavior you owned, debugging or review actions, and why it would be a fair stretch.';
const ROLE_SAFE_CHALLENGE_QUESTION =
  'Name a real repo, PR, or codebase area that would fairly test you. What issue style, constraints, and scoring signals would be meaningful, and what would be misleading?';
const CONTEXT_CALL_QUESTIONS = [
  SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
  SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP,
  ROLE_SAFE_CHALLENGE_QUESTION,
] as const;

interface ScheduledCodeReviewEvidencePlanItem {
  id: string;
  missingSignal: string;
  whyItMatters: string;
  recommendedAssessment: 'recorded_evidence_question' | 'technical_pr_review' | 'manual_review_selection';
  expectedEvidence: string;
  question: string;
  source: {
    matchRunId: string | null;
    matchStatus: string;
    gap: string;
  };
}

// ─── Status transition validation ───────────────────────────────────────────

export const SCHEDULED_INTERVIEW_STATUS_TRANSITIONS: Record<string, string[]> = {
  INVITED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  ACTIVE: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: ['INVITED'],
  NO_SHOW: ['SCHEDULED', 'CANCELLED'],
};

export function canInterviewStatusTransition(from: string, to: string): boolean {
  return SCHEDULED_INTERVIEW_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

function buildInternalVideoUrl(_c: { env: Env }, interview: { id: string; stage_id: string | null; candidate_id: string | null; meeting_url: string | null }): string | null {
  if (interview.meeting_url) return interview.meeting_url;
  return null;
}

function emailLogoImgForRequest(c: { req: { url: string }; env: Env }): string {
  return buildPipeEmailLogoImg(
    resolvePipeEmailLogoUrl(c.req.url, c.env.PUBLIC_EMAIL_LOGO_URL),
  );
}

function sanitizeProviderSchedulingUrl(
  rawUrl: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  if (!rawUrl) return null;
  if (provider !== 'CALENDLY' && provider !== 'CAL_COM') return rawUrl;

  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function buildProviderSchedulingInviteUrl(input: {
  schedulingUrl: string;
  provider: string | null;
  env: Env;
  interviewId: string;
  recipientName: string | null;
  recipientEmail: string | null;
}): string {
  const authenticatedUrl = sanitizeProviderSchedulingUrl(
    withDevBasicAuth(input.schedulingUrl, input.env),
    input.provider,
  ) ?? input.schedulingUrl;
  if (input.provider !== 'CALENDLY' && input.provider !== 'CAL_COM') {
    return authenticatedUrl;
  }

  try {
    const url = new URL(authenticatedUrl);
    if (input.recipientName?.trim()) {
      url.searchParams.set('name', input.recipientName.trim());
    }
    if (input.recipientEmail?.trim()) {
      url.searchParams.set('email', input.recipientEmail.trim().toLowerCase());
    }
    url.searchParams.set('a1', input.interviewId);
    url.searchParams.set('utm_source', 'pipe');
    url.searchParams.set('utm_campaign', 'scheduled-interview');
    url.searchParams.set('utm_content', input.interviewId);
    return url.toString();
  } catch {
    return authenticatedUrl;
  }
}

type InterviewLivingContext = Awaited<ReturnType<typeof loadCandidateLivingContext>>;

function redactScheduledInterviewLivingContext(
  livingContext: InterviewLivingContext,
): InterviewLivingContext {
  if (!livingContext) return null;
  return {
    ...livingContext,
    interactions: [],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function assessmentTokenFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const assessIndex = parts.indexOf('assess');
    if (assessIndex < 0) return null;
    return parts[assessIndex + 1] ?? null;
  } catch {
    const match = value.match(/\/assess\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
}

async function optionalScheduledDetailProjection<T>(
  name: string,
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 4_000,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const guarded = promise.catch((error: unknown) => {
    console.error('[scheduling/detail] optional projection failed:', {
      projection: name,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  });
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.error('[scheduling/detail] optional projection timed out:', {
        projection: name,
        timeoutMs,
      });
      resolve(fallback);
    }, timeoutMs);
  });
  const value = await Promise.race([guarded, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  return value;
}

async function loadScheduledInterviewLivingContext(
  db: D1Database,
  ownerId: string,
  interview: {
    id: string;
    candidate_id: string | null;
    recipient_email: string | null;
  },
): Promise<InterviewLivingContext> {
  if (interview.candidate_id) {
    await ensureCandidateLivingContext(db, interview.candidate_id);
    return loadCandidateLivingContextSummary(db, interview.candidate_id);
  }

  const recipientEmail = interview.recipient_email?.trim().toLowerCase();
  const recipientContact = recipientEmail
    ? await db.prepare(
      `SELECT id
         FROM contacts
        WHERE owner_id = ?1
          AND lower(email) = ?2
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).bind(ownerId, recipientEmail).first<{ id: string }>()
    : null;
  const meetingContact = recipientContact
    ? null
    : await db.prepare(
      `SELECT c.id
         FROM meetings m
         JOIN meeting_participants mp ON mp.meeting_id = m.id
         JOIN contacts c ON c.id = mp.contact_id
        WHERE m.scheduled_interview_id = ?1
          AND m.owner_id = ?2
        ORDER BY mp.created_at DESC
        LIMIT 1`,
    ).bind(interview.id, ownerId).first<{ id: string }>();
  const contactId = recipientContact?.id ?? meetingContact?.id ?? null;
  if (!contactId) return null;

  await ensureContactLivingContext(db, contactId);
  return loadContactLivingContextSummary(db, contactId);
}

async function loadLatestDeliveredAssessmentUrl(
  db: D1Database,
  interviewId: string,
  candidateId: string | null | undefined,
): Promise<{
  url: string;
  state: 'active' | 'claimed' | 'stale';
  message: string | null;
} | null> {
  try {
    if (!await tableExists(db, 'interactions')) return null;
    const row = await db.prepare(
      `SELECT metadata_json
         FROM interactions
        WHERE interaction_type = 'scheduled_interview_invite_delivery'
          AND external_reference = ?1
        ORDER BY started_at DESC, created_at DESC
        LIMIT 1`,
    ).bind(interviewId).first<{ metadata_json: string | null }>();
    const metadata = parseJsonObject(row?.metadata_json ?? null);
    const deliveredUrl = metadata.deliveredUrl;
    if (typeof deliveredUrl !== 'string') return null;
    const trimmed = deliveredUrl.trim();
    if (!trimmed.includes('/assess/') && !trimmed.includes('/room/')) return null;
    if (!trimmed.includes('/assess/')) {
      return { url: trimmed, state: 'active', message: null };
    }

    const deliveredToken = assessmentTokenFromUrl(trimmed);
    if (!candidateId || !deliveredToken) {
      return { url: trimmed, state: 'active', message: null };
    }

    const candidate = await db
      .prepare('SELECT invite_token, status FROM candidates WHERE id = ?1')
      .bind(candidateId)
      .first<{ invite_token: string | null; status: string | null }>();
    const currentToken = candidate?.invite_token?.trim() ?? '';
    if (currentToken === `CLAIMED::${deliveredToken}`) {
      if (candidate?.status === 'INVITED') {
        return { url: trimmed, state: 'active', message: null };
      }

      return {
        url: trimmed,
        state: 'claimed',
        message: 'The candidate has already started this one-use assessment link. Resend the invite if they need a fresh link.',
      };
    }
    if (currentToken && currentToken !== deliveredToken) {
      return {
        url: trimmed,
        state: 'stale',
        message: 'This is an older delivered assessment link. Resend the invite to deliver the current candidate token.',
      };
    }
    return { url: trimmed, state: 'active', message: null };
  } catch (err) {
    console.error('[scheduling/detail] failed to load delivered assessment url:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function loadCandidateAssessmentInviteLinkFromToken(
  db: D1Database,
  env: Env,
  input: {
    interviewType: string | null | undefined;
    candidateId: string | null | undefined;
  },
): Promise<{
  url: string;
  state: 'active';
  message: string | null;
} | null> {
  if (!isAssessmentOnlyInviteInterviewType(input.interviewType) || !input.candidateId) return null;
  const candidate = await db
    .prepare('SELECT invite_token FROM candidates WHERE id = ?1')
    .bind(input.candidateId)
    .first<{ invite_token: string | null }>();
  const inviteToken = candidate?.invite_token?.trim() ?? '';
  if (!inviteToken || isClaimedInviteToken(inviteToken)) return null;
  const baseUrl = env.APP_BASE_URL ?? 'https://pipe.build';
  return {
    url: withDevBasicAuth(`${baseUrl}/assess/${inviteToken}`, env),
    state: 'active',
    message: null,
  };
}

interface ScheduledRelatedEvidenceInterview {
  id: string;
  relationship: 'code_review_evidence_follow_up' | 'originating_code_review' | 'same_person_assessment';
  interviewType: string | null;
  meetingType: string | null;
  status: string;
  scheduledAt: string | null;
  candidateId: string | null;
  contactId: string | null;
  displayName: string | null;
  primaryEmail: string | null;
  linkedMeetingId: string | null;
  transcriptStatus: string | null;
  assessmentSessionId: string | null;
  assessmentSessionState: string | null;
  createdAt: string;
  updatedAt: string;
}

async function loadRelatedEvidenceInterviews(
  db: D1Database,
  ownerId: string,
  currentInterviewId: string,
  livingContext: InterviewLivingContext,
): Promise<ScheduledRelatedEvidenceInterview[]> {
  const workspacePersonId = livingContext?.person.workspacePersonId ?? null;
  if (!workspacePersonId) return [];

  const hasAssessmentSessions = await tableExists(db, 'assessment_sessions');
  const assessmentSessionSelect = hasAssessmentSessions
    ? `s.id AS assessment_session_id,
            s.state AS assessment_session_state,
            s.metadata_json AS assessment_metadata_json`
    : `NULL AS assessment_session_id,
            NULL AS assessment_session_state,
            NULL AS assessment_metadata_json`;
  const assessmentSessionJoin = hasAssessmentSessions
    ? `LEFT JOIN assessment_sessions s ON s.id = (
         SELECT latest_s.id
           FROM assessment_sessions latest_s
          WHERE latest_s.interview_id = si.id
          ORDER BY latest_s.updated_at DESC, latest_s.id DESC
          LIMIT 1
       )`
    : '';
  const assessmentSessionOrder = hasAssessmentSessions
    ? `CASE
          WHEN s.created_by = 'code-review-evidence-plan'
           AND json_extract(s.metadata_json, '$.originalInterviewId') = ?2
          THEN 0
          WHEN s.created_by = 'code-review-evidence-plan'
           AND json_extract(s.metadata_json, '$.contextCallInterviewId') = ?2
          THEN 1
          ELSE 2
        END,`
    : '';

  const rows = await db.prepare(
    `SELECT si.id,
            si.interview_type,
            si.meeting_type,
            si.status,
            si.scheduled_at,
            si.candidate_id,
            rc.id AS contact_id,
            COALESCE(c.name, si.recipient_name, rc.name) AS display_name,
            lower(COALESCE(c.email, si.recipient_email, rc.email)) AS primary_email,
            si.created_at,
            si.updated_at,
            m.id AS linked_meeting_id,
            m.transcript_status,
            ${assessmentSessionSelect}
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN applications app ON app.legacy_candidate_id = si.candidate_id
       LEFT JOIN contacts rc ON rc.id = (
         SELECT contact.id
           FROM contacts contact
          WHERE contact.owner_id = si.owner_id
            AND si.recipient_email IS NOT NULL
            AND lower(contact.email) = lower(si.recipient_email)
          ORDER BY contact.updated_at DESC
          LIMIT 1
       )
       LEFT JOIN workspace_people contact_wp ON contact_wp.workspace_id = si.owner_id
        AND rc.id IS NOT NULL
        AND json_extract(contact_wp.context_json, '$.contactId') = rc.id
       LEFT JOIN meetings m ON m.id = (
         SELECT lm.id
           FROM meetings lm
          WHERE lm.scheduled_interview_id = si.id
            AND lm.owner_id = si.owner_id
          ORDER BY lm.created_at DESC
          LIMIT 1
       )
       ${assessmentSessionJoin}
      WHERE si.owner_id = ?1
        AND si.id <> ?2
        AND (
          app.workspace_person_id = ?3
          OR contact_wp.id = ?3
        )
      ORDER BY
        ${assessmentSessionOrder}
        si.created_at DESC,
        si.id DESC
      LIMIT 8`,
  ).bind(ownerId, currentInterviewId, workspacePersonId).all<{
    id: string;
    interview_type: string | null;
    meeting_type: string | null;
    status: string;
    scheduled_at: string | null;
    candidate_id: string | null;
    contact_id: string | null;
    display_name: string | null;
    primary_email: string | null;
    created_at: string;
    updated_at: string;
    linked_meeting_id: string | null;
    transcript_status: string | null;
    assessment_session_id: string | null;
    assessment_session_state: string | null;
    assessment_metadata_json: string | null;
  }>();

  return (rows.results ?? []).map((row) => {
    const metadata = parseJsonObject(row.assessment_metadata_json);
    const originalInterviewId = optionalString(metadata.originalInterviewId);
    const contextCallInterviewId = optionalString(metadata.contextCallInterviewId);
    const relationship: ScheduledRelatedEvidenceInterview['relationship'] =
      originalInterviewId === currentInterviewId
        ? 'code_review_evidence_follow_up'
        : contextCallInterviewId === currentInterviewId
          ? 'originating_code_review'
          : 'same_person_assessment';

    return {
      id: row.id,
      relationship,
      interviewType: row.interview_type,
      meetingType: row.meeting_type,
      status: row.status,
      scheduledAt: row.scheduled_at,
      candidateId: row.candidate_id,
      contactId: row.contact_id,
      displayName: row.display_name,
      primaryEmail: row.primary_email,
      linkedMeetingId: row.linked_meeting_id,
      transcriptStatus: row.transcript_status,
      assessmentSessionId: row.assessment_session_id,
      assessmentSessionState: row.assessment_session_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

interface ScheduledCodeReviewSourceRef {
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
  contentHash?: string;
}

interface ScheduledCodeReviewRoleSource extends ScheduledCodeReviewSourceRef {
  entityId: string;
  conceptKeys: string[];
}

interface ScheduledCodeReviewQualityMetric {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  reason: string;
}

interface ScheduledCodeReviewAssessmentQuality {
  verdict: string;
  score: number;
  maxScore: number;
  metrics: ScheduledCodeReviewQualityMetric[];
}

interface ScheduledCodeReviewQualityGate {
  verdict: CandidateSafeQualityGateVerdict;
  checks: string[];
  diagnostics: CandidateSafeQualityGateDiagnostic[];
}

type ScheduledCodeReviewDifficultyBand = 'introductory' | 'focused' | 'advanced' | 'oversized';
type ScheduledCodeReviewExpectedSeniority = 'mid' | 'senior' | 'staff';

interface ScheduledCodeReviewReviewProfileBasis {
  changedFileCount: number;
  changedLineCount: number;
  sourceHunkCount: number;
  testChangeCount: number;
  demandFamilyCount: number;
  hasIssueContext: boolean;
}

interface ScheduledCodeReviewReviewProfile {
  source: 'deterministic_engineering_prior';
  difficultyBand: ScheduledCodeReviewDifficultyBand;
  expectedSeniority: ScheduledCodeReviewExpectedSeniority;
  expectedTimeMinutes: number;
  basis: ScheduledCodeReviewReviewProfileBasis;
  rationale: string;
}

interface ScheduledCodeReviewValidatorCheck {
  id: string;
  passed: boolean;
  reason: string;
}

interface ScheduledCodeReviewValidatorSourceBridge {
  prNumber: number | null;
  candidateSourceCount: number;
  repoSourceCount: number;
  roleSourceCount: number;
  alignedDemandCount: number;
  stretchCount: number;
  provenanceComplete: boolean;
}

interface ScheduledCodeReviewValidatorAgent {
  agentName: string;
  agentVersion: string;
  mode: string;
  verdict: string;
  rationale: string;
  checks: ScheduledCodeReviewValidatorCheck[];
  sourceBridge: ScheduledCodeReviewValidatorSourceBridge | null;
}

interface ScheduledCodeReviewAlignment {
  atomId: string;
  demandId: string;
  sharedConcepts: string[];
  pairScore: number | null;
  roleSourceRefs: ScheduledCodeReviewRoleSource[];
  candidateSourceRefs: ScheduledCodeReviewSourceRef[];
  challengeSourceRefs: ScheduledCodeReviewSourceRef[];
}

interface ScheduledCodeReviewHyperedgeNode {
  kind: 'person_evidence' | 'role_source' | 'repo_challenge';
  label: string;
  sourceRef: ScheduledCodeReviewSourceRef & { conceptKeys?: string[] };
}

interface ScheduledCodeReviewHyperedge {
  relation: 'candidate_role_repo_alignment' | 'candidate_repo_evidence_alignment';
  label: string;
  pairScore: number | null;
  nodes: ScheduledCodeReviewHyperedgeNode[];
}

interface ScheduledCodeReviewRankedResult {
  rank: number | null;
  challengeId: string;
  repoId: string;
  prNumber: number;
  score: number | null;
  alignedDemandCount: number;
  stretchCount: number;
  provenanceComplete: boolean;
  eligible: boolean;
  assessmentQuality: ScheduledCodeReviewAssessmentQuality | null;
  reviewProfile: ScheduledCodeReviewReviewProfile | null;
  validatorAgent: ScheduledCodeReviewValidatorAgent | null;
  alignments: ScheduledCodeReviewAlignment[];
  rejectionReasons: string[];
}

interface ScheduledCodeReviewMatchDetail {
  status: string;
  matchRunId: string | null;
  packetId: string | null;
  summary: string;
  score: number | null;
  assessmentQuality: ScheduledCodeReviewAssessmentQuality | null;
  qualityGate: ScheduledCodeReviewQualityGate | null;
  reviewProfile: ScheduledCodeReviewReviewProfile | null;
  validatorAgent: ScheduledCodeReviewValidatorAgent | null;
  roleSources: ScheduledCodeReviewRoleSource[];
  evidence: ScheduledCodeReviewAlignment[];
  evidenceHyperedges: ScheduledCodeReviewHyperedge[];
  gaps: string[];
  evidencePlan: ScheduledCodeReviewEvidencePlanItem[];
  evidenceFollowUp: ScheduledCodeReviewEvidenceFollowUp | null;
  evidenceRefresh: ScheduledCodeReviewEvidenceRefresh | null;
}

interface ScheduledCodeReviewEvidenceFollowUp {
  assessmentSessionId: string;
  contextCallInterviewId: string | null;
  state: string;
  blockedReason: string | null;
  matchRunId: string | null;
  matchStatus: string | null;
  gaps: string[];
  questions: string[];
  createdAt: string;
  updatedAt: string;
}

interface ScheduledCodeReviewEvidenceRefresh {
  status: string;
  assessmentSessionId: string;
  contextCallInterviewId: string | null;
  reportId: string;
  summary: string;
  sourceSpanCount: number | null;
  matcherContextCount: number;
  evidenceSnippets: ScheduledCodeReviewEvidenceSnippet[];
  matchRunId: string | null;
  matchStatus: string | null;
  consumptionReportId: string | null;
  consumedByMatchRunId: string | null;
  consumedByMatchStatus: string | null;
  consumedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

interface ScheduledCodeReviewEvidenceSnippet {
  eventId: string;
  sourceRefId: string;
  sourceSpanId: string | null;
  evidenceRole: string;
  exactText: string;
  occurredAt: string | null;
  locator: Record<string, unknown>;
}

interface ScheduledCodeReviewScoreSummary {
  reviewSessionId: string;
  status: string;
  score: number | null;
  band: string | null;
  narrative: string | null;
  strengths: string[];
  growthAreas: string[];
  provenance: {
    rubricDimensionCount: number;
    evidenceItemCount: number;
    metricCount: number;
  };
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const SCHEDULED_CODE_REVIEW_SOURCE_TEXT_MAX_LENGTH = 240;

function compactScheduledCodeReviewSourceText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  if (compacted.length <= SCHEDULED_CODE_REVIEW_SOURCE_TEXT_MAX_LENGTH) return compacted;
  return `${compacted.slice(0, SCHEDULED_CODE_REVIEW_SOURCE_TEXT_MAX_LENGTH - 1).trimEnd()}...`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function objectEntryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return 0;
}

function evidenceItemCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + evidenceItemCount(item), 0);
  }
  if (isRecord(value)) {
    const values = Object.values(value);
    if (values.length === 0) return 0;
    return values.reduce<number>((sum, item) => sum + evidenceItemCount(item), 0);
  }
  return 1;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const CODE_REVIEW_EVIDENCE_REPAIR_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'ask',
  'asked',
  'before',
  'for',
  'from',
  'had',
  'have',
  'i',
  'in',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'the',
  'this',
  'to',
  'we',
  'with',
]);

const CODE_REVIEW_EVIDENCE_REPAIR_SIGNAL_PATTERNS = [
  /\bpr\b/i,
  /\bpull request\b/i,
  /\bbug\b/i,
  /\bcode review\b/i,
  /\breview(?:ed|ing)?\b/i,
  /\bdiff\b/i,
  /\btest(?:ed|s|ing)?\b/i,
  /\bregression\b/i,
  /\bdebug(?:ged|ging)?\b/i,
  /\bfix(?:ed|ing)?\b/i,
  /\bimplement(?:ed|ing)?\b/i,
  /\bship(?:ped|ping)?\b/i,
  /\bdeploy(?:ed|ing)?\b/i,
  /\bverif(?:y|ied|ication)\b/i,
  /\btrade-?off\b/i,
  /\bconstraint\b/i,
  /\bincident\b/i,
  /\bproduction\b/i,
  /\brace condition\b/i,
  /\bidempotenc(?:y|e)\b/i,
  /\bmigration\b/i,
];

function codeReviewEvidenceRepairOpenTerms(
  text: string,
  limit = 24,
): Array<{ surface: string; canonicalKey: string }> {
  const terms = new Map<string, { surface: string; canonicalKey: string }>();
  for (const token of text.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? []) {
    const normalized = token.trim().toLowerCase();
    if (
      normalized.length < 3
      || CODE_REVIEW_EVIDENCE_REPAIR_STOPWORDS.has(normalized)
      || /^\d+$/.test(normalized)
    ) {
      continue;
    }
    const term = openSemanticTerm(token);
    if (!term || terms.has(term.canonicalKey)) continue;
    terms.set(term.canonicalKey, {
      surface: term.surface,
      canonicalKey: term.canonicalKey,
    });
    if (terms.size >= limit) break;
  }
  return [...terms.values()];
}

function countCodeReviewEvidenceRepairSignals(text: string): number {
  return CODE_REVIEW_EVIDENCE_REPAIR_SIGNAL_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function parseScheduledCodeReviewSourceRefs(value: unknown): ScheduledCodeReviewSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScheduledCodeReviewSourceRef[] => {
    if (!isRecord(item)) return [];
    const sourceRef: ScheduledCodeReviewSourceRef = {};
    const sourceRefType = optionalString(item.sourceRefType);
    const sourceRefId = optionalString(item.sourceRefId);
    const sourceSpanId = optionalString(item.sourceSpanId);
    const locator = compactScheduledCodeReviewSourceText(optionalString(item.locator));
    const exactText = compactScheduledCodeReviewSourceText(optionalString(item.exactText));
    const contentHash = optionalString(item.contentHash);
    if (sourceRefType) sourceRef.sourceRefType = sourceRefType;
    if (sourceRefId) sourceRef.sourceRefId = sourceRefId;
    if (sourceSpanId) sourceRef.sourceSpanId = sourceSpanId;
    if (locator) sourceRef.locator = locator;
    if (exactText) sourceRef.exactText = exactText;
    if (contentHash) sourceRef.contentHash = contentHash;
    return Object.keys(sourceRef).length > 0 ? [sourceRef] : [];
  });
}

function parseScheduledCodeReviewRoleSources(value: unknown): ScheduledCodeReviewRoleSource[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, ScheduledCodeReviewRoleSource>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const entityId = optionalString(item.entityId);
    if (!entityId) continue;
    const roleSource: ScheduledCodeReviewRoleSource = {
      entityId,
      conceptKeys: [...new Set(stringArray(item.conceptKeys))].sort(),
    };
    const sourceRefType = optionalString(item.sourceRefType);
    const sourceRefId = optionalString(item.sourceRefId);
    const sourceSpanId = optionalString(item.sourceSpanId);
    const locator = compactScheduledCodeReviewSourceText(optionalString(item.locator));
    const exactText = compactScheduledCodeReviewSourceText(optionalString(item.exactText));
    const contentHash = optionalString(item.contentHash);
    if (sourceRefType) roleSource.sourceRefType = sourceRefType;
    if (sourceRefId) roleSource.sourceRefId = sourceRefId;
    if (sourceSpanId) roleSource.sourceSpanId = sourceSpanId;
    if (locator) roleSource.locator = locator;
    if (exactText) roleSource.exactText = exactText;
    if (contentHash) roleSource.contentHash = contentHash;
    deduped.set(JSON.stringify(roleSource), roleSource);
  }
  return [...deduped.values()];
}

function parseScheduledCodeReviewRoleSourcesFromQuery(value: string | null): ScheduledCodeReviewRoleSource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.roleGuardrails)) return [];
    return parseScheduledCodeReviewRoleSources(parsed.roleGuardrails.sourceReferences);
  } catch {
    return [];
  }
}

function parseScheduledCodeReviewAssessmentQuality(value: unknown): ScheduledCodeReviewAssessmentQuality | null {
  if (!isRecord(value)) return null;
  const verdict = optionalString(value.verdict);
  const score = numberOrNull(value.score);
  const maxScore = numberOrNull(value.maxScore);
  const metrics = Array.isArray(value.metrics)
    ? value.metrics.flatMap((item): ScheduledCodeReviewQualityMetric[] => {
        if (!isRecord(item)) return [];
        const id = optionalString(item.id);
        const label = optionalString(item.label);
        const metricScore = numberOrNull(item.score);
        const metricMax = numberOrNull(item.maxScore);
        const reason = optionalString(item.reason);
        if (!id || !label || metricScore === null || metricMax === null || !reason) return [];
        return [{ id, label, score: metricScore, maxScore: metricMax, reason }];
      })
    : [];
  if (!verdict || score === null || maxScore === null) return null;
  return { verdict, score, maxScore, metrics };
}

const SCHEDULED_CODE_REVIEW_DIFFICULTY_BANDS: readonly ScheduledCodeReviewDifficultyBand[] = [
  'introductory',
  'focused',
  'advanced',
  'oversized',
];

const SCHEDULED_CODE_REVIEW_EXPECTED_SENIORITIES: readonly ScheduledCodeReviewExpectedSeniority[] = [
  'mid',
  'senior',
  'staff',
];

function isScheduledCodeReviewDifficultyBand(value: unknown): value is ScheduledCodeReviewDifficultyBand {
  return typeof value === 'string'
    && (SCHEDULED_CODE_REVIEW_DIFFICULTY_BANDS as readonly string[]).includes(value);
}

function isScheduledCodeReviewExpectedSeniority(value: unknown): value is ScheduledCodeReviewExpectedSeniority {
  return typeof value === 'string'
    && (SCHEDULED_CODE_REVIEW_EXPECTED_SENIORITIES as readonly string[]).includes(value);
}

function parseScheduledCodeReviewReviewProfile(value: unknown): ScheduledCodeReviewReviewProfile | null {
  if (!isRecord(value)) return null;
  if (value.source !== 'deterministic_engineering_prior') return null;
  if (!isScheduledCodeReviewDifficultyBand(value.difficultyBand)) return null;
  if (!isScheduledCodeReviewExpectedSeniority(value.expectedSeniority)) return null;
  const expectedTimeMinutes = numberOrNull(value.expectedTimeMinutes);
  const rationale = optionalString(value.rationale);
  if (expectedTimeMinutes === null || !rationale) return null;

  if (!isRecord(value.basis)) return null;
  const changedFileCount = numberOrNull(value.basis.changedFileCount);
  const changedLineCount = numberOrNull(value.basis.changedLineCount);
  const sourceHunkCount = numberOrNull(value.basis.sourceHunkCount);
  const testChangeCount = numberOrNull(value.basis.testChangeCount);
  const demandFamilyCount = numberOrNull(value.basis.demandFamilyCount);
  if (
    changedFileCount === null
    || changedLineCount === null
    || sourceHunkCount === null
    || testChangeCount === null
    || demandFamilyCount === null
    || typeof value.basis.hasIssueContext !== 'boolean'
  ) {
    return null;
  }

  return {
    source: 'deterministic_engineering_prior',
    difficultyBand: value.difficultyBand,
    expectedSeniority: value.expectedSeniority,
    expectedTimeMinutes,
    basis: {
      changedFileCount,
      changedLineCount,
      sourceHunkCount,
      testChangeCount,
      demandFamilyCount,
      hasIssueContext: value.basis.hasIssueContext,
    },
    rationale,
  };
}

function parseScheduledCodeReviewPacketReviewProfile(packetJson: string | null): ScheduledCodeReviewReviewProfile | null {
  if (!packetJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(packetJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return parseScheduledCodeReviewReviewProfile(parsed.reviewProfile);
}

async function loadScheduledCodeReviewPacketReviewProfile(
  db: D1Database,
  packetId: string | null | undefined,
): Promise<ScheduledCodeReviewReviewProfile | null> {
  if (!packetId) return null;
  const packet = await db.prepare(
    `SELECT packet_json
       FROM review_challenge_packets
      WHERE id = ?1
      LIMIT 1`,
  ).bind(packetId).first<{ packet_json: string | null }>();
  return parseScheduledCodeReviewPacketReviewProfile(packet?.packet_json ?? null);
}

function parseScheduledCodeReviewValidatorAgent(value: unknown): ScheduledCodeReviewValidatorAgent | null {
  if (!isRecord(value)) return null;
  const agentName = optionalString(value.agentName);
  const agentVersion = optionalString(value.agentVersion);
  const mode = optionalString(value.mode);
  const verdict = optionalString(value.verdict);
  const rationale = optionalString(value.rationale);
  if (!agentName || !agentVersion || !mode || !verdict || !rationale) return null;

  const checks = Array.isArray(value.checks)
    ? value.checks.flatMap((item): ScheduledCodeReviewValidatorCheck[] => {
        if (!isRecord(item)) return [];
        const id = optionalString(item.id);
        const reason = optionalString(item.reason);
        if (!id || !reason) return [];
        return [{ id, passed: item.passed === true, reason }];
      })
    : [];

  let sourceBridge: ScheduledCodeReviewValidatorSourceBridge | null = null;
  if (isRecord(value.sourceBridge)) {
    const candidateSourceCount = numberOrNull(value.sourceBridge.candidateSourceCount);
    const repoSourceCount = numberOrNull(value.sourceBridge.repoSourceCount);
    const roleSourceCount = numberOrNull(value.sourceBridge.roleSourceCount);
    const alignedDemandCount = numberOrNull(value.sourceBridge.alignedDemandCount);
    const stretchCount = numberOrNull(value.sourceBridge.stretchCount);
    if (
      candidateSourceCount !== null
      && repoSourceCount !== null
      && roleSourceCount !== null
      && alignedDemandCount !== null
      && stretchCount !== null
    ) {
      sourceBridge = {
        prNumber: numberOrNull(value.sourceBridge.prNumber),
        candidateSourceCount,
        repoSourceCount,
        roleSourceCount,
        alignedDemandCount,
        stretchCount,
        provenanceComplete: value.sourceBridge.provenanceComplete === true,
      };
    }
  }

  return {
    agentName,
    agentVersion,
    mode,
    verdict,
    rationale,
    checks,
    sourceBridge,
  };
}

function parseScheduledCodeReviewRankedResults(
  value: string | null,
): ScheduledCodeReviewRankedResult[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): ScheduledCodeReviewRankedResult[] => {
    if (!isRecord(item)) return [];
    const challengeId = optionalString(item.challengeId);
    const repoId = optionalString(item.repoId);
    const prNumber = numberOrNull(item.prNumber);
    const alignedDemandCount = numberOrNull(item.alignedDemandCount);
    const stretchCount = numberOrNull(item.stretchCount);
    if (!challengeId || !repoId || prNumber === null || alignedDemandCount === null || stretchCount === null) {
      return [];
    }
    const alignments = Array.isArray(item.alignments)
      ? item.alignments.flatMap((alignment): ScheduledCodeReviewAlignment[] => {
          if (!isRecord(alignment)) return [];
          const atomId = optionalString(alignment.atomId);
          const demandId = optionalString(alignment.demandId);
          if (!atomId || !demandId) return [];
          return [{
            atomId,
            demandId,
            sharedConcepts: stringArray(alignment.sharedConcepts),
            pairScore: numberOrNull(alignment.pairScore),
            roleSourceRefs: parseScheduledCodeReviewRoleSources(alignment.roleSourceRefs),
            candidateSourceRefs: parseScheduledCodeReviewSourceRefs(alignment.candidateSourceRefs),
            challengeSourceRefs: parseScheduledCodeReviewSourceRefs(alignment.challengeSourceRefs),
          }];
        })
      : [];
    return [{
      rank: numberOrNull(item.rank),
      challengeId,
      repoId,
      prNumber,
      score: numberOrNull(item.score),
      alignedDemandCount,
      stretchCount,
      provenanceComplete: item.provenanceComplete === true,
      eligible: item.eligible === true,
      assessmentQuality: parseScheduledCodeReviewAssessmentQuality(item.assessmentQuality),
      reviewProfile: parseScheduledCodeReviewReviewProfile(item.reviewProfile),
      validatorAgent: parseScheduledCodeReviewValidatorAgent(item.validatorAgent),
      alignments,
      rejectionReasons: stringArray(item.rejectionReasons),
    }];
  });
}

function scheduledCodeReviewMatchSummary(
  status: string,
  selected: ScheduledCodeReviewRankedResult | null,
): { summary: string; gaps: string[] } {
  if (!selected) {
    if (status === 'PENDING_INTAKE') {
      return {
        summary: 'Waiting for candidate resume/profile evidence before matching to a PR.',
        gaps: ['Candidate has not submitted source evidence yet.'],
      };
    }
    if (status === 'NEEDS_MORE_EVIDENCE') {
      return {
        summary: 'PIPE needs more source-backed candidate evidence before assigning a fair code-review challenge.',
        gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
      };
    }
    return {
      summary: 'No source-backed code review match is available for this interview yet.',
      gaps: ['NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE'],
    };
  }
  if (status === 'NO_ROLE_SAFE_CHALLENGE') {
    return {
      summary: 'Matcher found candidate evidence, but no reviewable PR passed guardrails.',
      gaps: selected.rejectionReasons.length
        ? selected.rejectionReasons
        : ['No eligible challenge had complete provenance and non-generic alignment.'],
    };
  }
  return {
    summary: `Matched ${selected.alignedDemandCount} source-backed demand${selected.alignedDemandCount === 1 ? '' : 's'} (${selected.stretchCount} stretch).`,
    gaps: selected.rejectionReasons,
  };
}

function codeReviewEvidencePlanForGap(input: {
  gap: string;
  matchStatus: string;
  matchRunId: string | null;
}): ScheduledCodeReviewEvidencePlanItem {
  const normalized = input.gap.trim() || 'NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE';
  const source = {
    matchRunId: input.matchRunId,
    matchStatus: input.matchStatus,
    gap: normalized,
  };

  if (
    normalized === 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'
    || normalized === 'CANDIDATE_SIGNALS_EXCLUDED_FOR_MISSING_OR_NULL_EVIDENCE'
    || normalized === 'NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE'
  ) {
    return {
      id: `candidate-source-evidence:${normalized}`,
      missingSignal: 'Source-backed candidate work evidence',
      whyItMatters: 'PIPE cannot fairly select a real PR challenge until it has evidence of what kinds of engineering work this person has actually done.',
      recommendedAssessment: 'recorded_evidence_question',
      expectedEvidence: 'A short recorded or written answer with a concrete project, personal actions, technical constraints, and verification details.',
      question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
      source,
    };
  }

  if (normalized === 'NO_SOURCE_BACKED_ROLE_SAFE_CHALLENGE_RECALLED') {
    return {
      id: `role-safe-challenge:${normalized}`,
      missingSignal: 'Role-safe reviewable PR challenge',
      whyItMatters: 'The candidate may have usable evidence, but PIPE does not have a source-backed PR that safely tests it yet.',
      recommendedAssessment: 'manual_review_selection',
      expectedEvidence: 'A recruiter-selected or generated PR packet with source spans, expected review demands, planted issues, and scoring criteria.',
      question: ROLE_SAFE_CHALLENGE_QUESTION,
      source,
    };
  }

  if (normalized === 'NO_SOURCE_BACKED_CANDIDATE_ALIGNMENT') {
    return {
      id: `candidate-alignment:${normalized}`,
      missingSignal: 'Candidate evidence aligned to the PR demands',
      whyItMatters: 'A challenge should test a real stretch from the person graph, not a generic repo that merely looks plausible.',
      recommendedAssessment: 'recorded_evidence_question',
      expectedEvidence: 'A specific example that can be mapped to the repo demand: stack, behavior, debugging/review action, and outcome.',
      question: CANDIDATE_ALIGNMENT_QUESTION,
      source,
    };
  }

  return {
    id: `match-gap:${normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'}`,
    missingSignal: normalized.replace(/_/g, ' ').toLowerCase(),
    whyItMatters: 'This gap prevented PIPE from confidently assigning or validating the code-review assessment.',
    recommendedAssessment: input.matchStatus === 'NO_ROLE_SAFE_CHALLENGE'
      ? 'manual_review_selection'
      : 'recorded_evidence_question',
    expectedEvidence: 'Source-backed context that explains the relevant project history, technical constraints, and assessment fit.',
    question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
    source,
  };
}

function buildCodeReviewEvidencePlan(input: {
  matchStatus: string;
  matchRunId: string | null;
  gaps: string[];
}): ScheduledCodeReviewEvidencePlanItem[] {
  if (input.matchStatus === 'MATCHED') return [];
  const gaps = input.gaps.length > 0
    ? input.gaps
    : input.matchStatus === 'NEEDS_MORE_EVIDENCE'
      ? ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE']
      : ['NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE'];
  return Array.from(new Set(gaps))
    .slice(0, 3)
    .map((gap) => codeReviewEvidencePlanForGap({
      gap,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
    }));
}

function codeReviewContextCallQuestionsForPlan(
  plan: ScheduledCodeReviewEvidencePlanItem[],
): string[] {
  const questions = plan.length > 0
    ? plan.map((item) => item.question.trim()).filter((question) => question.length > 0)
    : [...CONTEXT_CALL_QUESTIONS];

  if (
    questions.includes(SOURCE_BACKED_WORK_EVIDENCE_QUESTION)
    && !questions.includes(SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP)
  ) {
    questions.push(SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP);
  }

  return Array.from(new Set(questions)).slice(0, 3);
}

function isPassedCodeReviewVerdict(verdict: string | null | undefined): boolean {
  return (verdict ?? '').trim().toUpperCase() === 'PASSED';
}

function roleBackedContrastGapReason(
  selected: ScheduledCodeReviewRankedResult | null,
  roleSources: ScheduledCodeReviewRoleSource[],
): string | null {
  if (!selected) return null;
  const roleSourceCount = selected.validatorAgent?.sourceBridge?.roleSourceCount
    ?? roleSources.length
    ?? 0;
  const hasRoleEvidence = roleSourceCount > 0
    || selected.alignments.some((alignment) => alignment.roleSourceRefs.length > 0);
  if (!hasRoleEvidence) return null;

  const contrastMetric = selected.assessmentQuality?.metrics.find((metric) =>
    metric.id === 'contrast_separation'
  );
  if (contrastMetric && contrastMetric.score > 0) return null;

  return contrastMetric?.reason
    ?? 'Role-backed automatic matching did not measure positive separation from another eligible PR.';
}

function normalizeScheduledCodeReviewAssessmentQuality(
  selected: ScheduledCodeReviewRankedResult | null,
  roleSources: ScheduledCodeReviewRoleSource[],
): ScheduledCodeReviewAssessmentQuality | null {
  const assessmentQuality = selected?.assessmentQuality ?? null;
  const contrastGap = roleBackedContrastGapReason(selected, roleSources);
  if (!assessmentQuality || !contrastGap) return assessmentQuality;
  if (assessmentQuality.verdict.toUpperCase() === 'NEEDS_REVIEW') return assessmentQuality;
  return {
    ...assessmentQuality,
    verdict: 'NEEDS_REVIEW',
  };
}

function normalizeScheduledCodeReviewValidatorAgent(
  selected: ScheduledCodeReviewRankedResult | null,
  roleSources: ScheduledCodeReviewRoleSource[],
): ScheduledCodeReviewValidatorAgent | null {
  const validatorAgent = selected?.validatorAgent ?? null;
  const contrastGap = roleBackedContrastGapReason(selected, roleSources);
  if (!validatorAgent || !contrastGap || !isPassedCodeReviewVerdict(validatorAgent.verdict)) {
    return validatorAgent;
  }

  const hasContrastCheck = validatorAgent.checks.some((check) =>
    check.id === 'contrast_separation_verified'
  );
  return {
    ...validatorAgent,
    verdict: 'NEEDS_REVIEW',
    rationale: `${validatorAgent.rationale} Needs recruiter review: ${contrastGap}`,
    checks: [
      ...validatorAgent.checks,
      ...(hasContrastCheck
        ? []
        : [{
            id: 'contrast_separation_verified',
            passed: false,
            reason: contrastGap,
          }]),
    ],
  };
}

function scheduledCandidateSafeMatchStatus(status: string): CandidateSafeMatchStatus {
  if (status === 'MATCHED') return 'MATCHED';
  if (status === 'NO_ROLE_SAFE_CHALLENGE') return 'NO_ROLE_SAFE_CHALLENGE';
  return 'NEEDS_MORE_EVIDENCE';
}

function scheduledValidatorVerdict(
  verdict: string | undefined,
): 'PASSED' | 'NEEDS_REVIEW' | 'REJECTED' | undefined {
  const normalized = verdict?.toUpperCase();
  if (normalized === 'PASSED' || normalized === 'NEEDS_REVIEW' || normalized === 'REJECTED') {
    return normalized;
  }
  return undefined;
}

function scheduledSourceRefKey(ref: ScheduledCodeReviewSourceRef): string | null {
  const key = [
    ref.sourceRefType,
    ref.sourceRefId,
    ref.sourceSpanId,
    ref.locator,
    ref.contentHash,
    ref.exactText,
  ].map((part) => part?.trim() ?? '').join('\u001f');
  return key.replace(/\u001f/g, '').trim().length > 0 ? key : null;
}

function countScheduledCodeReviewSourceRefs(refs: ScheduledCodeReviewSourceRef[]): number {
  const keys = new Set<string>();
  for (const ref of refs) {
    const key = scheduledSourceRefKey(ref);
    if (key) keys.add(key);
  }
  return keys.size;
}

function scheduledCodeReviewQualityGateFor(input: {
  status: string;
  selected: ScheduledCodeReviewRankedResult | null;
  assessmentQuality: ScheduledCodeReviewAssessmentQuality | null;
  validatorAgent: ScheduledCodeReviewValidatorAgent | null;
  roleSources: ScheduledCodeReviewRoleSource[];
}): ScheduledCodeReviewQualityGate {
  const alignments = input.selected?.alignments ?? [];
  const candidateSourceCount = countScheduledCodeReviewSourceRefs(
    alignments.flatMap((alignment) => alignment.candidateSourceRefs),
  );
  const repoSourceCount = countScheduledCodeReviewSourceRefs(
    alignments.flatMap((alignment) => alignment.challengeSourceRefs),
  );
  const roleSourceCount = countScheduledCodeReviewSourceRefs([
    ...alignments.flatMap((alignment) => alignment.roleSourceRefs),
    ...input.roleSources,
  ]);

  return candidateSafeQualityGateFor({
    status: scheduledCandidateSafeMatchStatus(input.status),
    candidateSourceCount,
    repoSourceCount,
    roleSourceCount,
    validatorVerdict: scheduledValidatorVerdict(input.validatorAgent?.verdict),
    assessmentQualityVerdict: input.assessmentQuality?.verdict.toUpperCase(),
    assessmentQualityMetrics: input.assessmentQuality?.metrics,
    requireContrastSeparation: roleSourceCount > 0,
  });
}

function scheduledManualCodeReviewQualityGate(): ScheduledCodeReviewQualityGate {
  return {
    verdict: 'PASSED',
    checks: ['repo_source_spans', 'source_backed_manual_override', 'agent_validated_match'],
    diagnostics: [],
  };
}

function buildScheduledCodeReviewHyperedges(
  alignments: ScheduledCodeReviewAlignment[],
  roleSources: ScheduledCodeReviewRoleSource[],
): ScheduledCodeReviewHyperedge[] {
  return alignments.flatMap((alignment, index) => {
    const roleRef = alignment.roleSourceRefs[0] ?? roleSources[0];
    const candidateRef = alignment.candidateSourceRefs[0];
    const challengeRef = alignment.challengeSourceRefs[0];
    const nodes: ScheduledCodeReviewHyperedgeNode[] = [
      ...(candidateRef
        ? [{
            kind: 'person_evidence' as const,
            label: 'Person evidence',
            sourceRef: candidateRef,
          }]
        : []),
      ...(roleRef
        ? [{
            kind: 'role_source' as const,
            label: 'Role source',
            sourceRef: roleRef,
          }]
        : []),
      ...(challengeRef
        ? [{
            kind: 'repo_challenge' as const,
            label: 'Repo challenge',
            sourceRef: challengeRef,
          }]
        : []),
    ];
    const hasPersonEvidence = nodes.some((node) => node.kind === 'person_evidence');
    const hasRoleSource = nodes.some((node) => node.kind === 'role_source');
    const hasRepoChallenge = nodes.some((node) => node.kind === 'repo_challenge');
    if (!hasPersonEvidence || !hasRepoChallenge) return [];
    return [{
      relation: hasRoleSource ? 'candidate_role_repo_alignment' : 'candidate_repo_evidence_alignment',
      label: hasRoleSource ? `Evidence bridge ${index + 1}` : `Candidate evidence bridge ${index + 1}`,
      pairScore: alignment.pairScore,
      nodes,
    }];
  });
}

function scheduledManualCodeReviewAssessmentQuality(): ScheduledCodeReviewAssessmentQuality {
  return {
    verdict: 'USABLE',
    score: 8,
    maxScore: 12,
    metrics: [
      {
        id: 'skill_stack_overlap',
        label: 'Skill/stack overlap',
        score: 1,
        maxScore: 2,
        reason: 'Manual override does not infer candidate-specific CV alignment; the candidate still reviewed a source-backed PR.',
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
        reason: 'The selected PR has a production-ready review packet.',
      },
      {
        id: 'match_specificity',
        label: 'Match specificity',
        score: 2,
        maxScore: 2,
        reason: 'The challenge targets one concrete repository, PR, and review packet.',
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
  };
}

function scheduledManualCodeReviewValidator(prNumber: number): ScheduledCodeReviewValidatorAgent {
  return {
    agentName: 'deterministic-code-review-match-gate',
    agentVersion: 'manual-source-backed-v1',
    mode: 'deterministic',
    verdict: 'PASSED',
    rationale: `Recruiter-selected PR #${prNumber} is accepted as a manual CODE_REVIEW override because it has a production-ready source-backed review packet. Candidate-specific CV alignment is not inferred on this path.`,
    checks: [
      {
        id: 'repo_source_spans',
        passed: true,
        reason: 'The selected PR has a persisted production-ready review packet.',
      },
      {
        id: 'source_backed_manual_override',
        passed: true,
        reason: 'The recruiter explicitly selected this PR, so PIPE validates reviewability and provenance instead of claiming an automatic CV match.',
      },
      {
        id: 'agent_validated_match',
        passed: true,
        reason: 'The deterministic gate accepted the selected PR for manual assessment delivery.',
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

async function loadManualCodeReviewMatchDetail(
  db: D1Database,
  interview: {
    matched_repo_id: number | null;
    github_repo_url: string | null;
    github_pr_number: number | null;
  },
): Promise<ScheduledCodeReviewMatchDetail | null> {
  if (!interview.github_pr_number || (!interview.matched_repo_id && !interview.github_repo_url)) {
    return null;
  }

  const packet = await db.prepare(
    `SELECT rcp.id, rcp.quality_score, rcp.packet_json
       FROM review_challenge_packets rcp
       LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
      WHERE rcp.pr_number = ?1
        AND rcp.production_ready = 1
        AND (
          (?2 IS NOT NULL AND rcp.repo_id = ?2)
          OR (?3 IS NOT NULL AND qr.github_url = ?3)
        )
      ORDER BY rcp.quality_score DESC, rcp.updated_at DESC
      LIMIT 1`,
  ).bind(
    interview.github_pr_number,
    interview.matched_repo_id,
    interview.github_repo_url,
  ).first<{ id: string; quality_score: number | null; packet_json: string | null }>();

  if (!packet) return null;

  return {
    status: 'MATCHED',
    matchRunId: null,
    packetId: packet.id,
    summary: 'Manual override: recruiter-selected source-backed review challenge. PIPE validated that the PR is reviewable and source-backed, but did not infer candidate-specific CV alignment.',
    score: numberOrNull(packet.quality_score),
    assessmentQuality: scheduledManualCodeReviewAssessmentQuality(),
    qualityGate: scheduledManualCodeReviewQualityGate(),
    reviewProfile: parseScheduledCodeReviewPacketReviewProfile(packet.packet_json),
    validatorAgent: scheduledManualCodeReviewValidator(interview.github_pr_number),
    roleSources: [],
    evidence: [],
    evidenceHyperedges: [],
    gaps: ['Manual override did not run automatic candidate-to-PR contrast ranking.'],
    evidencePlan: [],
    evidenceFollowUp: null,
    evidenceRefresh: null,
  };
}

async function loadCodeReviewEvidenceFollowUp(
  db: D1Database,
  originalInterviewId: string,
  candidateId: string | null,
): Promise<ScheduledCodeReviewEvidenceFollowUp | null> {
  if (!await tableExists(db, 'assessment_sessions')) {
    return null;
  }

  const rows = await db.prepare(
    `SELECT s.id AS assessment_session_id,
            s.interview_id AS context_call_interview_id,
            s.state,
            s.metadata_json,
            (
              SELECT t.reason
                FROM assessment_state_transitions t
               WHERE t.session_id = s.id
                 AND t.to_state = 'BLOCKED'
               ORDER BY t.sequence DESC
               LIMIT 1
            ) AS blocked_reason,
            s.created_at,
            s.updated_at
       FROM assessment_sessions s
      WHERE s.created_by = 'code-review-evidence-plan'
        AND (?2 IS NULL OR s.candidate_id = ?2)
        AND json_extract(s.metadata_json, '$.originalInterviewId') = ?1
        AND s.state NOT IN ('EVALUATED', 'CANCELLED')
      ORDER BY
        CASE s.state
          WHEN 'IN_PROGRESS' THEN 0
          WHEN 'INTAKE' THEN 1
          WHEN 'FINAL_SUBMITTED' THEN 2
          WHEN 'EVALUATING' THEN 3
          WHEN 'EVALUATION_PENDING' THEN 4
          WHEN 'BLOCKED' THEN 5
          ELSE 6
        END,
        s.updated_at DESC,
        s.id DESC
      LIMIT 5`,
  ).bind(originalInterviewId, candidateId).all<{
    assessment_session_id: string;
    context_call_interview_id: string | null;
    state: string;
    metadata_json: string | null;
    blocked_reason: string | null;
    created_at: string;
    updated_at: string;
  }>();

  for (const row of rows.results ?? []) {
    const metadata = parseJsonObject(row.metadata_json);
    if (optionalString(metadata.originalInterviewId) !== originalInterviewId) continue;

    return {
      assessmentSessionId: row.assessment_session_id,
      contextCallInterviewId: optionalString(metadata.contextCallInterviewId)
        ?? optionalString(row.context_call_interview_id)
        ?? null,
      state: row.state,
      blockedReason: row.state === 'BLOCKED' ? optionalString(row.blocked_reason) ?? null : null,
      matchRunId: optionalString(metadata.matchRunId) ?? null,
      matchStatus: optionalString(metadata.matchStatus) ?? null,
      gaps: stringArray(metadata.gaps),
      questions: stringArray(metadata.questions),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return null;
}

async function countCodeReviewEvidenceRefreshMatcherContexts(
  db: D1Database,
  assessmentSessionId: string,
): Promise<number> {
  if (!await tableExists(db, 'context_records')
    || !await tableExists(db, 'context_record_entities')) {
    return 0;
  }
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT cr.id) AS count
       FROM context_records cr
       JOIN context_record_entities cre ON cre.context_record_id = cr.id
      WHERE cr.record_type = 'code_review_evidence_plan_response'
        AND cre.entity_type = 'assessment_session'
        AND cre.entity_id = ?1
        AND cre.relationship = 'source_assessment'`,
  ).bind(assessmentSessionId).first<{ count: number }>();
  return row?.count ?? 0;
}

async function loadCodeReviewEvidenceRefresh(
  db: D1Database,
  originalInterviewId: string,
  candidateId: string | null,
): Promise<ScheduledCodeReviewEvidenceRefresh | null> {
  if (!await tableExists(db, 'assessment_sessions')
    || !await tableExists(db, 'assessment_evaluation_reports')) {
    return null;
  }

  const rows = await db.prepare(
    `SELECT s.id AS assessment_session_id,
            s.interview_id AS context_call_interview_id,
            s.metadata_json AS session_metadata_json,
            s.completed_at AS session_completed_at,
            s.updated_at AS session_updated_at,
            r.id AS report_id,
            r.summary AS report_summary,
            r.output_json AS report_output_json,
            r.created_at AS report_created_at,
            r.updated_at AS report_updated_at
       FROM assessment_sessions s
       JOIN assessment_evaluation_reports r ON r.session_id = s.id
      WHERE s.created_by = 'code-review-evidence-plan'
        AND (?2 IS NULL OR s.candidate_id = ?2)
        AND (
          json_extract(s.metadata_json, '$.originalInterviewId') = ?1
          OR json_extract(r.output_json, '$.originalInterviewId') = ?1
        )
        AND json_extract(r.output_json, '$.status') = 'READY_FOR_REPO_MATCH_REFRESH'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 5`,
  ).bind(originalInterviewId, candidateId).all<{
    assessment_session_id: string;
    context_call_interview_id: string | null;
    session_metadata_json: string | null;
    session_completed_at: string | null;
    session_updated_at: string | null;
    report_id: string;
    report_summary: string;
    report_output_json: string | null;
    report_created_at: string | null;
    report_updated_at: string | null;
  }>();

  for (const row of rows.results ?? []) {
    const metadata = parseJsonObject(row.session_metadata_json);
    const output = parseJsonObject(row.report_output_json);
    const outputOriginalInterviewId = optionalString(output.originalInterviewId);
    const metadataOriginalInterviewId = optionalString(metadata.originalInterviewId);
    if (
      outputOriginalInterviewId !== originalInterviewId
      && metadataOriginalInterviewId !== originalInterviewId
    ) {
      continue;
    }

    const status = optionalString(output.status);
    if (status !== 'READY_FOR_REPO_MATCH_REFRESH') continue;

    const sourceSpanCount = numberOrNull(output.sourceSpanCount);
    const matcherContextCount = await countCodeReviewEvidenceRefreshMatcherContexts(
      db,
      row.assessment_session_id,
    );
    const evidenceSnippets = await loadCodeReviewEvidenceSnippets(db, row.assessment_session_id);
    const consumption = await loadCodeReviewEvidenceRefreshConsumption(db, {
      assessmentSessionId: row.assessment_session_id,
      readyReportId: row.report_id,
    });
    return {
      status,
      assessmentSessionId: row.assessment_session_id,
      contextCallInterviewId: optionalString(output.contextCallInterviewId)
        ?? optionalString(metadata.contextCallInterviewId)
        ?? row.context_call_interview_id,
      reportId: row.report_id,
      summary: row.report_summary,
      sourceSpanCount,
      matcherContextCount,
      evidenceSnippets,
      matchRunId: optionalString(output.matchRunId) ?? optionalString(metadata.matchRunId) ?? null,
      matchStatus: optionalString(output.matchStatus) ?? optionalString(metadata.matchStatus) ?? null,
      consumptionReportId: consumption.consumptionReportId,
      consumedByMatchRunId: consumption.consumedByMatchRunId,
      consumedByMatchStatus: consumption.consumedByMatchStatus,
      consumedAt: consumption.consumedAt,
      completedAt: row.session_completed_at ?? row.report_created_at,
      updatedAt: row.report_updated_at ?? row.session_updated_at,
    };
  }

  return null;
}

async function loadCodeReviewEvidenceRefreshConsumption(
  db: D1Database,
  input: { assessmentSessionId: string; readyReportId: string },
): Promise<{
  consumptionReportId: string | null;
  consumedByMatchRunId: string | null;
  consumedByMatchStatus: string | null;
  consumedAt: string | null;
}> {
  if (!await tableExists(db, 'assessment_evaluation_reports')) {
    return {
      consumptionReportId: null,
      consumedByMatchRunId: null,
      consumedByMatchStatus: null,
      consumedAt: null,
    };
  }

  const row = await db.prepare(
    `SELECT id, output_json, created_at
       FROM assessment_evaluation_reports
      WHERE session_id = ?1
        AND json_extract(output_json, '$.schemaVersion') = 'code-review-evidence-plan-consumption-v1'
        AND json_extract(output_json, '$.readyReportId') = ?2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(input.assessmentSessionId, input.readyReportId).first<{
    id: string;
    output_json: string | null;
    created_at: string;
  }>();
  if (!row) {
    return {
      consumptionReportId: null,
      consumedByMatchRunId: null,
      consumedByMatchStatus: null,
      consumedAt: null,
    };
  }

  const output = parseJsonObject(row.output_json);
  return {
    consumptionReportId: row.id,
    consumedByMatchRunId: optionalString(output.consumedByMatchRunId) ?? null,
    consumedByMatchStatus: optionalString(output.consumedByMatchStatus) ?? null,
    consumedAt: optionalString(output.consumedAt) ?? row.created_at,
  };
}

async function loadCodeReviewEvidenceSnippets(
  db: D1Database,
  assessmentSessionId: string,
): Promise<ScheduledCodeReviewEvidenceSnippet[]> {
  if (!await tableExists(db, 'assessment_evidence_events')
    || !await tableExists(db, 'assessment_event_source_refs')) {
    return [];
  }

  const rows = await db.prepare(
    `SELECT e.id AS event_id,
            e.occurred_at,
            r.source_ref_id,
            r.source_span_id,
            r.evidence_role,
            r.locator_json,
            r.exact_text
       FROM assessment_evidence_events e
       JOIN assessment_event_source_refs r ON r.event_id = e.id
      WHERE e.session_id = ?1
        AND e.kind = 'evidence_plan_response_span'
        AND r.exact_text IS NOT NULL
        AND trim(r.exact_text) <> ''
      ORDER BY e.sequence ASC, r.id ASC
      LIMIT 3`,
  ).bind(assessmentSessionId).all<{
    event_id: string;
    occurred_at: string | null;
    source_ref_id: string;
    source_span_id: string | null;
    evidence_role: string;
    locator_json: string | null;
    exact_text: string;
  }>();

  return (rows.results ?? []).map((row) => ({
    eventId: row.event_id,
    sourceRefId: row.source_ref_id,
    sourceSpanId: row.source_span_id,
    evidenceRole: row.evidence_role,
    exactText: row.exact_text,
    occurredAt: row.occurred_at,
    locator: parseJsonObject(row.locator_json),
  }));
}

async function loadLatestCandidateMatchRun(
  db: D1Database,
  candidateId: string,
): Promise<{ id: string; status: string; created_at: string | null } | null> {
  if (!await tableExists(db, 'match_runs')) return null;
  return await db.prepare(
    `SELECT id, status, created_at
       FROM match_runs
      WHERE candidate_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(candidateId).first<{ id: string; status: string; created_at: string | null }>();
}

function assessmentQualityScoreLabel(quality: ScheduledCodeReviewAssessmentQuality | null): string | null {
  if (!quality) return null;
  return `${quality.score}/${quality.maxScore}`;
}

function contrastMetricFor(
  quality: ScheduledCodeReviewAssessmentQuality | null,
): ScheduledCodeReviewQualityMetric | null {
  return quality?.metrics.find((metric) => metric.id === 'contrast_separation') ?? null;
}

function pendingMatchDiagnosticFromRow(row: {
  id: string;
  status: string;
  selected_packet_id: string | null;
  ranked_results_json: string | null;
  github_url: string | null;
  pr_number: number | null;
}): ScheduledPendingMatchDiagnostic | null {
  const ranked = parseScheduledCodeReviewRankedResults(row.ranked_results_json);
  const selected = row.selected_packet_id
    ? ranked.find((entry) => entry.challengeId === row.selected_packet_id)
    : ranked.find((entry) => entry.rank === 1) ?? ranked[0];
  if (!selected) return null;
  const contrast = contrastMetricFor(selected.assessmentQuality);
  return {
    matchRunId: row.id,
    status: row.status,
    selectedPacketId: row.selected_packet_id,
    githubRepoUrl: row.github_url,
    githubPrNumber: row.pr_number ?? selected.prNumber,
    assessmentQualityVerdict: selected.assessmentQuality?.verdict ?? null,
    assessmentQualityScore: assessmentQualityScoreLabel(selected.assessmentQuality),
    contrastScore: contrast?.score ?? null,
    contrastReason: contrast?.reason ?? null,
  };
}

async function loadPendingCodeReviewMatchDiagnosticsByCandidateIds(
  db: D1Database,
  candidateIds: string[],
): Promise<Map<string, ScheduledPendingMatchDiagnostic>> {
  const uniqueCandidateIds = [...new Set(candidateIds.filter((id) => id.trim().length > 0))];
  const diagnostics = new Map<string, ScheduledPendingMatchDiagnostic>();
  if (uniqueCandidateIds.length === 0) return diagnostics;
  if (
    !await tableExists(db, 'match_runs')
    || !await tableExists(db, 'review_challenge_packets')
    || !await tableExists(db, 'qualified_repos')
  ) {
    return diagnostics;
  }

  const placeholders = uniqueCandidateIds.map((_, index) => `?${index + 1}`).join(', ');
  const rows = await db.prepare(
    `SELECT mr.candidate_id,
            mr.id,
            mr.status,
            mr.selected_packet_id,
            mr.ranked_results_json,
            rcp.pr_number,
            qr.github_url
       FROM match_runs mr
       LEFT JOIN review_challenge_packets rcp ON rcp.id = mr.selected_packet_id
       LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
      WHERE mr.candidate_id IN (${placeholders})
        AND mr.id = (
          SELECT latest.id
            FROM match_runs latest
           WHERE latest.candidate_id = mr.candidate_id
           ORDER BY latest.created_at DESC, latest.id DESC
           LIMIT 1
        )`,
  ).bind(...uniqueCandidateIds).all<{
    candidate_id: string;
    id: string;
    status: string;
    selected_packet_id: string | null;
    ranked_results_json: string | null;
    pr_number: number | null;
    github_url: string | null;
  }>();

  for (const row of rows.results ?? []) {
    const diagnostic = pendingMatchDiagnosticFromRow(row);
    if (diagnostic) diagnostics.set(row.candidate_id, diagnostic);
  }
  return diagnostics;
}

function evidenceRefreshAlreadyTried(
  evidenceRefresh: ScheduledCodeReviewEvidenceRefresh,
  latestMatchRun: { id: string; created_at: string | null } | null,
): boolean {
  if (!latestMatchRun || !evidenceRefresh.matchRunId) return false;
  if (latestMatchRun.id === evidenceRefresh.matchRunId) return false;
  if (!latestMatchRun.created_at || !evidenceRefresh.updatedAt) return true;
  return latestMatchRun.created_at >= evidenceRefresh.updatedAt;
}

function evidenceRefreshConsumptionReportStatus(
  matchStatus: string,
): 'EVALUATED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE' {
  if (matchStatus === 'MATCHED') return 'EVALUATED';
  if (matchStatus === 'NO_ROLE_SAFE_CHALLENGE') return 'NO_ROLE_SAFE_CHALLENGE';
  return 'NEEDS_MORE_EVIDENCE';
}

async function loadCodeReviewEvidenceRefreshSourceRefs(
  db: D1Database,
  assessmentSessionId: string,
): Promise<AssessmentEvidenceSourceRefInput[]> {
  if (!await tableExists(db, 'assessment_evidence_events')
    || !await tableExists(db, 'assessment_event_source_refs')) {
    return [];
  }

  const rows = await db.prepare(
    `SELECT r.source_ref_type,
            r.source_ref_id,
            r.source_span_id,
            r.evidence_role,
            r.locator_json,
            r.exact_text,
            r.content_hash,
            r.metadata_json
       FROM assessment_evidence_events e
       JOIN assessment_event_source_refs r ON r.event_id = e.id
      WHERE e.session_id = ?1
        AND e.kind = 'evidence_plan_response_span'
        AND r.exact_text IS NOT NULL
        AND trim(r.exact_text) <> ''
        AND r.content_hash IS NOT NULL
        AND trim(r.content_hash) <> ''
      ORDER BY e.sequence ASC, r.id ASC
      LIMIT 12`,
  ).bind(assessmentSessionId).all<{
    source_ref_type: string;
    source_ref_id: string;
    source_span_id: string | null;
    evidence_role: string;
    locator_json: string | null;
    exact_text: string;
    content_hash: string;
    metadata_json: string | null;
  }>();

  return (rows.results ?? []).map((row) => ({
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    sourceSpanId: row.source_span_id,
    evidenceRole: row.evidence_role,
    locator: parseJsonObject(row.locator_json) as AssessmentEvidenceSourceRefInput['locator'],
    exactText: row.exact_text,
    contentHash: row.content_hash,
    metadata: parseJsonObject(row.metadata_json) as AssessmentEvidenceSourceRefInput['metadata'],
  }));
}

async function sourceSpanBelongsToWorkspacePerson(
  db: D1Database,
  input: { sourceSpanId: string; workspacePersonId: string },
): Promise<boolean> {
  if (!await tableExists(db, 'source_spans')
    || !await tableExists(db, 'artifact_versions')
    || !await tableExists(db, 'artifacts')) {
    return false;
  }

  const direct = await db.prepare(
    `SELECT ss.id
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE ss.id = ?1
        AND a.workspace_person_id = ?2`,
  ).bind(input.sourceSpanId, input.workspacePersonId).first<{ id: string }>();
  if (direct) return true;

  if (!await tableExists(db, 'artifact_interactions')) return false;
  const linked = await db.prepare(
    `SELECT ss.id
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN artifact_interactions ai ON ai.artifact_id = a.id
       JOIN interactions i ON i.id = ai.interaction_id
      WHERE ss.id = ?1
        AND i.workspace_person_id = ?2`,
  ).bind(input.sourceSpanId, input.workspacePersonId).first<{ id: string }>();
  return Boolean(linked);
}

async function loadCodeReviewEvidenceRefreshInteractionId(input: {
  db: D1Database;
  workspacePersonId: string;
  meetingId: string;
}): Promise<string | null> {
  if (!await tableExists(input.db, 'interactions')) return null;
  const row = await input.db.prepare(
    `SELECT id
       FROM interactions
      WHERE workspace_person_id = ?1
        AND external_reference = ?2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(input.workspacePersonId, input.meetingId).first<{ id: string }>();
  return row?.id ?? null;
}

async function repairCodeReviewEvidenceRefreshMatcherContexts(
  db: D1Database,
  input: {
    evidenceRefresh: ScheduledCodeReviewEvidenceRefresh;
    originalInterviewId: string;
    candidateId: string;
  },
): Promise<number> {
  if (!await hasAssessmentLayerSchema(db)
    || !await tableExists(db, 'context_record_entities')
    || !await tableExists(db, 'context_record_concepts')
    || !await tableExists(db, 'concepts')) {
    return await countCodeReviewEvidenceRefreshMatcherContexts(
      db,
      input.evidenceRefresh.assessmentSessionId,
    );
  }

  const identity = await ensureCandidateLivingContext(db, input.candidateId);
  if (!identity) return 0;

  const planSession = await db.prepare(
    `SELECT id, interview_id, metadata_json
       FROM assessment_sessions
      WHERE id = ?1
        AND created_by = 'code-review-evidence-plan'
      LIMIT 1`,
  ).bind(input.evidenceRefresh.assessmentSessionId).first<{
    id: string;
    interview_id: string | null;
    metadata_json: string | null;
  }>();
  if (!planSession) {
    return await countCodeReviewEvidenceRefreshMatcherContexts(
      db,
      input.evidenceRefresh.assessmentSessionId,
    );
  }

  const sourceRefs = await loadCodeReviewEvidenceRefreshSourceRefs(
    db,
    input.evidenceRefresh.assessmentSessionId,
  );
  if (sourceRefs.length === 0) {
    return await countCodeReviewEvidenceRefreshMatcherContexts(
      db,
      input.evidenceRefresh.assessmentSessionId,
    );
  }

  const metadata = parseJsonObject(planSession.metadata_json);
  const originalInterviewId = optionalString(metadata.originalInterviewId) ?? input.originalInterviewId;
  const contextCallInterviewId = input.evidenceRefresh.contextCallInterviewId
    ?? optionalString(metadata.contextCallInterviewId)
    ?? optionalString(planSession.interview_id)
    ?? null;
  const matchRunId = input.evidenceRefresh.matchRunId
    ?? optionalString(metadata.matchRunId)
    ?? null;
  const matchStatus = input.evidenceRefresh.matchStatus
    ?? optionalString(metadata.matchStatus)
    ?? null;
  const observedAt = input.evidenceRefresh.completedAt
    ?? input.evidenceRefresh.updatedAt
    ?? new Date().toISOString();
  const store = new LivingContextStore(db, () => observedAt);

  for (const sourceRef of sourceRefs) {
    const exactText = optionalString(sourceRef.exactText);
    const sourceSpanId = optionalString(sourceRef.sourceSpanId) ?? optionalString(sourceRef.sourceRefId);
    if (!exactText || !sourceSpanId || sourceRef.sourceRefType !== 'source_span') continue;
    const terms = codeReviewEvidenceRepairOpenTerms(exactText);
    if (terms.length === 0) continue;
    const isOwned = await sourceSpanBelongsToWorkspacePerson(db, {
      sourceSpanId,
      workspacePersonId: identity.workspacePersonId,
    });
    if (!isOwned) continue;

    const concepts: ContextRecordConceptInput[] = [];
    for (const term of terms) {
      const concept = await store.upsertConcept({
        ingestionKey: `open-term:${term.canonicalKey}`,
        canonicalKey: term.canonicalKey,
        namespace: 'term',
        label: term.surface,
        metadata: {
          resolver: OPEN_TERM_RESOLVER_VERSION,
          source: 'code_review_evidence_plan_repair',
        },
      });
      concepts.push({
        conceptId: concept.id,
        relationship: 'about',
        weight: 1,
      });
    }

    const locator = isRecord(sourceRef.locator) ? sourceRef.locator as JsonObject : {};
    const meetingId = optionalString(locator.meetingId) ?? null;
    const interactionId = meetingId
      ? await loadCodeReviewEvidenceRefreshInteractionId({
          db,
          workspacePersonId: identity.workspacePersonId,
          meetingId,
        })
      : null;
    const source: ContextRecordSourceInput = {
      sourceSpanId,
      sourceRefType: 'source_span',
      sourceRefId: optionalString(sourceRef.sourceRefId) ?? sourceSpanId,
      evidenceRole: sourceRef.evidenceRole ?? 'evidence_plan_response_span',
      locator,
      exactText,
      contentHash: optionalString(sourceRef.contentHash) ?? null,
      metadata: isRecord(sourceRef.metadata) ? sourceRef.metadata as JsonObject : {},
    };
    const entities: ContextRecordEntityInput[] = [
      {
        entityType: 'workspace_person',
        entityId: identity.workspacePersonId,
        relationship: 'subject',
      },
      {
        entityType: 'assessment_session',
        entityId: input.evidenceRefresh.assessmentSessionId,
        relationship: 'source_assessment',
      },
    ];
    if (meetingId) {
      entities.push({
        entityType: 'meeting',
        entityId: meetingId,
        relationship: 'source_interaction',
      });
    }
    if (contextCallInterviewId) {
      entities.push({
        entityType: 'scheduled_interview',
        entityId: contextCallInterviewId,
        relationship: 'context_call',
      });
    }
    if (originalInterviewId) {
      entities.push({
        entityType: 'scheduled_interview',
        entityId: originalInterviewId,
        relationship: 'original_code_review',
      });
    }
    if (matchRunId) {
      entities.push({
        entityType: 'match_run',
        entityId: matchRunId,
        relationship: 'evidence_gap_source',
      });
    }

    try {
      await store.upsertContextRecord({
        ingestionKey: `assessment-session:${input.evidenceRefresh.assessmentSessionId}:evidence-plan-response:${sourceSpanId}`,
        workspacePersonId: identity.workspacePersonId,
        interactionId,
        applicationId: identity.applicationId,
        recordType: 'code_review_evidence_plan_response',
        predicate: 'provides concrete candidate work evidence for repo matching',
        narrative: exactText,
        qualifiers: {
          evidencePlanSessionId: input.evidenceRefresh.assessmentSessionId,
          originalInterviewId,
          contextCallInterviewId,
          meetingId,
          matchRunId,
          matchStatus,
          concreteEvidenceSignalCount: countCodeReviewEvidenceRepairSignals(exactText),
          repairedFromAssessmentSourceRef: true,
          extractedProperties: JSON.stringify({
            semantic_terms: terms.map((term) => ({
              surface: term.surface,
              canonical_key: term.canonicalKey,
            })),
          }),
        },
        confidence: 0.85,
        extractionVersion: 'code-review-evidence-plan-response-v1',
        observedAt,
        sources: [source],
        entities,
        concepts,
      });
      await store.enqueueProjection({
        ingestionKey: `assessment-session:${input.evidenceRefresh.assessmentSessionId}:evidence-plan-response:${sourceSpanId}:neo4j`,
        projectionType: 'neo4j',
        aggregateType: 'workspace_person',
        aggregateId: identity.workspacePersonId,
        payload: {
          contextRecordType: 'code_review_evidence_plan_response',
          assessmentSessionId: input.evidenceRefresh.assessmentSessionId,
          sourceSpanId,
          originalInterviewId,
          contextCallInterviewId,
          matchRunId,
          repairedFromAssessmentSourceRef: true,
        },
      });
    } catch (error) {
      console.error('[repairCodeReviewEvidenceRefreshMatcherContexts] failed to repair source span:', {
        assessmentSessionId: input.evidenceRefresh.assessmentSessionId,
        sourceSpanId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return await countCodeReviewEvidenceRefreshMatcherContexts(
    db,
    input.evidenceRefresh.assessmentSessionId,
  );
}

async function recordCodeReviewEvidenceRefreshConsumption(
  db: D1Database,
  input: {
    evidenceRefresh: ScheduledCodeReviewEvidenceRefresh;
    originalInterviewId: string;
    candidateId: string;
    refreshed: boolean;
    consumedByMatchRunId: string;
    consumedByMatchStatus: string;
    repoId?: number | null;
    repoUrl?: string | null;
    prNumber?: number | null;
    consumedAt: string;
  },
): Promise<void> {
  if (!await hasAssessmentLayerSchema(db)) return;

  const summary = input.refreshed
    ? `Evidence-plan follow-up ${input.evidenceRefresh.reportId} was consumed by repo-match rerun ${input.consumedByMatchRunId} and selected ${input.repoUrl ?? `repo ${input.repoId ?? 'unknown'}`} PR #${input.prNumber ?? 'unknown'}.`
    : `Evidence-plan follow-up ${input.evidenceRefresh.reportId} was consumed by repo-match rerun ${input.consumedByMatchRunId}, but the matcher returned ${input.consumedByMatchStatus}.`;
  const sourceRefs = await loadCodeReviewEvidenceRefreshSourceRefs(db, input.evidenceRefresh.assessmentSessionId);
  const store = new AssessmentLayerStore(db, () => input.consumedAt);
  await store.createEvaluationReport({
    sessionId: input.evidenceRefresh.assessmentSessionId,
    ingestionKey: `assessment-report:code-review-evidence-plan:${input.evidenceRefresh.assessmentSessionId}:${input.evidenceRefresh.reportId}:${input.consumedByMatchRunId}:consumed`,
    status: evidenceRefreshConsumptionReportStatus(input.consumedByMatchStatus),
    summary,
    output: {
      schemaVersion: 'code-review-evidence-plan-consumption-v1',
      status: 'USED_FOR_REPO_MATCH_REFRESH',
      originalInterviewId: input.originalInterviewId,
      candidateId: input.candidateId,
      readyReportId: input.evidenceRefresh.reportId,
      assessmentSessionId: input.evidenceRefresh.assessmentSessionId,
      contextCallInterviewId: input.evidenceRefresh.contextCallInterviewId,
      sourceSpanCount: input.evidenceRefresh.sourceSpanCount,
      sourceMatchRunId: input.evidenceRefresh.matchRunId,
      sourceMatchStatus: input.evidenceRefresh.matchStatus,
      consumedByMatchRunId: input.consumedByMatchRunId,
      consumedByMatchStatus: input.consumedByMatchStatus,
      refreshed: input.refreshed,
      repoId: input.repoId ?? null,
      repoUrl: input.repoUrl ?? null,
      prNumber: input.prNumber ?? null,
      consumedAt: input.consumedAt,
    },
    claims: sourceRefs.length > 0
      ? [{
          id: `assessment_claim_${input.evidenceRefresh.assessmentSessionId}_${input.consumedByMatchRunId}_repo_match_refresh_consumption`,
          polarity: 'neutral',
          dimension: 'repo_match_refresh_consumption',
          narrative: summary,
          confidence: 1,
          sourceRefs,
        }]
      : [],
    diagnostics: [],
  });
}

function parseRoleContextVersion(rcdJson: string | null): string | null {
  if (!rcdJson) return null;
  try {
    const parsed = JSON.parse(rcdJson) as { rcd_version?: unknown };
    return typeof parsed.rcd_version === 'string' ? parsed.rcd_version : null;
  } catch {
    return null;
  }
}

async function loadScheduledCodeReviewMatchOptions(
  db: D1Database,
  pipelineId: string | null,
): Promise<CandidateReviewChallengeOptions> {
  if (!pipelineId) return {};
  if (!await tableExists(db, 'role_contexts')) return {};

  const roleContext = await db.prepare(
    `SELECT id, rcd_json, job_description_md, non_negotiable_skills_json
       FROM role_contexts
      WHERE pipeline_id = ?1
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(pipelineId).first<{
    id: string;
    rcd_json: string | null;
    job_description_md: string | null;
    non_negotiable_skills_json: string | null;
  }>();
  if (!roleContext) return {};

  const roleSemantics = await loadRoleChallengeSemantics(db, {
    ...roleContext,
    rcd_version: parseRoleContextVersion(roleContext.rcd_json),
  });

  return {
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
  };
}

async function loadScheduledCodeReviewMatchDetail(
  db: D1Database,
  interview: {
    id: string;
    candidate_id: string | null;
    interview_type: string | null;
    matched_repo_id: number | null;
    github_repo_url: string | null;
    github_pr_number: number | null;
  },
): Promise<ScheduledCodeReviewMatchDetail | null> {
  if (interview.interview_type !== 'CODE_REVIEW' || !interview.candidate_id) return null;
  const evidenceRefresh = await loadCodeReviewEvidenceRefresh(db, interview.id, interview.candidate_id);
  const evidenceFollowUp = evidenceRefresh
    ? null
    : await loadCodeReviewEvidenceFollowUp(db, interview.id, interview.candidate_id);

  const run = await db.prepare(
    `SELECT id, status, ranked_results_json, selected_packet_id, query_json
       FROM match_runs
      WHERE candidate_id = ?1
      ORDER BY
        CASE
          WHEN ?2 IS NOT NULL
           AND ?3 IS NOT NULL
           AND selected_packet_id IN (
             SELECT id FROM review_challenge_packets
              WHERE repo_id = ?2 AND pr_number = ?3
           )
          THEN 0
          ELSE 1
        END,
        created_at DESC,
        id DESC
      LIMIT 1`,
  ).bind(
    interview.candidate_id,
    interview.matched_repo_id,
    interview.github_pr_number,
  ).first<{
    id: string;
    status: string;
    ranked_results_json: string | null;
    selected_packet_id: string | null;
    query_json: string | null;
  }>();

  if (!run) {
    const manual = await loadManualCodeReviewMatchDetail(db, interview);
    return manual ? { ...manual, evidenceFollowUp, evidenceRefresh } : null;
  }

  const rankedResults = parseScheduledCodeReviewRankedResults(run.ranked_results_json);
  const selected = rankedResults.find((result) => result.challengeId === run.selected_packet_id)
    ?? rankedResults.find((result) => result.rank === 1)
    ?? rankedResults.find((result) => result.eligible)
    ?? rankedResults[0]
    ?? null;
  const summary = scheduledCodeReviewMatchSummary(run.status, selected);
  const roleSources = parseScheduledCodeReviewRoleSourcesFromQuery(run.query_json);
  const evidence = selected?.alignments.slice(0, 4) ?? [];
  const selectedPacketId = selected?.challengeId ?? run.selected_packet_id;
  const reviewProfile = selected?.reviewProfile
    ?? await loadScheduledCodeReviewPacketReviewProfile(db, selectedPacketId);
  const assessmentQuality = normalizeScheduledCodeReviewAssessmentQuality(selected, roleSources);
  const validatorAgent = normalizeScheduledCodeReviewValidatorAgent(selected, roleSources);
  const qualityGate = scheduledCodeReviewQualityGateFor({
    status: run.status,
    selected,
    assessmentQuality,
    validatorAgent,
    roleSources,
  });
  const contrastGap = roleBackedContrastGapReason(selected, roleSources);
  const qualityGateGaps = run.status === 'MATCHED' ? qualityGate.diagnostics : [];
  const gaps = [
    ...summary.gaps,
    ...(contrastGap ? [contrastGap] : []),
    ...qualityGateGaps,
  ];
  const uniqueGaps = [...new Set(gaps)];

  return {
    status: run.status,
    matchRunId: run.id,
    packetId: selectedPacketId,
    summary: summary.summary,
    score: selected?.score ?? null,
    assessmentQuality,
    qualityGate,
    reviewProfile,
    validatorAgent,
    roleSources,
    evidence,
    evidenceHyperedges: buildScheduledCodeReviewHyperedges(evidence, roleSources),
    gaps: uniqueGaps,
    evidencePlan: buildCodeReviewEvidencePlan({
      matchStatus: run.status,
      matchRunId: run.id,
      gaps: uniqueGaps,
    }),
    evidenceFollowUp,
    evidenceRefresh,
  };
}

async function loadScheduledCodeReviewScoreSummary(
  db: D1Database,
  interview: {
    interview_type: string | null;
    candidate_id: string | null;
    submission_json: string | null;
  },
): Promise<ScheduledCodeReviewScoreSummary | null> {
  if (interview.interview_type !== 'CODE_REVIEW') return null;

  const submission = parseJsonObject(interview.submission_json);
  const reviewSessionId = optionalString(submission.reviewSessionId);
  if (!reviewSessionId || !await tableExists(db, 'review_sessions')) return null;

  const candidateClause = interview.candidate_id ? 'AND candidate_id = ?2' : '';
  const row = await db.prepare(
    `SELECT id, status, score_report, updated_at
       FROM review_sessions
      WHERE id = ?1
        ${candidateClause}
      LIMIT 1`,
  ).bind(
    reviewSessionId,
    ...(interview.candidate_id ? [interview.candidate_id] : []),
  ).first<{
    id: string;
    status: string;
    score_report: string | null;
    updated_at: string;
  }>();

  if (!row) return null;

  const report = parseJsonObject(row.score_report);
  const overall = isRecord(report.overall) ? report.overall : {};

  return {
    reviewSessionId: row.id,
    status: row.status,
    score: numberOrNull(overall.score),
    band: optionalString(overall.band) ?? null,
    narrative: optionalString(overall.narrative) ?? null,
    strengths: stringArray(overall.strengths),
    growthAreas: stringArray(overall.growth_areas),
    provenance: {
      rubricDimensionCount: objectEntryCount(report.dimensions),
      evidenceItemCount: evidenceItemCount(report.evidence),
      metricCount: objectEntryCount(report.metrics),
    },
    updatedAt: row.updated_at,
  };
}

async function loadScheduledAssessmentProgress(
  db: D1Database,
  interviewId: string,
): Promise<AssessmentProgressSnapshot | null> {
  const sessionId = await loadScheduledAssessmentSessionId(db, interviewId);
  if (!sessionId) return null;

  const progress = await new RepoTaskInterviewSessionStore(db).loadProgress(sessionId);
  return normalizeScheduledAssessmentProgressAssignmentTrust(progress);
}

function normalizeScheduledAssessmentProgressAssignmentTrust(
  progress: AssessmentProgressSnapshot | null,
): AssessmentProgressSnapshot | null {
  if (progress?.assignmentTrust?.state !== 'matched_challenge') return progress;
  if (progress.assignmentTrust.detail === MATCHED_ASSESSMENT_ASSIGNMENT_DETAIL) return progress;
  return {
    ...progress,
    assignmentTrust: {
      ...progress.assignmentTrust,
      detail: MATCHED_ASSESSMENT_ASSIGNMENT_DETAIL,
    },
  };
}

async function loadScheduledAssessmentProgressByInterviewIds(
  db: D1Database,
  interviewIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListProgressSnapshot>> {
  const maxD1QueryVariables = 90;
  const uniqueInterviewIds = [...new Set(interviewIds)].filter((id) => id.length > 0);
  const progressByInterviewId = new Map<string, ScheduledAssessmentListProgressSnapshot>();
  if (uniqueInterviewIds.length === 0) return progressByInterviewId;

  if (!await hasScheduledAssessmentProgressSchema(db)) {
    return progressByInterviewId;
  }

  for (let offset = 0; offset < uniqueInterviewIds.length; offset += maxD1QueryVariables) {
    const chunk = uniqueInterviewIds.slice(offset, offset + maxD1QueryVariables);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(', ');
    const sessionResult = await db.prepare(
      `SELECT id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
              metadata_json, created_at, updated_at
         FROM (
           SELECT id,
                  ingestion_key,
                  interview_id,
                  mode,
                  state,
                  candidate_id,
                  workspace_id,
                  metadata_json,
                  created_at,
                  updated_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY interview_id
                    ORDER BY updated_at DESC, id DESC
                  ) AS rn
             FROM assessment_sessions
            WHERE interview_id IN (${placeholders})
         )
        WHERE rn = 1
          AND interview_id IS NOT NULL`,
    ).bind(...chunk).all<ScheduledAssessmentListSessionRow>();

    const sessions = (sessionResult.results ?? []).map((row) =>
      toScheduledAssessmentListSession(row));
    const sessionIds = sessions.map((session) => session.id);
    if (sessionIds.length === 0) continue;

    const [
      evidenceCountsBySessionId,
      sourceRefCountsBySessionId,
      latestEventBySessionId,
      challengeBySessionId,
      commitBySessionId,
      evaluationBySessionId,
      humanDecisionBySessionId,
    ] = await Promise.all([
      loadScheduledAssessmentEvidenceCounts(db, sessionIds),
      loadScheduledAssessmentSourceRefCounts(db, sessionIds),
      loadScheduledAssessmentLatestEvents(db, sessionIds),
      loadScheduledAssessmentChallengeRefs(db, sessionIds),
      loadScheduledAssessmentCommitSubmissions(db, sessionIds),
      loadScheduledAssessmentEvaluations(db, sessionIds),
      loadScheduledAssessmentHumanDecisions(db, sessionIds),
    ]);

    for (const session of sessions) {
      try {
        const challenge = challengeBySessionId.get(session.id) ?? null;
        if (challenge?.hasInvalidLocatorJson) {
          throw new Error('assessment challenge source ref has invalid locator_json');
        }
        const progress = buildScheduledAssessmentListProgress({
          session,
          evidenceCounts: evidenceCountsBySessionId.get(session.id) ?? [],
          sourceRefCounts: sourceRefCountsBySessionId.get(session.id) ?? [],
          latestEvent: latestEventBySessionId.get(session.id) ?? null,
          challenge,
          commit: commitBySessionId.get(session.id) ?? null,
          evaluation: evaluationBySessionId.get(session.id) ?? null,
          humanDecision: humanDecisionBySessionId.get(session.id) ?? null,
        });
        if (session.interviewId) {
          progressByInterviewId.set(session.interviewId, slimScheduledAssessmentListProgress(progress));
        }
      } catch (error) {
        console.error('[scheduling/listAssessmentProgress] failed to load assessment progress:', {
          interviewId: session.interviewId,
          assessmentSessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return progressByInterviewId;
}

interface ScheduledAssessmentChallengeSummary {
  repositoryUrl: string | null;
  githubPrNumber: number | null;
  pullRequestUrl: string | null;
  baseCommitSha: string | null;
  task: string | null;
  assessmentFit: string[];
  matchProof: string[];
  successCriteria: string[];
  expectedEvidence: string[];
}

type ScheduledAssessmentListProgressSnapshot = Omit<AssessmentProgressSnapshot, 'challenge'> & {
  challenge: (Omit<NonNullable<AssessmentProgressSnapshot['challenge']>, 'exactText'> & {
    exactText: null;
    summary: ScheduledAssessmentChallengeSummary;
  }) | null;
};

type ScheduledAssessmentListSession = AssessmentProgressSnapshot['session'];
type ScheduledAssessmentListSessionRow = {
  id: string;
  ingestion_key: string;
  interview_id: string | null;
  mode: string;
  state: string;
  candidate_id: string | null;
  workspace_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};
type ScheduledAssessmentListCount = AssessmentProgressSnapshot['evidenceCounts'][number];
type ScheduledAssessmentListLatestEvent = NonNullable<AssessmentProgressSnapshot['latestEvent']>;
type ScheduledAssessmentListChallenge = NonNullable<AssessmentProgressSnapshot['challenge']> & {
  hasInvalidLocatorJson?: boolean;
};
type ScheduledAssessmentListCommit = NonNullable<AssessmentProgressSnapshot['commit']>;
type ScheduledAssessmentListEvaluation = NonNullable<AssessmentProgressSnapshot['evaluation']>;
type ScheduledAssessmentListHumanDecision = NonNullable<AssessmentProgressSnapshot['humanDecision']>;
type ScheduledAssessmentListStage = AssessmentProgressSnapshot['stage'];
type ScheduledAssessmentListNextAction = AssessmentProgressSnapshot['nextAction'];
type ScheduledAssessmentListEvaluationClaim = ScheduledAssessmentListEvaluation['claims'][number];
type ScheduledAssessmentListEvaluationDiagnostic = ScheduledAssessmentListEvaluation['diagnostics'][number];
const SCHEDULED_ASSESSMENT_TRANSCRIPT_SOURCE_REF_TYPES = [
  'meeting_transcript_segment',
  'transcript_span',
] as const;
const SCHEDULED_ASSESSMENT_TOOL_ACTIVITY_SOURCE_REF_TYPES = [
  'terminal_command',
  'terminal_output',
  'code_server_file_observation',
  'code_server_editor_open',
  'room_media_control',
] as const;

function scheduledAssessmentPlaceholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(', ');
}

function scheduledAssessmentJsonRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function scheduledAssessmentJsonBoolean(value: unknown): boolean {
  return value === true;
}

function scheduledAssessmentCoverageTypeCounts(value: unknown): Record<string, number> {
  const record = scheduledAssessmentJsonRecord(value);
  if (!record) return {};
  const counts: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const count = numberOrNull(rawValue);
    if (count !== null) counts[key] = count;
  }
  return counts;
}

function scheduledAssessmentCoverageItem(value: unknown): AssessmentEvidenceCoverageItem | null {
  const item = scheduledAssessmentJsonRecord(value);
  if (!item) return null;
  const label = optionalString(item.label);
  if (!label) return null;
  return {
    label,
    required: scheduledAssessmentJsonBoolean(item.required),
    sourceRefTypes: stringArray(item.sourceRefTypes),
    satisfied: scheduledAssessmentJsonBoolean(item.satisfied),
    sourceRefKeys: stringArray(item.sourceRefKeys),
    missingImpact: optionalString(item.missingImpact) ?? '',
  };
}

function scheduledAssessmentCoverageItems(value: unknown): AssessmentEvidenceCoverageItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(scheduledAssessmentCoverageItem)
    .filter((item): item is AssessmentEvidenceCoverageItem => Boolean(item));
}

function scheduledAssessmentEvidenceCoverage(
  output: Record<string, unknown>,
): AssessmentEvidenceCoverageSnapshot | null {
  const coverage = scheduledAssessmentJsonRecord(output.evidenceCoverage);
  if (!coverage) return null;
  const schemaVersion = optionalString(coverage.schemaVersion);
  if (schemaVersion !== 'assessment-evidence-coverage-v1') return null;
  return {
    schemaVersion,
    sourceRefCount: numberOrNull(coverage.sourceRefCount) ?? 0,
    sourceRefTypeCounts: scheduledAssessmentCoverageTypeCounts(coverage.sourceRefTypeCounts),
    requiredForEvaluation: scheduledAssessmentCoverageItems(coverage.requiredForEvaluation),
    expectedForHighConfidence: scheduledAssessmentCoverageItems(coverage.expectedForHighConfidence),
  };
}

function scheduledAssessmentReviewPacketToneBlock(value: unknown): {
  status?: string;
  state?: string;
  label: string;
  detail: string;
  tone: string;
} | null {
  const record = scheduledAssessmentJsonRecord(value);
  if (!record) return null;
  const label = optionalString(record.label);
  const detail = optionalString(record.detail);
  const tone = optionalString(record.tone);
  if (!label || !detail || !tone) return null;
  const status = optionalString(record.status);
  const state = optionalString(record.state);
  return {
    ...(status ? { status } : {}),
    ...(state ? { state } : {}),
    label,
    detail,
    tone,
  };
}

function scheduledAssessmentContractEvidenceStatus(
  value: unknown,
): 'captured' | 'gap_declared' | 'needs_human_review' | null {
  if (value === 'captured' || value === 'gap_declared' || value === 'needs_human_review') return value;
  return null;
}

function scheduledAssessmentReviewPacketContractEvidence(value: unknown): NonNullable<
  NonNullable<ScheduledAssessmentListEvaluation['reviewPacket']>['evidence']['contractEvidence']
> | undefined {
  const receipt = scheduledAssessmentJsonRecord(value);
  if (!receipt) return undefined;
  if (optionalString(receipt.schemaVersion) !== 'assessment-contract-evidence-receipt-v1') return undefined;
  const summary = scheduledAssessmentJsonRecord(receipt.summary);
  if (!summary) return undefined;

  const expectedEvidence = Array.isArray(receipt.expectedEvidence)
    ? receipt.expectedEvidence.map((item) => {
      const record = scheduledAssessmentJsonRecord(item);
      if (!record) return null;
      const label = optionalString(record.label);
      const status = scheduledAssessmentContractEvidenceStatus(record.status);
      const detail = optionalString(record.detail);
      if (!label || !status || !detail) return null;
      return {
        label,
        status,
        expectedSourceRefTypes: stringArray(record.expectedSourceRefTypes),
        matchedSourceRefTypes: stringArray(record.matchedSourceRefTypes),
        sourceRefCount: numberOrNull(record.sourceRefCount) ?? 0,
        detail,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  const successCriteria = Array.isArray(receipt.successCriteria)
    ? receipt.successCriteria.map((item) => {
      const record = scheduledAssessmentJsonRecord(item);
      if (!record) return null;
      const label = optionalString(record.label);
      const detail = optionalString(record.detail);
      if (!label || !detail) return null;
      return {
        label,
        status: 'needs_human_review' as const,
        detail,
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return {
    schemaVersion: 'assessment-contract-evidence-receipt-v1',
    expectedEvidence,
    successCriteria,
    summary: {
      expectedEvidenceCount: numberOrNull(summary.expectedEvidenceCount) ?? expectedEvidence.length,
      capturedCount: numberOrNull(summary.capturedCount) ?? expectedEvidence.filter((item) => item.status === 'captured').length,
      gapDeclaredCount: numberOrNull(summary.gapDeclaredCount) ?? expectedEvidence.filter((item) => item.status === 'gap_declared').length,
      needsHumanReviewCount: numberOrNull(summary.needsHumanReviewCount)
        ?? (expectedEvidence.filter((item) => item.status !== 'captured').length + successCriteria.length),
    },
  };
}

function scheduledAssessmentReviewPacket(
  output: Record<string, unknown>,
): ScheduledAssessmentListEvaluation['reviewPacket'] {
  const packet = scheduledAssessmentJsonRecord(output.reviewPacket);
  if (!packet) return null;
  const schemaVersion = optionalString(packet.schemaVersion);
  if (schemaVersion !== 'repo-task-review-packet-v1') return null;

  const challenge = scheduledAssessmentJsonRecord(packet.challenge);
  const evidence = scheduledAssessmentJsonRecord(packet.evidence);
  const evaluation = scheduledAssessmentJsonRecord(packet.evaluation);
  if (!challenge || !evidence || !evaluation) return null;

  const assignmentTrust = scheduledAssessmentReviewPacketToneBlock(challenge.assignmentTrust);
  const contract = scheduledAssessmentJsonRecord(challenge.contract);
  const readiness = scheduledAssessmentJsonRecord(evidence.readiness);
  if (!assignmentTrust?.state || !contract || !readiness) return null;

  const readinessStatus = optionalString(readiness.status);
  const readinessLabel = optionalString(readiness.label);
  const readinessDetail = optionalString(readiness.detail);
  if (!readinessStatus || !readinessLabel || !readinessDetail) return null;

  const submissionRecord = scheduledAssessmentJsonRecord(packet.submission);
  const submission = submissionRecord
    ? (() => {
        const integrity = scheduledAssessmentReviewPacketToneBlock(submissionRecord.integrity);
        const challengeBinding = scheduledAssessmentReviewPacketToneBlock(submissionRecord.challengeBinding);
        if (!integrity?.status || !challengeBinding?.status) return null;
        return {
          repositoryUrl: optionalString(submissionRecord.repositoryUrl) ?? null,
          forkRepositoryUrl: optionalString(submissionRecord.forkRepositoryUrl) ?? null,
          branchName: optionalString(submissionRecord.branchName) ?? null,
          commitSha: optionalString(submissionRecord.commitSha) ?? null,
          commitUrl: optionalString(submissionRecord.commitUrl) ?? null,
          submissionSourceLabel: optionalString(submissionRecord.submissionSourceLabel) ?? null,
          changedFileCount: numberOrNull(submissionRecord.changedFileCount) ?? 0,
          integrity: {
            status: integrity.status,
            label: integrity.label,
            detail: integrity.detail,
            tone: integrity.tone,
          },
          challengeBinding: {
            status: challengeBinding.status,
            label: challengeBinding.label,
            detail: challengeBinding.detail,
            tone: challengeBinding.tone,
          },
        };
      })()
    : null;

  return {
    schemaVersion,
    challenge: {
      focus: optionalString(challenge.focus) ?? null,
      repositoryUrl: optionalString(challenge.repositoryUrl) ?? null,
      baseCommitSha: optionalString(challenge.baseCommitSha) ?? null,
      pullRequestUrl: optionalString(challenge.pullRequestUrl) ?? null,
      assignmentTrust: {
        state: assignmentTrust.state,
        label: assignmentTrust.label,
        detail: assignmentTrust.detail,
        tone: assignmentTrust.tone,
      },
      contract: {
        schemaVersion: optionalString(contract.schemaVersion) ?? '',
        isComplete: scheduledAssessmentJsonBoolean(contract.isComplete),
        missingFields: stringArray(contract.missingFields),
      },
    },
    submission,
    evidence: {
      sourceRefCount: numberOrNull(evidence.sourceRefCount) ?? 0,
      sourceRefTypeCounts: scheduledAssessmentCoverageTypeCounts(evidence.sourceRefTypeCounts),
      contractEvidence: scheduledAssessmentReviewPacketContractEvidence(evidence.contractEvidence),
      readiness: {
        status: readinessStatus,
        label: readinessLabel,
        detail: readinessDetail,
        isReadyForEvaluation: scheduledAssessmentJsonBoolean(readiness.isReadyForEvaluation),
        isUsableHiringSignal: scheduledAssessmentJsonBoolean(readiness.isUsableHiringSignal),
        missingRequiredCount: numberOrNull(readiness.missingRequiredCount) ?? 0,
      },
    },
    evaluation: {
      recommendation: optionalString(evaluation.recommendation) ?? null,
      claimCount: stringArray(evaluation.claimIds).length,
      diagnosticCount: stringArray(evaluation.diagnosticCodes).length,
    },
  };
}

function toScheduledAssessmentListSession(row: ScheduledAssessmentListSessionRow): ScheduledAssessmentListSession {
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    ingestionKey: row.ingestion_key,
    interviewId: row.interview_id,
    candidateId: row.candidate_id,
    workspaceId: row.workspace_id,
    workspacePersonId: optionalString(metadata.workspacePersonId) ?? null,
    applicationId: optionalString(metadata.applicationId) ?? null,
    mode: row.mode as ScheduledAssessmentListSession['mode'],
    state: scheduledAssessmentCanonicalState(row.state),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduledAssessmentCanonicalState(state: string): ScheduledAssessmentListSession['state'] {
  if (state === 'EVALUATION_PENDING') return 'EVALUATING';
  if (state === 'BLOCKED') return 'DIAGNOSTIC';
  return state as ScheduledAssessmentListSession['state'];
}

async function loadScheduledAssessmentEvidenceCounts(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListCount[]>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT session_id, kind, COUNT(*) AS count
       FROM assessment_evidence_events
      WHERE session_id IN (${placeholders})
      GROUP BY session_id, kind
      ORDER BY session_id, kind`,
  ).bind(...sessionIds).all<{ session_id: string; kind: string; count: number }>();
  const counts = new Map<string, ScheduledAssessmentListCount[]>();
  for (const row of result.results ?? []) {
    const list = counts.get(row.session_id) ?? [];
    list.push({ kind: row.kind, count: row.count });
    counts.set(row.session_id, list);
  }
  return counts;
}

async function loadScheduledAssessmentSourceRefCounts(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListCount[]>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT e.session_id, sr.source_ref_type AS kind, COUNT(*) AS count
       FROM assessment_event_source_refs sr
       JOIN assessment_evidence_events e ON e.id = sr.event_id
      WHERE e.session_id IN (${placeholders})
      GROUP BY e.session_id, sr.source_ref_type
      ORDER BY e.session_id, sr.source_ref_type`,
  ).bind(...sessionIds).all<{ session_id: string; kind: string; count: number }>();
  const counts = new Map<string, ScheduledAssessmentListCount[]>();
  for (const row of result.results ?? []) {
    const list = counts.get(row.session_id) ?? [];
    list.push({ kind: row.kind, count: row.count });
    counts.set(row.session_id, list);
  }
  return counts;
}

async function loadScheduledAssessmentLatestEvents(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListLatestEvent>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT id, session_id, kind, sequence, occurred_at
       FROM (
         SELECT id, session_id, kind, sequence, occurred_at,
                ROW_NUMBER() OVER (
                  PARTITION BY session_id
                  ORDER BY sequence DESC, created_at DESC, id DESC
                ) AS rn
           FROM assessment_evidence_events
          WHERE session_id IN (${placeholders})
       )
      WHERE rn = 1`,
  ).bind(...sessionIds).all<{
    id: string;
    session_id: string;
    kind: string;
    sequence: number;
    occurred_at: string;
  }>();
  const latest = new Map<string, ScheduledAssessmentListLatestEvent>();
  for (const row of result.results ?? []) {
    latest.set(row.session_id, {
      id: row.id,
      kind: row.kind,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
    });
  }
  return latest;
}

async function loadScheduledAssessmentChallengeRefs(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListChallenge>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT session_id, source_ref_type, source_ref_id, evidence_role,
            exact_text, content_hash, locator_json
       FROM (
         SELECT e.session_id,
                sr.source_ref_type,
                sr.source_ref_id,
                sr.evidence_role,
                sr.exact_text,
                sr.content_hash,
                sr.locator_json,
                ROW_NUMBER() OVER (
                  PARTITION BY e.session_id
                  ORDER BY e.sequence DESC, sr.created_at DESC, sr.id DESC
                ) AS rn
           FROM assessment_event_source_refs sr
           JOIN assessment_evidence_events e ON e.id = sr.event_id
          WHERE e.session_id IN (${placeholders})
            AND (
              sr.source_ref_type IN (
                'review_challenge_packet',
                'repo_challenge_packet',
                'repo_task_challenge_packet',
                'open_source_challenge_packet',
                'challenge_packet'
              )
              OR sr.evidence_role IN (
                'selected_review_challenge',
                'assigned_challenge',
                'challenge_packet'
              )
            )
       )
      WHERE rn = 1`,
  ).bind(...sessionIds).all<{
    session_id: string;
    source_ref_type: string;
    source_ref_id: string;
    evidence_role: string;
    exact_text: string | null;
    content_hash: string | null;
    locator_json: string | null;
  }>();
  const refs = new Map<string, ScheduledAssessmentListChallenge>();
  for (const row of result.results ?? []) {
    const parsedLocator = parseScheduledAssessmentLocator(row.locator_json);
    refs.set(row.session_id, {
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
      evidenceRole: row.evidence_role,
      exactText: row.exact_text ?? '',
      contentHash: row.content_hash ?? '',
      locator: parsedLocator.value as JsonObject,
      hasInvalidLocatorJson: parsedLocator.invalid,
    });
  }
  return refs;
}

async function loadScheduledAssessmentCommitSubmissions(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListCommit>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT id, session_id, payload_json, occurred_at
       FROM (
         SELECT id, session_id, payload_json, occurred_at,
                ROW_NUMBER() OVER (
                  PARTITION BY session_id
                  ORDER BY sequence DESC, created_at DESC, id DESC
                ) AS rn
           FROM assessment_evidence_events
          WHERE session_id IN (${placeholders})
            AND kind = 'commit_submission'
       )
      WHERE rn = 1`,
  ).bind(...sessionIds).all<{
    id: string;
    session_id: string;
    payload_json: string | null;
    occurred_at: string;
  }>();
  const eventRows = result.results ?? [];
  const submissionSourceByEventId = await loadScheduledAssessmentCommitSources(
    db,
    eventRows.map((row) => row.id),
  );
  const commits = new Map<string, ScheduledAssessmentListCommit>();
  for (const row of eventRows) {
    const payload = parseJsonObject(row.payload_json);
    const submissionSource = submissionSourceByEventId.get(row.id) ?? 'unknown';
    const repositoryUrl = optionalString(payload.repositoryUrl) ?? null;
    const baseCommitSha = optionalString(payload.baseCommitSha) ?? null;
    commits.set(row.session_id, {
      eventId: row.id,
      repositoryUrl,
      forkRepositoryUrl: optionalString(payload.forkRepositoryUrl) ?? null,
      branchName: optionalString(payload.branchName) ?? null,
      baseCommitSha,
      commitSha: optionalString(payload.commitSha) ?? null,
      commitUrl: optionalString(payload.commitUrl) ?? null,
      upstreamPullRequestUrl: optionalString(payload.upstreamPullRequestUrl) ?? null,
      upstreamPrConsent: payload.upstreamPrConsent === true,
      submissionSource,
      submissionSourceLabel: scheduledAssessmentCommitSubmissionSourceLabel(submissionSource),
      integrity: scheduledAssessmentCommitIntegrity(submissionSource),
      challengeBinding: {
        status: 'missing_challenge_packet',
        label: 'No assigned challenge binding',
        detail: 'The commit exists, but no assigned challenge packet is attached to prove what task it answers.',
        tone: 'warning',
      },
      changedFiles: Array.isArray(payload.changedFiles) ? payload.changedFiles : [],
      occurredAt: row.occurred_at,
    });
  }
  return commits;
}

async function loadScheduledAssessmentCommitSources(
  db: D1Database,
  eventIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListCommit['submissionSource']>> {
  const sourceByEventId = new Map<string, ScheduledAssessmentListCommit['submissionSource']>();
  if (eventIds.length === 0) return sourceByEventId;
  const placeholders = scheduledAssessmentPlaceholders(eventIds.length);
  const result = await db.prepare(
    `SELECT event_id, metadata_json
       FROM assessment_event_source_refs
      WHERE event_id IN (${placeholders})`,
  ).bind(...eventIds).all<{ event_id: string; metadata_json: string | null }>();
  const valuesByEventId = new Map<string, Set<string>>();
  for (const row of result.results ?? []) {
    const metadata = parseJsonObject(row.metadata_json);
    const source = optionalString(metadata.source);
    if (!source) continue;
    const values = valuesByEventId.get(row.event_id) ?? new Set<string>();
    values.add(source);
    valuesByEventId.set(row.event_id, values);
  }
  for (const eventId of eventIds) {
    const values = valuesByEventId.get(eventId) ?? new Set<string>();
    const hasWorkspaceFinalizer = values.has('agent_bridge_workspace_finalize');
    const hasManualPanel = values.has('assessment_commit_submission_panel');
    if (hasWorkspaceFinalizer && hasManualPanel) {
      sourceByEventId.set(eventId, 'mixed');
    } else if (hasWorkspaceFinalizer) {
      sourceByEventId.set(eventId, 'live_workspace');
    } else if (hasManualPanel) {
      sourceByEventId.set(eventId, 'manual_fallback');
    } else {
      sourceByEventId.set(eventId, 'unknown');
    }
  }
  return sourceByEventId;
}

async function loadScheduledAssessmentEvaluations(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListEvaluation>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT id, session_id, status, summary, output_json, created_at
       FROM (
         SELECT id, session_id, status, summary, output_json, created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY session_id
                  ORDER BY created_at DESC, id DESC
                ) AS rn
           FROM assessment_evaluation_reports
          WHERE session_id IN (${placeholders})
       )
      WHERE rn = 1`,
  ).bind(...sessionIds).all<{
    id: string;
    session_id: string;
    status: string;
    summary: string;
    output_json: string | null;
    created_at: string;
  }>();
  const evaluations = new Map<string, ScheduledAssessmentListEvaluation>();
  for (const row of result.results ?? []) {
    const output = parseJsonObject(row.output_json);
    evaluations.set(row.session_id, {
      id: row.id,
      status: row.status as ScheduledAssessmentListEvaluation['status'],
      summary: row.summary,
      recommendation: optionalString(output.recommendation) ?? null,
      createdAt: row.created_at,
      evidenceCoverage: scheduledAssessmentEvidenceCoverage(output),
      claims: [],
      diagnostics: [],
      reviewPacket: scheduledAssessmentReviewPacket(output),
    });
  }
  const reportIds = [...evaluations.values()].map((evaluation) => evaluation.id);
  if (reportIds.length === 0) return evaluations;

  const [
    claimsByReportId,
    diagnosticsByReportId,
  ] = await Promise.all([
    loadScheduledAssessmentEvaluationClaims(db, reportIds),
    loadScheduledAssessmentEvaluationDiagnostics(db, reportIds),
  ]);

  for (const [sessionId, evaluation] of evaluations) {
    evaluations.set(sessionId, {
      ...evaluation,
      claims: claimsByReportId.get(evaluation.id) ?? [],
      diagnostics: diagnosticsByReportId.get(evaluation.id) ?? [],
    });
  }
  return evaluations;
}

async function loadScheduledAssessmentEvaluationClaims(
  db: D1Database,
  reportIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListEvaluationClaim[]>> {
  const placeholders = scheduledAssessmentPlaceholders(reportIds.length);
  const result = await db.prepare(
    `SELECT id, report_id, polarity, dimension, narrative, confidence,
            source_ref_count, source_ref_types
       FROM (
         SELECT c.id,
                c.report_id,
                c.polarity,
                c.dimension,
                c.narrative,
                c.confidence,
                COUNT(sr.id) AS source_ref_count,
                GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types,
                ROW_NUMBER() OVER (
                  PARTITION BY c.report_id
                  ORDER BY
                    CASE c.polarity
                      WHEN 'positive' THEN 0
                      WHEN 'negative' THEN 1
                      WHEN 'neutral' THEN 2
                      ELSE 3
                    END,
                    c.created_at,
                    c.id
                ) AS rn
           FROM assessment_evaluation_claims c
           LEFT JOIN assessment_claim_source_refs sr ON sr.claim_id = c.id
          WHERE c.report_id IN (${placeholders})
          GROUP BY c.id, c.report_id, c.polarity, c.dimension, c.narrative, c.confidence, c.created_at
         HAVING COUNT(sr.id) > 0
       )
      WHERE rn <= 3
      ORDER BY report_id, rn`,
  ).bind(...reportIds).all<{
    id: string;
    report_id: string;
    polarity: ScheduledAssessmentListEvaluationClaim['polarity'];
    dimension: string;
    narrative: string;
    confidence: number | null;
    source_ref_count: number;
    source_ref_types: string | null;
  }>();
  const byReportId = new Map<string, ScheduledAssessmentListEvaluationClaim[]>();
  for (const row of result.results ?? []) {
    const claims = byReportId.get(row.report_id) ?? [];
    claims.push({
      id: row.id,
      polarity: row.polarity,
      dimension: row.dimension,
      narrative: row.narrative,
      confidence: row.confidence,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean)
        : [],
    });
    byReportId.set(row.report_id, claims);
  }
  return byReportId;
}

async function loadScheduledAssessmentEvaluationDiagnostics(
  db: D1Database,
  reportIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListEvaluationDiagnostic[]>> {
  const placeholders = scheduledAssessmentPlaceholders(reportIds.length);
  const result = await db.prepare(
    `SELECT id, report_id, code, severity, message, source_ref_count, source_ref_types
       FROM (
         SELECT d.id,
                d.report_id,
                d.code,
                d.severity,
                d.message,
                COUNT(sr.id) AS source_ref_count,
                GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types,
                ROW_NUMBER() OVER (
                  PARTITION BY d.report_id
                  ORDER BY
                    CASE d.severity
                      WHEN 'blocking' THEN 0
                      WHEN 'error' THEN 1
                      WHEN 'warning' THEN 2
                      WHEN 'info' THEN 3
                      ELSE 4
                    END,
                    d.created_at,
                    d.id
                ) AS rn
           FROM assessment_diagnostics d
           LEFT JOIN assessment_diagnostic_source_refs sr ON sr.diagnostic_id = d.id
          WHERE d.report_id IN (${placeholders})
          GROUP BY d.id, d.report_id, d.code, d.severity, d.message, d.created_at
       )
      WHERE rn <= 4
      ORDER BY report_id, rn`,
  ).bind(...reportIds).all<{
    id: string;
    report_id: string;
    code: string;
    severity: string;
    message: string;
    source_ref_count: number;
    source_ref_types: string | null;
  }>();
  const byReportId = new Map<string, ScheduledAssessmentListEvaluationDiagnostic[]>();
  for (const row of result.results ?? []) {
    if (!row.report_id) continue;
    const diagnostics = byReportId.get(row.report_id) ?? [];
    diagnostics.push({
      id: row.id,
      code: row.code,
      severity: row.severity,
      message: row.message,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean)
        : [],
    });
    byReportId.set(row.report_id, diagnostics);
  }
  return byReportId;
}

async function loadScheduledAssessmentHumanDecisions(
  db: D1Database,
  sessionIds: readonly string[],
): Promise<Map<string, ScheduledAssessmentListHumanDecision>> {
  const placeholders = scheduledAssessmentPlaceholders(sessionIds.length);
  const result = await db.prepare(
    `SELECT id, session_id, actor_id, narrative, payload_json, occurred_at,
            source_ref_count, source_ref_types
       FROM (
         SELECT e.id,
                e.session_id,
                e.actor_id,
                e.narrative,
                e.payload_json,
                e.occurred_at,
                e.sequence,
                COUNT(sr.id) AS source_ref_count,
                GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types,
                ROW_NUMBER() OVER (
                  PARTITION BY e.session_id
                  ORDER BY e.sequence DESC, e.created_at DESC, e.id DESC
                ) AS rn
           FROM assessment_evidence_events e
           LEFT JOIN assessment_event_source_refs sr ON sr.event_id = e.id
          WHERE e.session_id IN (${placeholders})
            AND e.kind = 'human_assessment_decision'
          GROUP BY e.id, e.session_id, e.actor_id, e.narrative, e.payload_json, e.occurred_at, e.sequence
       )
      WHERE rn = 1`,
  ).bind(...sessionIds).all<{
    id: string;
    session_id: string;
    actor_id: string | null;
    narrative: string;
    payload_json: string | null;
    occurred_at: string;
    source_ref_count: number;
    source_ref_types: string | null;
  }>();
  const decisions = new Map<string, ScheduledAssessmentListHumanDecision>();
  for (const row of result.results ?? []) {
    const payload = parseJsonObject(row.payload_json);
    const decision = optionalString(payload.decision);
    if (!scheduledAssessmentHumanDecisionValues.has(decision ?? '')) continue;
    decisions.set(row.session_id, {
      eventId: row.id,
      decision: decision as ScheduledAssessmentListHumanDecision['decision'],
      reviewerId: row.actor_id,
      summary: row.narrative,
      notes: optionalString(payload.notes) ?? null,
      occurredAt: row.occurred_at,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean).sort()
        : [],
    });
  }
  return decisions;
}

const scheduledAssessmentHumanDecisionValues = new Set<string>([
  'advance',
  'hold',
  'reject',
  'needs_more_evidence',
]);

function buildScheduledAssessmentListProgress(input: {
  session: ScheduledAssessmentListSession;
  evidenceCounts: ScheduledAssessmentListCount[];
  sourceRefCounts: ScheduledAssessmentListCount[];
  latestEvent: ScheduledAssessmentListLatestEvent | null;
  challenge: ScheduledAssessmentListChallenge | null;
  commit: ScheduledAssessmentListCommit | null;
  evaluation: ScheduledAssessmentListEvaluation | null;
  humanDecision: ScheduledAssessmentListHumanDecision | null;
}): AssessmentProgressSnapshot {
  const challenge = input.challenge ? stripScheduledAssessmentChallengeMeta(input.challenge) : null;
  const contract = scheduledAssessmentChallengePacketContract(challenge);
  const commit = input.commit
    ? {
        ...input.commit,
        challengeBinding: scheduledAssessmentCommitChallengeBinding({
          commitRepositoryUrl: input.commit.repositoryUrl,
          commitBaseCommitSha: input.commit.baseCommitSha,
          challenge,
        }),
      }
    : null;
  const hasWorkEvidence = scheduledAssessmentHasKind(input.evidenceCounts, [
    'terminal_output',
    'test_run',
    'code_diff',
    'ai_interaction',
    'tool_usage',
    'transcript_span',
    'dev_container_event',
    'message',
    'commit_submission',
  ]) || scheduledAssessmentHasKind(input.sourceRefCounts, SCHEDULED_ASSESSMENT_TRANSCRIPT_SOURCE_REF_TYPES);
  const hasCommitSubmission = commit !== null;
  const hasFinalSubmission = scheduledAssessmentHasKind(input.evidenceCounts, ['final_submission']);
  const hasAiInteraction = scheduledAssessmentHasKind(input.evidenceCounts, ['ai_interaction'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, [
      'ai_user_prompt',
      'ai_user_prompt_blocked',
      'ai_agent_response',
    ]);
  const hasMessageEvidence = scheduledAssessmentHasKind(input.evidenceCounts, ['message'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, ['room_chat_message']);
  const hasDevContainerEvidence = scheduledAssessmentHasKind(input.evidenceCounts, ['dev_container_event'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, [
      'dev_container_workspace_launch',
      'dev_container_workspace_stop',
      'dev_container_workspace_state',
      'code_server_file_observation',
      'code_server_editor_open',
    ]);
  const hasToolUsageEvidence = scheduledAssessmentHasKind(input.evidenceCounts, ['tool_usage'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, SCHEDULED_ASSESSMENT_TOOL_ACTIVITY_SOURCE_REF_TYPES);
  const hasTranscriptEvidence = scheduledAssessmentHasKind(input.evidenceCounts, ['transcript_span'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, SCHEDULED_ASSESSMENT_TRANSCRIPT_SOURCE_REF_TYPES);
  const hasTestEvidence = scheduledAssessmentHasKind(input.evidenceCounts, ['test_run'])
    || scheduledAssessmentHasKind(input.sourceRefCounts, ['test_run']);
  const hasVerificationGap = scheduledAssessmentHasKind(input.sourceRefCounts, ['verification_gap']);
  const requiresCommit = scheduledAssessmentModeRequiresCommit(input.session.mode);
  const hasGitCommit = scheduledAssessmentHasKind(input.sourceRefCounts, ['git_commit']);
  const hasCodeDiff = scheduledAssessmentHasKind(input.sourceRefCounts, ['code_diff']);
  const hasReviewableCommitSubmission = !requiresCommit
    || Boolean(
      commit
      && hasGitCommit
      && hasCodeDiff
      && commit.challengeBinding.status === 'bound_to_assigned_challenge',
    );
  const { stage, nextAction } = scheduledAssessmentProgressStageAndAction({
    session: input.session,
    hasCompleteChallengePacket: contract.isComplete,
    hasWorkEvidence,
    hasCommitSubmission,
    hasReviewableCommitSubmission,
    hasFinalSubmission,
    evaluation: input.evaluation,
    humanDecision: input.humanDecision,
  });

  return {
    session: input.session,
    stage,
    nextAction,
    nextActionLabel: scheduledAssessmentProgressNextActionLabel(nextAction),
    assignmentTrust: scheduledAssessmentAssignmentTrust({
      challenge,
    }),
    readiness: scheduledAssessmentReadiness({
      session: input.session,
      stage,
      challengePacketContract: contract,
      hasWorkEvidence,
      hasMessageEvidence,
      hasDevContainerEvidence,
      hasToolUsageEvidence,
      hasCommitSubmission,
      hasFinalSubmission,
      hasAiInteraction,
      hasTranscriptEvidence,
      hasTestEvidence,
      hasVerificationGap,
      sourceRefCounts: input.sourceRefCounts,
      commit,
      evaluation: input.evaluation,
      humanDecision: input.humanDecision,
    }),
    hasChallengePacket: challenge !== null,
    hasWorkEvidence,
    hasMessageEvidence,
    hasDevContainerEvidence,
    hasToolUsageEvidence,
    hasCommitSubmission,
    hasFinalSubmission,
    hasAiInteraction,
    hasTranscriptEvidence,
    hasTestEvidence,
    hasVerificationGap,
    evidenceCounts: input.evidenceCounts,
    sourceRefCounts: input.sourceRefCounts,
    evidenceSnippets: [],
    challenge,
    challengePacketContract: contract,
    latestEvent: input.latestEvent,
    commit,
    evaluation: input.evaluation,
    humanDecision: input.humanDecision,
  };
}

function stripScheduledAssessmentChallengeMeta(
  challenge: ScheduledAssessmentListChallenge,
): NonNullable<AssessmentProgressSnapshot['challenge']> {
  return {
    sourceRefType: challenge.sourceRefType,
    sourceRefId: challenge.sourceRefId,
    evidenceRole: challenge.evidenceRole,
    exactText: challenge.exactText,
    contentHash: challenge.contentHash,
    locator: challenge.locator,
  };
}

function slimScheduledAssessmentListProgress(
  progress: AssessmentProgressSnapshot,
): ScheduledAssessmentListProgressSnapshot {
  if (!progress.challenge) {
    return {
      ...progress,
      challenge: null,
    };
  }

  return {
    ...progress,
    challenge: {
      ...progress.challenge,
      exactText: null,
      summary: scheduledAssessmentChallengeSummary(progress.challenge),
    },
  };
}

function scheduledAssessmentChallengeSummary(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']>,
): ScheduledAssessmentChallengeSummary {
  return {
    repositoryUrl: scheduledAssessmentChallengeRepositoryUrl(challenge),
    githubPrNumber: scheduledAssessmentChallengePrNumber(challenge),
    pullRequestUrl: scheduledAssessmentChallengePullRequestUrl(challenge),
    baseCommitSha: scheduledAssessmentChallengeBaseCommitSha(challenge),
    task: scheduledAssessmentChallengeLineValue(challenge.exactText, ['Task', 'Title']),
    assessmentFit: scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Assessment fit']),
    matchProof: scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Match proof']),
    successCriteria: [
      ...scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Success criteria']),
      ...(scheduledAssessmentChallengeLineValue(challenge.exactText, ['Success'])
        ? [scheduledAssessmentChallengeLineValue(challenge.exactText, ['Success']) as string]
        : []),
    ],
    expectedEvidence: scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Expected evidence']),
  };
}

function scheduledAssessmentHasKind(
  counts: readonly ScheduledAssessmentListCount[],
  kinds: readonly string[],
): boolean {
  return counts.some((count) => kinds.includes(count.kind) && count.count > 0);
}

function scheduledAssessmentModeRequiresCommit(mode: string): boolean {
  return mode === 'OPEN_SOURCE_BUG_FIX'
    || mode === 'DEV_CONTAINER_REPO_TASK'
    || mode === 'DEV_CONTAINER_CHALLENGE';
}

function scheduledAssessmentProgressStageAndAction(input: {
  session: ScheduledAssessmentListSession;
  hasCompleteChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasReviewableCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  evaluation: ScheduledAssessmentListEvaluation | null;
  humanDecision: ScheduledAssessmentListHumanDecision | null;
}): { stage: ScheduledAssessmentListStage; nextAction: ScheduledAssessmentListNextAction } {
  if (input.session.state === 'CANCELLED') return { stage: 'CANCELLED', nextAction: 'NONE' };
  if (input.humanDecision) return { stage: 'EVALUATED', nextAction: 'NONE' };
  if (input.evaluation?.status === 'EVALUATED') return { stage: 'EVALUATED', nextAction: 'REVIEW_EVALUATION' };
  if (input.session.state === 'DIAGNOSTIC') return { stage: 'NEEDS_ATTENTION', nextAction: 'RESOLVE_DIAGNOSTIC' };
  if (input.evaluation) {
    return { stage: 'NEEDS_ATTENTION', nextAction: 'RESOLVE_DIAGNOSTIC' };
  }
  if (input.session.state === 'EVALUATING') return { stage: 'EVALUATING', nextAction: 'WAIT_FOR_EVALUATION' };
  if (!input.hasCompleteChallengePacket) return { stage: 'WAITING_FOR_CHALLENGE', nextAction: 'ASSIGN_CHALLENGE' };
  if (scheduledAssessmentModeRequiresCommit(input.session.mode) && !input.hasReviewableCommitSubmission) {
    if (input.hasWorkEvidence || input.hasFinalSubmission) return { stage: 'WORK_IN_PROGRESS', nextAction: 'SUBMIT_COMMIT' };
    return { stage: 'CHALLENGE_READY', nextAction: 'OPEN_ROOM_OR_WORKSPACE' };
  }
  if (input.hasCommitSubmission || input.hasFinalSubmission || input.session.state === 'FINAL_SUBMITTED') {
    return { stage: 'READY_FOR_EVALUATION', nextAction: 'START_EVALUATION' };
  }
  if (input.hasWorkEvidence) return { stage: 'WORK_IN_PROGRESS', nextAction: 'CAPTURE_WORK_EVIDENCE' };
  return { stage: 'CHALLENGE_READY', nextAction: 'OPEN_ROOM_OR_WORKSPACE' };
}

function scheduledAssessmentProgressNextActionLabel(action: ScheduledAssessmentListNextAction): string {
  switch (action) {
    case 'ASSIGN_CHALLENGE':
      return 'Assign a concrete repo challenge packet.';
    case 'OPEN_ROOM_OR_WORKSPACE':
      return 'Open the assessment room and start the workspace.';
    case 'CAPTURE_WORK_EVIDENCE':
      return 'Capture terminal, code, transcript, chat, and AI-use evidence.';
    case 'SUBMIT_COMMIT':
      return 'Submit a source-backed assessment commit.';
    case 'START_EVALUATION':
      return 'Start source-backed AI or human evaluation.';
    case 'WAIT_FOR_EVALUATION':
      return 'Source-backed evaluation is running.';
    case 'REVIEW_EVALUATION':
      return 'Review the assessment report and evidence.';
    case 'RESOLVE_DIAGNOSTIC':
      return 'Resolve the blocking diagnostic before continuing.';
    case 'NONE':
      return 'No further assessment action is required.';
  }
}

function scheduledAssessmentReadiness(input: {
  session: ScheduledAssessmentListSession;
  stage: ScheduledAssessmentListStage;
  challengePacketContract: NonNullable<AssessmentProgressSnapshot['challengePacketContract']>;
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
  sourceRefCounts: readonly ScheduledAssessmentListCount[];
  commit: ScheduledAssessmentListCommit | null;
  evaluation: ScheduledAssessmentListEvaluation | null;
  humanDecision: ScheduledAssessmentListHumanDecision | null;
}): NonNullable<AssessmentProgressSnapshot['readiness']> {
  const requiresCommit = scheduledAssessmentModeRequiresCommit(input.session.mode);
  const hasGitCommit = scheduledAssessmentHasKind(input.sourceRefCounts, ['git_commit']);
  const hasCodeDiff = scheduledAssessmentHasKind(input.sourceRefCounts, ['code_diff']);
  const required: NonNullable<AssessmentProgressSnapshot['readiness']>['required'] = [
    {
      id: 'challenge_packet',
      label: 'Complete challenge packet',
      required: true,
      satisfied: input.challengePacketContract.isComplete,
      sourceRefTypes: [
        'review_challenge_packet',
        'open_source_challenge_packet',
        'repo_task_challenge_packet',
        'challenge_packet',
      ],
      missingImpact: input.challengePacketContract.isComplete
        ? 'The assigned task packet is source-backed.'
        : `Challenge packet is missing ${input.challengePacketContract.missingFields.join(', ')}.`,
    },
    {
      id: 'work_evidence',
      label: 'Candidate work evidence',
      required: true,
      satisfied: input.hasWorkEvidence,
      sourceRefTypes: [
        'terminal_output',
        'test_run',
        'code_diff',
        'ai_usage_event',
        'room_chat_message',
        'meeting_transcript_segment',
        'dev_container_workspace_state',
        'code_server_file_observation',
      ],
      missingImpact: 'Without work evidence, the session only proves an assignment existed.',
    },
  ];
  if (requiresCommit) {
    required.push(
      {
        id: 'assessment_commit',
        label: 'Assessment branch commit',
        required: true,
        satisfied: input.hasCommitSubmission && hasGitCommit,
        sourceRefTypes: ['git_commit'],
        missingImpact: 'A real commit hash is required before evaluating open-source implementation work.',
      },
      {
        id: 'code_diff',
        label: 'Exact code diff',
        required: true,
        satisfied: hasCodeDiff,
        sourceRefTypes: ['code_diff'],
        missingImpact: 'The evaluator must inspect the exact diff from base commit to submitted commit.',
      },
    );

    if (input.hasCommitSubmission) {
      required.push({
        id: 'commit_challenge_binding',
        label: 'Commit bound to assigned challenge',
        required: true,
        satisfied: input.commit?.challengeBinding.status === 'bound_to_assigned_challenge',
        sourceRefTypes: [
          'git_commit',
          'code_diff',
          'review_challenge_packet',
          'open_source_challenge_packet',
          'repo_task_challenge_packet',
          'challenge_packet',
        ],
        missingImpact: 'The submitted commit must match the latest assigned challenge repo and base commit before evaluation.',
      });
    }
  }

  const confidence: NonNullable<AssessmentProgressSnapshot['readiness']>['confidence'] = [
    {
      id: 'test_run',
      label: 'Test output',
      required: false,
      satisfied: input.hasTestEvidence,
      sourceRefTypes: ['test_run'],
      missingImpact: input.hasVerificationGap
        ? 'A verification gap was declared, but no test output was captured; keep correctness lower-confidence.'
        : 'Test output improves confidence that the commit was exercised; require tests or a reviewed verification explanation before trusting correctness.',
    },
    ...input.hasVerificationGap
      ? [{
          id: 'verification_gap_declared',
          label: 'Verification gap declared',
          required: false,
          satisfied: true,
          sourceRefTypes: ['verification_gap'],
          missingImpact: 'A source-backed verification gap explains missing or partial test output; it does not prove correctness.',
        } satisfies NonNullable<AssessmentProgressSnapshot['readiness']>['confidence'][number]]
      : [],
    {
      id: 'workspace_captured_commit',
      label: 'Workspace-captured commit',
      required: false,
      satisfied: input.commit?.integrity.status === 'workspace_captured',
      sourceRefTypes: ['git_commit', 'dev_container_workspace_state'],
      missingImpact: 'Workspace capture proves the commit came from the controlled assessment environment.',
    },
    {
      id: 'ai_interaction',
      label: 'AI-use trail',
      required: false,
      satisfied: input.hasAiInteraction,
      sourceRefTypes: ['ai_user_prompt', 'ai_agent_response', 'ai_usage_event'],
      missingImpact: 'AI prompts and responses explain how the candidate used assistance.',
    },
    {
      id: 'transcript_or_chat',
      label: 'Explanation trail',
      required: false,
      satisfied: input.hasTranscriptEvidence || input.hasMessageEvidence,
      sourceRefTypes: ['meeting_transcript_segment', 'transcript_span', 'room_chat_message'],
      missingImpact: 'Transcript or chat evidence helps assess reasoning and communication.',
    },
  ];
  const missingRequiredCount = required.filter((item) => !item.satisfied).length;
  const status = scheduledAssessmentReadinessStatus({
    stage: input.stage,
    missingRequiredCount,
  });
  return {
    status,
    label: scheduledAssessmentReadinessStatusLabel(status),
    detail: scheduledAssessmentReadinessStatusDetail({
      status,
      missingRequiredCount,
      requiresCommit,
      commit: input.commit,
      hasTestEvidence: input.hasTestEvidence,
      hasVerificationGap: input.hasVerificationGap,
      evaluation: input.evaluation,
      humanDecision: input.humanDecision,
    }),
    isReadyForEvaluation: status === 'READY_FOR_EVALUATION',
    isUsableHiringSignal: status === 'EVALUATED' && input.evaluation?.status === 'EVALUATED',
    missingRequiredCount,
    required,
    confidence,
  };
}

function scheduledAssessmentReadinessStatus(input: {
  stage: ScheduledAssessmentListStage;
  missingRequiredCount: number;
}): NonNullable<AssessmentProgressSnapshot['readiness']>['status'] {
  switch (input.stage) {
    case 'WAITING_FOR_CHALLENGE':
      return 'WAITING_FOR_CHALLENGE';
    case 'CHALLENGE_READY':
      return 'READY_TO_START';
    case 'WORK_IN_PROGRESS':
      return 'WORK_IN_PROGRESS';
    case 'READY_FOR_EVALUATION':
      return input.missingRequiredCount > 0 ? 'WORK_IN_PROGRESS' : 'READY_FOR_EVALUATION';
    case 'EVALUATING':
      return 'EVALUATING';
    case 'EVALUATED':
      return 'EVALUATED';
    case 'NEEDS_ATTENTION':
      return 'NEEDS_ATTENTION';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

function scheduledAssessmentReadinessStatusLabel(
  status: NonNullable<AssessmentProgressSnapshot['readiness']>['status'],
): string {
  switch (status) {
    case 'WAITING_FOR_CHALLENGE':
      return 'Waiting for challenge';
    case 'READY_TO_START':
      return 'Ready to start';
    case 'WORK_IN_PROGRESS':
      return 'Work evidence in progress';
    case 'READY_FOR_EVALUATION':
      return 'Ready for evaluation';
    case 'EVALUATING':
      return 'Evaluation running';
    case 'EVALUATED':
      return 'Evaluated';
    case 'NEEDS_ATTENTION':
      return 'Needs attention';
    case 'CANCELLED':
      return 'Cancelled';
  }
}

function scheduledAssessmentReadinessStatusDetail(input: {
  status: NonNullable<AssessmentProgressSnapshot['readiness']>['status'];
  missingRequiredCount: number;
  requiresCommit: boolean;
  commit: ScheduledAssessmentListCommit | null;
  hasTestEvidence: boolean;
  hasVerificationGap: boolean;
  evaluation: ScheduledAssessmentListEvaluation | null;
  humanDecision: ScheduledAssessmentListHumanDecision | null;
}): string {
  if (input.status === 'CANCELLED') return 'This assessment session was cancelled.';
  if (input.status === 'NEEDS_ATTENTION') return 'Resolve the diagnostic before relying on this assessment.';
  if (input.status === 'EVALUATING') return 'PIPE is evaluating the source-backed commit, diff, tests, transcript, chat, terminal, and AI-use evidence.';
  if (input.status === 'EVALUATED') {
    if (input.humanDecision) return 'A human decision is recorded with source-backed evidence.';
    if (input.evaluation?.status === 'EVALUATED') return 'A source-backed evaluation report is available for review.';
    return 'The assessment has a terminal review state.';
  }
  if (input.status === 'WAITING_FOR_CHALLENGE') {
    return 'Assign a concrete repo URL, base commit, task, success criteria, and expected evidence before candidate work starts.';
  }
  if (input.missingRequiredCount > 0) {
    return `${input.missingRequiredCount} required proof ${input.missingRequiredCount === 1 ? 'item is' : 'items are'} still missing before evaluation.`;
  }
  const confidenceLimitations: string[] = [];
  if (input.requiresCommit && input.commit?.integrity.status !== 'workspace_captured') {
    confidenceLimitations.push('commit provenance still needs repository or workspace verification');
  }
  if (!input.hasTestEvidence) {
    confidenceLimitations.push(
      input.hasVerificationGap
        ? 'test output is missing and only a declared verification gap is available'
        : 'test output is missing',
    );
  }
  if (confidenceLimitations.length > 0) {
    return `Required evidence is captured, but ${formatScheduledAssessmentLimitationList(confidenceLimitations)}; start evaluation as lower-confidence and do not treat correctness as proven.`;
  }
  return 'Challenge, work evidence, required source refs, and test output are captured; start source-backed AI or human evaluation.';
}

function formatScheduledAssessmentLimitationList(limitations: readonly string[]): string {
  if (limitations.length <= 1) return limitations[0] ?? '';
  return `${limitations.slice(0, -1).join(', ')} and ${limitations[limitations.length - 1]}`;
}

function scheduledAssessmentAssignmentTrust(input: {
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']> | null;
}): NonNullable<AssessmentProgressSnapshot['assignmentTrust']> {
  if (!input.challenge) {
    return {
      state: 'waiting_for_challenge',
      label: 'No challenge packet',
      detail: 'Assign a concrete repo URL, base commit, task, success criteria, and expected evidence before relying on this assessment.',
      tone: 'blocked',
    };
  }
  const matchedRepoId = input.challenge.locator.matchedRepoId;
  const hasMatchedRepo = typeof matchedRepoId === 'number'
    || (typeof matchedRepoId === 'string' && matchedRepoId.trim().length > 0);
  if (hasMatchedRepo) {
    return {
      state: 'matched_challenge',
      label: 'PIPE-matched challenge',
      detail: MATCHED_ASSESSMENT_ASSIGNMENT_DETAIL,
      tone: 'matched',
    };
  }
  if (input.challenge.sourceRefType === 'open_source_challenge_packet') {
    return {
      state: 'manual_challenge',
      label: 'Manual task assignment',
      detail: 'A recruiter supplied the task packet. Treat candidate work as real evidence, but not as proof that PIPE automatically matched the candidate to this repo.',
      tone: 'manual',
    };
  }
  if (input.challenge.sourceRefType === 'review_challenge_packet') {
    return {
      state: 'source_backed_challenge',
      label: 'Source-backed challenge',
      detail: 'A reviewable challenge packet is captured as source evidence; confirm match proof before treating assignment fit as automatic.',
      tone: 'neutral',
    };
  }
  return {
    state: 'source_backed_challenge',
    label: 'Source-backed task',
    detail: 'The assigned task packet is captured as immutable source evidence.',
    tone: 'neutral',
  };
}

function scheduledAssessmentCommitSubmissionSourceLabel(
  source: ScheduledAssessmentListCommit['submissionSource'],
): string {
  switch (source) {
    case 'live_workspace':
      return 'Live workspace finalizer';
    case 'manual_fallback':
      return 'Manual evidence fallback';
    case 'mixed':
      return 'Mixed source refs';
    case 'unknown':
    default:
      return 'Unknown capture source';
  }
}

function scheduledAssessmentCommitIntegrity(
  source: ScheduledAssessmentListCommit['submissionSource'],
): ScheduledAssessmentListCommit['integrity'] {
  switch (source) {
    case 'live_workspace':
      return {
        status: 'workspace_captured',
        label: 'Workspace-captured commit',
        detail: 'Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.',
        tone: 'verified',
      };
    case 'manual_fallback':
      return {
        status: 'manual_needs_verification',
        label: 'Manual commit evidence',
        detail: 'Candidate-entered commit evidence passed source-ref validation, but still needs repository verification before final reliance.',
        tone: 'warning',
      };
    case 'mixed':
      return {
        status: 'mixed_needs_review',
        label: 'Mixed commit evidence',
        detail: 'Commit evidence combines live workspace and manual source refs; review the audit trail before relying on it.',
        tone: 'warning',
      };
    case 'unknown':
    default:
      return {
        status: 'unknown_needs_review',
        label: 'Unknown commit capture',
        detail: 'Commit evidence passed structural validation, but its capture source was not identified.',
        tone: 'neutral',
      };
  }
}

function scheduledAssessmentCommitChallengeBinding(input: {
  commitRepositoryUrl: string | null;
  commitBaseCommitSha: string | null;
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']> | null;
}): ScheduledAssessmentListCommit['challengeBinding'] {
  if (!input.challenge) {
    return {
      status: 'missing_challenge_packet',
      label: 'No assigned challenge binding',
      detail: 'The commit exists, but no assigned challenge packet is attached to prove what task it answers.',
      tone: 'warning',
    };
  }
  const assignedRepositoryUrl = scheduledAssessmentChallengeRepositoryUrl(input.challenge);
  const assignedBaseCommitSha = scheduledAssessmentChallengeBaseCommitSha(input.challenge);
  if (!assignedRepositoryUrl || !assignedBaseCommitSha) {
    return {
      status: 'challenge_packet_missing_anchor',
      label: 'Challenge binding incomplete',
      detail: 'The assigned challenge packet is missing a repo URL or base commit anchor, so PIPE cannot prove this commit answers the exact task.',
      tone: 'warning',
    };
  }
  if (!input.commitRepositoryUrl || !input.commitBaseCommitSha) {
    return {
      status: 'commit_missing_anchor',
      label: 'Commit binding incomplete',
      detail: 'The submitted commit is missing the repository or base commit anchor needed to compare it with the assigned challenge.',
      tone: 'warning',
    };
  }
  const normalizedAssignedRepositoryUrl = normalizeScheduledAssessmentGitHubRepositoryUrl(assignedRepositoryUrl);
  const normalizedCommitRepositoryUrl = normalizeScheduledAssessmentGitHubRepositoryUrl(input.commitRepositoryUrl);
  if (!normalizedAssignedRepositoryUrl || !normalizedCommitRepositoryUrl) {
    return {
      status: 'challenge_packet_missing_anchor',
      label: 'Challenge binding incomplete',
      detail: 'PIPE could not normalize the assigned challenge repository URL or submitted repository URL for binding proof.',
      tone: 'warning',
    };
  }
  if (
    normalizedAssignedRepositoryUrl !== normalizedCommitRepositoryUrl
    || assignedBaseCommitSha.toLowerCase() !== input.commitBaseCommitSha.toLowerCase()
  ) {
    return {
      status: 'challenge_binding_mismatch',
      label: 'Challenge binding mismatch',
      detail: 'Submitted repository or base commit does not match the assigned source-backed challenge packet.',
      tone: 'warning',
    };
  }
  return {
    status: 'bound_to_assigned_challenge',
    label: 'Bound to assigned challenge',
    detail: 'Submitted repository and base commit match the assigned source-backed challenge packet.',
    tone: 'verified',
  };
}

function scheduledAssessmentChallengePacketContract(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']> | null,
): NonNullable<AssessmentProgressSnapshot['challengePacketContract']> {
  if (!challenge) {
    return {
      schemaVersion: 'challenge-packet-contract-v1',
      isComplete: false,
      missingFields: ['repo URL', 'base commit SHA', 'task', 'success criteria', 'expected evidence'],
      hasRepositoryUrl: false,
      hasBaseCommitSha: false,
      hasTask: false,
      hasSuccessCriteria: false,
      hasExpectedEvidence: false,
    };
  }
  const repositoryUrl = scheduledAssessmentChallengeRepositoryUrl(challenge);
  const baseCommitSha = scheduledAssessmentChallengeBaseCommitSha(challenge);
  const task = scheduledAssessmentChallengeLineValue(challenge.exactText, ['Task', 'Title']);
  const successCriteria = [
    ...scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Success criteria']),
    ...(scheduledAssessmentChallengeLineValue(challenge.exactText, ['Success'])
      ? [scheduledAssessmentChallengeLineValue(challenge.exactText, ['Success']) as string]
      : []),
  ];
  const expectedEvidence = scheduledAssessmentChallengeSectionItems(challenge.exactText, ['Expected evidence']);
  const contract = {
    schemaVersion: 'challenge-packet-contract-v1' as const,
    isComplete: false,
    missingFields: [] as string[],
    hasRepositoryUrl: Boolean(repositoryUrl && normalizeScheduledAssessmentGitHubRepositoryUrl(repositoryUrl)),
    hasBaseCommitSha: Boolean(baseCommitSha && /^[0-9a-f]{40}$/i.test(baseCommitSha)),
    hasTask: Boolean(task),
    hasSuccessCriteria: successCriteria.length > 0,
    hasExpectedEvidence: expectedEvidence.length > 0,
  };
  if (!contract.hasRepositoryUrl) contract.missingFields.push('repo URL');
  if (!contract.hasBaseCommitSha) contract.missingFields.push('base commit SHA');
  if (!contract.hasTask) contract.missingFields.push('task');
  if (!contract.hasSuccessCriteria) contract.missingFields.push('success criteria');
  if (!contract.hasExpectedEvidence) contract.missingFields.push('expected evidence');
  contract.isComplete = contract.missingFields.length === 0;
  return contract;
}

function scheduledAssessmentChallengeRepositoryUrl(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']>,
): string | null {
  return scheduledAssessmentLocatorString(challenge.locator, 'repositoryUrl')
    ?? scheduledAssessmentLocatorString(challenge.locator, 'githubRepoUrl')
    ?? scheduledAssessmentLocatorString(challenge.locator, 'repoUrl')
    ?? scheduledAssessmentChallengeLineValue(challenge.exactText, ['Repo', 'Repository']);
}

function scheduledAssessmentChallengeBaseCommitSha(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']>,
): string | null {
  return scheduledAssessmentLocatorString(challenge.locator, 'baseCommitSha')
    ?? scheduledAssessmentLocatorString(challenge.locator, 'baseCommit')
    ?? scheduledAssessmentChallengeLineValue(challenge.exactText, ['Base commit', 'Base commit SHA', 'Base']);
}

function scheduledAssessmentChallengePrNumber(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']>,
): number | null {
  return scheduledAssessmentLocatorNumber(challenge.locator, 'githubPrNumber')
    ?? scheduledAssessmentLocatorNumber(challenge.locator, 'prNumber')
    ?? scheduledAssessmentLocatorNumber(challenge.locator, 'pullRequestNumber')
    ?? scheduledAssessmentChallengeLineNumber(challenge.exactText, ['Pull request', 'PR']);
}

function scheduledAssessmentChallengePullRequestUrl(
  challenge: NonNullable<AssessmentProgressSnapshot['challenge']>,
): string | null {
  const explicitUrl = normalizeScheduledAssessmentGitHubPullRequestUrl(
    scheduledAssessmentLocatorString(challenge.locator, 'pullRequestUrl')
      ?? scheduledAssessmentLocatorString(challenge.locator, 'githubPullRequestUrl')
      ?? scheduledAssessmentLocatorString(challenge.locator, 'prUrl')
      ?? scheduledAssessmentChallengeLineValue(challenge.exactText, ['Pull request URL', 'PR URL']),
  );
  if (explicitUrl) return explicitUrl;

  const repositoryUrl = scheduledAssessmentChallengeRepositoryUrl(challenge);
  const githubPrNumber = scheduledAssessmentChallengePrNumber(challenge);
  if (!repositoryUrl || !githubPrNumber) return null;
  try {
    const url = new URL(repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/pull/${githubPrNumber}`;
  } catch {
    return null;
  }
}

function normalizeScheduledAssessmentGitHubPullRequestUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'pull') return null;
    const prNumber = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/pull/${prNumber}`;
  } catch {
    return null;
  }
}

function scheduledAssessmentLocatorString(locator: Record<string, unknown>, key: string): string | null {
  return optionalString(locator[key]) ?? null;
}

function scheduledAssessmentLocatorNumber(locator: Record<string, unknown>, key: string): number | null {
  const value = locator[key];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim().replace(/^#/, ''), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function scheduledAssessmentChallengeLineValue(exactText: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = exactText.match(new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || null;
}

function scheduledAssessmentChallengeLineNumber(exactText: string, labels: readonly string[]): number | null {
  const value = scheduledAssessmentChallengeLineValue(exactText, labels);
  if (!value) return null;
  const parsed = Number.parseInt(value.trim().replace(/^#/, ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function scheduledAssessmentChallengeSectionItems(exactText: string, labels: readonly string[]): string[] {
  const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()));
  const lines = exactText.split(/\r?\n/);
  const items: string[] = [];
  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^([A-Za-z][A-Za-z\s-]{2,})\s*:\s*$/);
    if (heading?.[1]) {
      inSection = normalizedLabels.has(heading[1].trim().toLowerCase());
      continue;
    }
    if (!inSection) continue;
    if (/^[A-Za-z][A-Za-z\s-]{2,}\s*:/.test(line) && !/^[-*]|\d+[.)]/.test(line)) {
      inSection = false;
      continue;
    }
    const item = line
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (item) items.push(item);
  }
  return items;
}

function normalizeScheduledAssessmentGitHubRepositoryUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return null;
    const owner = segments[0];
    const repoWithSuffix = segments[1];
    if (!owner || !repoWithSuffix) return null;
    const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
    if (!owner || !repo) return null;
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

function parseScheduledAssessmentLocator(value: string | null): {
  value: Record<string, unknown>;
  invalid: boolean;
} {
  if (!value || value.trim().length === 0) return { value: {}, invalid: false };
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed)
      ? { value: parsed, invalid: false }
      : { value: {}, invalid: true };
  } catch {
    return { value: {}, invalid: true };
  }
}

async function loadScheduledAssessmentSessionId(
  db: D1Database,
  interviewId: string,
): Promise<string | null> {
  if (!await hasScheduledAssessmentProgressSchema(db)) return null;

  const row = await db.prepare(
    `SELECT id
       FROM assessment_sessions
      WHERE interview_id = ?1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
  ).bind(interviewId).first<{ id: string }>();
  return row?.id ?? null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadLatestAssessmentEvaluationReport(
  db: D1Database,
  sessionId: string,
): Promise<{ id: string; status: string; summary: string } | null> {
  const row = await db.prepare(
    `SELECT id, status, summary
       FROM assessment_evaluation_reports
      WHERE session_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(sessionId).first<{ id: string; status: string; summary: string }>();
  return row ?? null;
}

interface AssessmentEvidenceBundleSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId: string | null;
  evidenceRole: string;
  locator: JsonObject;
  exactText: string;
  contentHash: string;
  metadata: JsonObject;
  createdAt: string;
}

interface AssessmentEvidenceBundleEvent {
  sequence: number;
  kind: string;
  actorType: string;
  actorId: string | null;
  narrative: string;
  payload: JsonObject;
  occurredAt: string;
  createdAt: string;
  sourceRefs: AssessmentEvidenceBundleSourceRef[];
}

interface AssessmentEvidenceBundleClaim {
  claimId: string;
  polarity: string;
  dimension: string;
  narrative: string;
  confidence: number | null;
  createdAt: string;
  sourceRefs: AssessmentEvidenceBundleSourceRef[];
}

interface AssessmentEvidenceBundleDiagnostic {
  diagnosticId: string;
  code: string;
  severity: string;
  message: string;
  provider: string | null;
  retryable: boolean;
  details: JsonObject;
  createdAt: string;
  sourceRefs: AssessmentEvidenceBundleSourceRef[];
}

interface AssessmentEvidenceBundleEvaluationReport {
  reportId: string;
  status: string;
  summary: string;
  output: JsonObject;
  createdAt: string;
  updatedAt: string;
  claims: AssessmentEvidenceBundleClaim[];
  diagnostics: AssessmentEvidenceBundleDiagnostic[];
}

interface AssessmentEvidenceBundle {
  schemaVersion: 'repo-task-final-evidence-bundle-v1';
  generatedAt: string;
  interview: {
    id: string;
    title: string | null;
    description: string | null;
    interviewType: string | null;
    recipientName: string | null;
    recipientEmail: string | null;
    candidateId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  assessment: {
    mode: string;
    state: string;
    stage: string;
    nextAction: string;
    nextActionLabel: string;
    readiness: AssessmentProgressSnapshot['readiness'];
    assignmentTrust: AssessmentProgressSnapshot['assignmentTrust'];
    sourceRefCounts: AssessmentProgressSnapshot['sourceRefCounts'];
    evidenceCounts: AssessmentProgressSnapshot['evidenceCounts'];
  };
  completeness: {
    hasChallengePacket: boolean;
    hasCommitSubmission: boolean;
    hasEvaluationReport: boolean;
    hasHumanDecision: boolean;
    isReviewable: boolean;
  };
  challenge: AssessmentProgressSnapshot['challenge'];
  challengePacketContract: AssessmentProgressSnapshot['challengePacketContract'];
  submission: AssessmentProgressSnapshot['commit'];
  timeline: AssessmentEvidenceBundleEvent[];
  evaluation: AssessmentEvidenceBundleEvaluationReport | null;
  humanDecision: AssessmentProgressSnapshot['humanDecision'];
}

interface AssessmentEvidenceBundleSourceRefRow {
  source_ref_type: string | null;
  source_ref_id: string | null;
  source_span_id: string | null;
  evidence_role: string | null;
  locator_json: string | null;
  exact_text: string | null;
  content_hash: string | null;
  metadata_json: string | null;
  source_created_at: string | null;
}

function assessmentBundleSourceRefFromRow(
  row: AssessmentEvidenceBundleSourceRefRow,
): AssessmentEvidenceBundleSourceRef | null {
  if (!row.source_ref_type || !row.source_ref_id || !row.exact_text || !row.content_hash) {
    return null;
  }
  return {
    sourceRefType: row.source_ref_type,
    sourceRefId: row.source_ref_id,
    sourceSpanId: row.source_span_id ?? null,
    evidenceRole: row.evidence_role ?? 'support',
    locator: parseJsonObject(row.locator_json) as JsonObject,
    exactText: row.exact_text,
    contentHash: row.content_hash,
    metadata: parseJsonObject(row.metadata_json) as JsonObject,
    createdAt: row.source_created_at ?? '',
  };
}

async function loadAssessmentEvidenceBundleTimeline(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentEvidenceBundleEvent[]> {
  const result = await db.prepare(
    `SELECT e.id AS event_id,
            e.sequence,
            e.kind,
            e.actor_type,
            e.actor_id,
            e.narrative,
            e.payload_json,
            e.occurred_at,
            e.created_at,
            sr.source_ref_type,
            sr.source_ref_id,
            sr.source_span_id,
            sr.evidence_role,
            sr.locator_json,
            sr.exact_text,
            sr.content_hash,
            sr.metadata_json,
            sr.created_at AS source_created_at
       FROM assessment_evidence_events e
       LEFT JOIN assessment_event_source_refs sr ON sr.event_id = e.id
      WHERE e.session_id = ?1
      ORDER BY e.sequence ASC, sr.created_at ASC, sr.id ASC`,
  ).bind(sessionId).all<AssessmentEvidenceBundleSourceRefRow & {
    event_id: string;
    sequence: number;
    kind: string;
    actor_type: string;
    actor_id: string | null;
    narrative: string;
    payload_json: string | null;
    occurred_at: string;
    created_at: string;
  }>();

  const timeline = new Map<string, AssessmentEvidenceBundleEvent>();
  for (const row of result.results ?? []) {
    const existing = timeline.get(row.event_id);
    const event = existing ?? {
      sequence: row.sequence,
      kind: row.kind,
      actorType: row.actor_type,
      actorId: row.actor_id,
      narrative: row.narrative,
      payload: parseJsonObject(row.payload_json) as JsonObject,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      sourceRefs: [],
    };
    const sourceRef = assessmentBundleSourceRefFromRow(row);
    if (sourceRef) event.sourceRefs.push(sourceRef);
    timeline.set(row.event_id, event);
  }
  return [...timeline.values()];
}

async function loadAssessmentEvidenceBundleClaims(
  db: D1Database,
  reportId: string,
): Promise<AssessmentEvidenceBundleClaim[]> {
  const result = await db.prepare(
    `SELECT c.id AS claim_id,
            c.polarity,
            c.dimension,
            c.narrative,
            c.confidence,
            c.created_at,
            sr.source_ref_type,
            sr.source_ref_id,
            sr.source_span_id,
            sr.evidence_role,
            sr.locator_json,
            sr.exact_text,
            sr.content_hash,
            sr.metadata_json,
            sr.created_at AS source_created_at
       FROM assessment_evaluation_claims c
       LEFT JOIN assessment_claim_source_refs sr ON sr.claim_id = c.id
      WHERE c.report_id = ?1
      ORDER BY c.created_at ASC, c.id ASC, sr.created_at ASC, sr.id ASC`,
  ).bind(reportId).all<AssessmentEvidenceBundleSourceRefRow & {
    claim_id: string;
    polarity: string;
    dimension: string;
    narrative: string;
    confidence: number | null;
    created_at: string;
  }>();

  const claims = new Map<string, AssessmentEvidenceBundleClaim>();
  for (const row of result.results ?? []) {
    const existing = claims.get(row.claim_id);
    const claim = existing ?? {
      claimId: row.claim_id,
      polarity: row.polarity,
      dimension: row.dimension,
      narrative: row.narrative,
      confidence: row.confidence,
      createdAt: row.created_at,
      sourceRefs: [],
    };
    const sourceRef = assessmentBundleSourceRefFromRow(row);
    if (sourceRef) claim.sourceRefs.push(sourceRef);
    claims.set(row.claim_id, claim);
  }
  return [...claims.values()];
}

async function loadAssessmentEvidenceBundleDiagnostics(
  db: D1Database,
  input: { sessionId: string; reportId: string | null },
): Promise<AssessmentEvidenceBundleDiagnostic[]> {
  const result = await db.prepare(
    `SELECT d.id AS diagnostic_id,
            d.code,
            d.severity,
            d.message,
            d.provider,
            d.retryable,
            d.details_json,
            d.created_at,
            sr.source_ref_type,
            sr.source_ref_id,
            sr.source_span_id,
            sr.evidence_role,
            sr.locator_json,
            sr.exact_text,
            sr.content_hash,
            sr.metadata_json,
            sr.created_at AS source_created_at
       FROM assessment_diagnostics d
       LEFT JOIN assessment_diagnostic_source_refs sr ON sr.diagnostic_id = d.id
      WHERE d.session_id = ?1
         OR (?2 IS NOT NULL AND d.report_id = ?2)
      ORDER BY
        CASE d.severity
          WHEN 'blocking' THEN 0
          WHEN 'error' THEN 1
          WHEN 'warning' THEN 2
          WHEN 'info' THEN 3
          ELSE 4
        END,
        d.created_at ASC,
        d.id ASC,
        sr.created_at ASC,
        sr.id ASC`,
  ).bind(input.sessionId, input.reportId).all<AssessmentEvidenceBundleSourceRefRow & {
    diagnostic_id: string;
    code: string;
    severity: string;
    message: string;
    provider: string | null;
    retryable: number;
    details_json: string | null;
    created_at: string;
  }>();

  const diagnostics = new Map<string, AssessmentEvidenceBundleDiagnostic>();
  for (const row of result.results ?? []) {
    const existing = diagnostics.get(row.diagnostic_id);
    const diagnostic = existing ?? {
      diagnosticId: row.diagnostic_id,
      code: row.code,
      severity: row.severity,
      message: row.message,
      provider: row.provider,
      retryable: row.retryable === 1,
      details: parseJsonObject(row.details_json) as JsonObject,
      createdAt: row.created_at,
      sourceRefs: [],
    };
    const sourceRef = assessmentBundleSourceRefFromRow(row);
    if (sourceRef) diagnostic.sourceRefs.push(sourceRef);
    diagnostics.set(row.diagnostic_id, diagnostic);
  }
  return [...diagnostics.values()];
}

async function loadAssessmentEvidenceBundleEvaluation(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentEvidenceBundleEvaluationReport | null> {
  const report = await db.prepare(
    `SELECT id, status, summary, output_json, created_at, updated_at
       FROM assessment_evaluation_reports
      WHERE session_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  ).bind(sessionId).first<{
    id: string;
    status: string;
    summary: string;
    output_json: string | null;
    created_at: string;
    updated_at: string;
  }>();
  if (!report) return null;
  const [claims, diagnostics] = await Promise.all([
    loadAssessmentEvidenceBundleClaims(db, report.id),
    loadAssessmentEvidenceBundleDiagnostics(db, {
      sessionId,
      reportId: report.id,
    }),
  ]);
  return {
    reportId: report.id,
    status: report.status,
    summary: report.summary,
    output: parseJsonObject(report.output_json) as JsonObject,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
    claims,
    diagnostics,
  };
}

async function loadAssessmentEvidenceBundle(input: {
  db: D1Database;
  interview: {
    id: string;
    title: string | null;
    description: string | null;
    interview_type: string | null;
    recipient_name: string | null;
    recipient_email: string | null;
    candidate_id: string | null;
    created_at: string;
    updated_at: string;
  };
  sessionId: string;
}): Promise<AssessmentEvidenceBundle> {
  const store = new RepoTaskInterviewSessionStore(input.db);
  const [progress, timeline, evaluation] = await Promise.all([
    store.loadProgress(input.sessionId),
    loadAssessmentEvidenceBundleTimeline(input.db, input.sessionId),
    loadAssessmentEvidenceBundleEvaluation(input.db, input.sessionId),
  ]);
  const isReviewable = progress.hasChallengePacket
    && progress.hasCommitSubmission
    && progress.evaluation?.status === 'EVALUATED';
  return {
    schemaVersion: 'repo-task-final-evidence-bundle-v1',
    generatedAt: new Date().toISOString(),
    interview: {
      id: input.interview.id,
      title: input.interview.title,
      description: input.interview.description,
      interviewType: input.interview.interview_type,
      recipientName: input.interview.recipient_name,
      recipientEmail: input.interview.recipient_email,
      candidateId: input.interview.candidate_id,
      createdAt: input.interview.created_at,
      updatedAt: input.interview.updated_at,
    },
    assessment: {
      mode: progress.session.mode,
      state: progress.session.state,
      stage: progress.stage,
      nextAction: progress.nextAction,
      nextActionLabel: progress.nextActionLabel,
      readiness: progress.readiness,
      assignmentTrust: progress.assignmentTrust,
      sourceRefCounts: progress.sourceRefCounts,
      evidenceCounts: progress.evidenceCounts,
    },
    completeness: {
      hasChallengePacket: progress.hasChallengePacket,
      hasCommitSubmission: progress.hasCommitSubmission,
      hasEvaluationReport: progress.evaluation !== null,
      hasHumanDecision: progress.humanDecision !== null,
      isReviewable,
    },
    challenge: progress.challenge,
    challengePacketContract: progress.challengePacketContract,
    submission: progress.commit,
    timeline,
    evaluation,
    humanDecision: progress.humanDecision,
  };
}

interface ManualOpenSourceChallengePacketInput {
  interviewId: string;
  userId: string;
  candidateId: string | null;
  repositoryUrl: string;
  githubPrNumber: number | null;
  baseCommitSha: string;
  title: string;
  instructions: string;
  successCriteria: readonly string[];
  expectedEvidence: readonly string[];
  verificationCommand?: string | null;
  createdAt: string;
}

interface MatchedOpenSourceChallengePacket {
  packetId: string;
  repositoryUrl: string;
  githubPrNumber: number;
  pullRequestUrl: string;
  baseCommitSha: string;
  headCommitSha: string;
  verificationCommand: string;
  title: string;
  instructions: string;
  successCriteria: string[];
  expectedEvidence: string[];
  sourceHash: string;
  repoSnapshotId: string;
  qualityScore: number | null;
  demandCount: number;
  demandFamilies: string[];
  reviewProfile: ChallengeReviewProfile;
}

function normalizeScheduledInterviewCopy(input: {
  title?: string;
  description?: string;
  interviewType: string;
  challengeTitle?: string;
  challengeInstructions?: string;
  matchedOpenSourceChallengePacket?: MatchedOpenSourceChallengePacket | null;
}): { title: string | null; description: string | null } {
  const title = input.title?.trim()
    || (input.interviewType === 'OPEN_SOURCE_BUG_FIX'
      ? input.challengeTitle?.trim()
        || input.matchedOpenSourceChallengePacket?.title.trim()
        || null
      : null);
  const description = input.description?.trim()
    || (input.interviewType === 'OPEN_SOURCE_BUG_FIX'
      ? input.challengeInstructions?.trim()
        || input.matchedOpenSourceChallengePacket?.instructions.trim()
        || null
      : null);

  return { title, description };
}

function hasManualOpenSourceChallengePacket(input: {
  interviewType: string;
  githubRepoUrl: string | null | undefined;
  githubPrNumber: number | null | undefined;
  challengeBaseCommitSha: string | undefined;
  challengeTitle: string | undefined;
  challengeInstructions: string | undefined;
  challengeSuccessCriteria: readonly string[] | undefined;
  challengeExpectedEvidence: readonly string[] | undefined;
  challengeVerificationCommand?: string | undefined;
}): boolean {
  return input.interviewType === 'OPEN_SOURCE_BUG_FIX'
    && Boolean(input.githubRepoUrl)
    && Boolean(input.challengeBaseCommitSha)
    && Boolean(input.challengeTitle)
    && Boolean(input.challengeInstructions)
    && Boolean(input.challengeSuccessCriteria?.length)
    && Boolean(input.challengeExpectedEvidence?.length);
}

function demandFamilyLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchedPacketInstructions(packet: ChallengePacket): string {
  const demandNarratives = packet.demands
    .slice(0, 4)
    .map((demand) => `- ${demand.narrative}`);
  return [
    `Work from the exact base commit ${packet.pullRequest.baseSha.toLowerCase()} and create a focused assessment branch.`,
    `Use the selected upstream pull request context as the source-backed task brief: ${packet.pullRequest.url}.`,
    'Implement a production-quality change that addresses the same repo demand without copying hidden ground truth.',
    ...(demandNarratives.length > 0 ? ['Source-backed demands:', ...demandNarratives] : []),
  ].join('\n');
}

function matchedPacketSuccessCriteria(packet: ChallengePacket): string[] {
  const families = packet.demandFamilies.map(demandFamilyLabel).filter(Boolean);
  return [
    'The submitted commit is based on the assigned immutable base commit.',
    'The patch is focused, reviewable, and tied to the selected repo task packet.',
    'Relevant tests are run or a source-backed diagnostic explains why they could not be run.',
    ...(families.length > 0
      ? [`The solution addresses packet demands: ${families.slice(0, 4).join(', ')}.`]
      : []),
  ];
}

function matchedPacketExpectedEvidence(): string[] {
  return [
    'git_commit source ref for the submitted assessment commit',
    'code_diff source ref for the exact baseCommitSha..commitSha candidate patch',
    'terminal_command/test_run source refs for verification',
    'chat/transcript/AI source refs for explanation and AI-use behavior when present',
  ];
}

function matchedPacketVerificationCommand(): string {
  return 'git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD';
}

function matchedPacketMatchProof(input: MatchedOpenSourceChallengePacket): string[] {
  const demandCount = Math.max(0, input.demandCount);
  const demandLabel = demandCount === 1 ? 'demand' : 'demands';
  const families = input.demandFamilies
    .map(demandFamilyLabel)
    .filter(Boolean)
    .slice(0, 4);
  return [
    ...(typeof input.qualityScore === 'number' && Number.isFinite(input.qualityScore)
      ? [`Review packet quality ${Math.round(input.qualityScore * 100)}% from source-backed repo analysis.`]
      : []),
    `${demandCount} source-backed repo ${demandLabel} in the selected PR packet.`,
    ...(families.length > 0 ? [`Demand families: ${families.join(', ')}.`] : []),
    'Matched packet passed repo source-span and concept evidence checks before assignment.',
  ];
}

function isChallengeReviewProfile(value: unknown): value is ChallengeReviewProfile {
  if (!isRecord(value)) return false;
  if (value.source !== 'deterministic_engineering_prior') return false;
  if (!['introductory', 'focused', 'advanced', 'oversized'].includes(String(value.difficultyBand))) return false;
  if (!['mid', 'senior', 'staff'].includes(String(value.expectedSeniority))) return false;
  if (typeof value.expectedTimeMinutes !== 'number' || !Number.isFinite(value.expectedTimeMinutes)) return false;
  if (typeof value.rationale !== 'string' || value.rationale.trim().length === 0) return false;
  if (!isRecord(value.basis)) return false;
  const numericBasis = [
    value.basis.changedFileCount,
    value.basis.changedLineCount,
    value.basis.sourceHunkCount,
    value.basis.testChangeCount,
    value.basis.demandFamilyCount,
  ];
  return numericBasis.every((item) => typeof item === 'number' && Number.isFinite(item))
    && typeof value.basis.hasIssueContext === 'boolean';
}

function matchedPacketAssessmentFit(profile: ChallengeReviewProfile): string[] {
  const basis = profile.basis;
  return [
    `${profile.difficultyBand} review calibrated for ${profile.expectedSeniority} candidates.`,
    `${profile.expectedTimeMinutes} minute target from deterministic engineering prior.`,
    `Sizing: ${basis.changedFileCount} changed ${basis.changedFileCount === 1 ? 'file' : 'files'}, ${basis.changedLineCount} changed ${basis.changedLineCount === 1 ? 'line' : 'lines'}, ${basis.sourceHunkCount} source ${basis.sourceHunkCount === 1 ? 'hunk' : 'hunks'}, ${basis.demandFamilyCount} demand ${basis.demandFamilyCount === 1 ? 'family' : 'families'}.`,
    basis.testChangeCount > 0
      ? `${basis.testChangeCount} test ${basis.testChangeCount === 1 ? 'change' : 'changes'} present in the source-backed PR packet.`
      : 'No test changes in the source-backed PR packet; require candidate verification evidence.',
    basis.hasIssueContext
      ? 'Issue context is present in the source-backed PR packet.'
      : 'No issue context in the source-backed PR packet; assess from code demand evidence.',
  ];
}

function materializeMatchedOpenSourcePacket(
  row: {
    id: string;
    repo_snapshot_id: string | null;
    pr_number: number | null;
    source_hash: string | null;
    packet_json: string;
    github_url: string | null;
    quality_score: number | null;
    context_record_id: string | null;
    repo_source_ref_count: number | null;
    concept_link_count: number | null;
  },
): MatchedOpenSourceChallengePacket | null {
  if (!row.github_url || !row.source_hash || !row.context_record_id) return null;
  if ((row.repo_source_ref_count ?? 0) <= 0 || (row.concept_link_count ?? 0) <= 0) return null;

  let packet: ChallengePacket;
  try {
    packet = JSON.parse(row.packet_json) as ChallengePacket;
  } catch {
    return null;
  }

  const baseCommitSha = packet.pullRequest?.baseSha?.toLowerCase();
  const headCommitSha = packet.pullRequest?.headSha?.toLowerCase();
  if (
    packet.id !== row.id
    || packet.contentHash !== row.source_hash
    || !baseCommitSha
    || !GIT_COMMIT_SHA_PATTERN.test(baseCommitSha)
    || !headCommitSha
    || !GIT_COMMIT_SHA_PATTERN.test(headCommitSha)
    || !Number.isInteger(packet.pullRequest?.number)
    || packet.pullRequest.number <= 0
    || packet.pullRequest.number !== row.pr_number
  ) {
    return null;
  }

  const reviewProfile = isChallengeReviewProfile(packet.reviewProfile) ? packet.reviewProfile : null;
  if (!reviewProfile) return null;

  return {
    packetId: packet.id,
    repositoryUrl: row.github_url,
    githubPrNumber: packet.pullRequest.number,
    pullRequestUrl: packet.pullRequest.url,
    baseCommitSha,
    headCommitSha,
    verificationCommand: matchedPacketVerificationCommand(),
    title: packet.pullRequest.title,
    instructions: matchedPacketInstructions(packet),
    successCriteria: matchedPacketSuccessCriteria(packet),
    expectedEvidence: matchedPacketExpectedEvidence(),
    sourceHash: row.source_hash,
    repoSnapshotId: packet.repoSnapshotId,
    qualityScore: row.quality_score,
    demandCount: packet.demands.length,
    demandFamilies: [...packet.demandFamilies],
    reviewProfile,
  };
}

async function loadMatchedOpenSourceChallengePacket(
  db: D1Database,
  matchedRepoId: number,
): Promise<MatchedOpenSourceChallengePacket | null> {
  const rows = await db.prepare(
    `SELECT rcp.id,
            rcp.repo_snapshot_id,
            rcp.pr_number,
            rcp.source_hash,
            rcp.packet_json,
            rcp.quality_score,
            qr.github_url,
            cr.id AS context_record_id,
            (
              SELECT COUNT(*)
                FROM context_record_source_refs crsr
               WHERE crsr.context_record_id = cr.id
                 AND crsr.source_ref_type = 'repo_source_span'
            ) AS repo_source_ref_count,
            (
              SELECT COUNT(*)
                FROM context_record_concepts crc
               WHERE crc.context_record_id = cr.id
            ) AS concept_link_count
       FROM review_challenge_packets rcp
       JOIN qualified_repos qr ON qr.id = rcp.repo_id
       LEFT JOIN context_records cr
         ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
        AND cr.scope_type = 'repo_snapshot'
        AND cr.scope_id = rcp.repo_snapshot_id
        AND cr.record_type = 'repo_challenge_packet'
      WHERE rcp.repo_id = ?1
        AND rcp.production_ready = 1
        AND rcp.quality_score >= 0.70
      ORDER BY rcp.quality_score DESC, rcp.pr_number`,
  ).bind(matchedRepoId).all<{
    id: string;
    repo_snapshot_id: string | null;
    pr_number: number | null;
    source_hash: string | null;
    packet_json: string;
    quality_score: number | null;
    github_url: string | null;
    context_record_id: string | null;
    repo_source_ref_count: number | null;
    concept_link_count: number | null;
  }>();

  for (const row of rows.results ?? []) {
    const packet = materializeMatchedOpenSourcePacket(row);
    if (packet) return packet;
  }
  return null;
}

function buildManualOpenSourceChallengeExactText(
  input: ManualOpenSourceChallengePacketInput,
): string {
  return [
    `Repo: ${input.repositoryUrl}`,
    `Base commit: ${input.baseCommitSha.toLowerCase()}`,
    ...(input.githubPrNumber ? [`Pull request: #${input.githubPrNumber}`] : []),
    `Task: ${input.title}`,
    `Instructions: ${input.instructions}`,
    ...(input.verificationCommand ? [`Verification command: ${input.verificationCommand}`] : []),
    'Success criteria:',
    ...input.successCriteria.map((criterion) => `- ${criterion}`),
    'Expected evidence:',
    ...input.expectedEvidence.map((evidence) => `- ${evidence}`),
  ].join('\n');
}

function buildMatchedOpenSourceChallengeExactText(
  input: MatchedOpenSourceChallengePacket,
): string {
  return [
    `Repo: ${input.repositoryUrl}`,
    `Base commit: ${input.baseCommitSha}`,
    `Pull request: #${input.githubPrNumber}`,
    `Pull request URL: ${input.pullRequestUrl}`,
    `Task: ${input.title}`,
    `Instructions: ${input.instructions}`,
    `Verification command: ${input.verificationCommand}`,
    'Match proof:',
    ...matchedPacketMatchProof(input).map((proof) => `- ${proof}`),
    'Assessment fit:',
    ...matchedPacketAssessmentFit(input.reviewProfile).map((fit) => `- ${fit}`),
    'Success criteria:',
    ...input.successCriteria.map((criterion) => `- ${criterion}`),
    'Expected evidence:',
    ...input.expectedEvidence.map((evidence) => `- ${evidence}`),
  ].join('\n');
}

async function createManualOpenSourceChallengeAssessmentSession(
  db: D1Database,
  input: ManualOpenSourceChallengePacketInput,
): Promise<AssessmentProgressSnapshot> {
  const store = new RepoTaskInterviewSessionStore(db);
  const session = await store.createSession({
    ingestionKey: `assessment-session:${input.interviewId}:manual-open-source-challenge`,
    interviewId: input.interviewId,
    mode: 'OPEN_SOURCE_BUG_FIX',
    candidateId: input.candidateId,
    createdBy: input.userId,
    metadata: {
      challengePacketSource: 'recruiter_manual_open_source_task',
      repositoryUrl: input.repositoryUrl,
      ...(input.githubPrNumber ? { githubPrNumber: input.githubPrNumber } : {}),
      baseCommitSha: input.baseCommitSha.toLowerCase(),
      challengeTitle: input.title,
      ...(input.verificationCommand ? { verificationCommand: input.verificationCommand } : {}),
    },
  });
  const exactText = buildManualOpenSourceChallengeExactText(input);
  const contentHash = await deterministicEntityId('content', exactText);
  const sourceRef: AssessmentEvidenceSourceRefInput = {
    sourceRefType: 'open_source_challenge_packet',
    sourceRefId: `scheduled-interview:${input.interviewId}:open-source-challenge:${contentHash}`,
    evidenceRole: 'assigned_challenge',
    locator: {
      scheduledInterviewId: input.interviewId,
      repositoryUrl: input.repositoryUrl,
      ...(input.githubPrNumber ? { githubPrNumber: input.githubPrNumber } : {}),
      baseCommitSha: input.baseCommitSha.toLowerCase(),
      ...(input.verificationCommand ? { verificationCommand: input.verificationCommand } : {}),
    },
    exactText,
    contentHash,
    metadata: {
      schemaVersion: 'manual-open-source-challenge-packet-v1',
      source: 'recruiter_manual_open_source_task',
      challengeTitle: input.title,
    },
  };

  await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${session.id}:manual-open-source-challenge:${contentHash}`,
    kind: 'recruiter_note',
    actorType: 'recruiter',
    actorId: input.userId,
    narrative: 'Recruiter assigned a concrete open-source implementation challenge packet.',
    payload: {
      repositoryUrl: input.repositoryUrl,
      ...(input.githubPrNumber ? { githubPrNumber: input.githubPrNumber } : {}),
      baseCommitSha: input.baseCommitSha.toLowerCase(),
      title: input.title,
      instructions: input.instructions,
      successCriteria: [...input.successCriteria],
      expectedEvidence: [...input.expectedEvidence],
      ...(input.verificationCommand ? { verificationCommand: input.verificationCommand } : {}),
    },
    occurredAt: input.createdAt,
    sourceRefs: [sourceRef],
  });
  await recordAssessmentCandidateProfileEvidence(db, {
    sessionId: session.id,
    candidateId: input.candidateId,
    actorId: input.userId,
    occurredAt: input.createdAt,
  });

  return store.loadProgress(session.id);
}

async function createMatchedOpenSourceChallengeAssessmentSession(
  db: D1Database,
  input: {
    interviewId: string;
    userId: string;
    candidateId: string | null;
    matchedRepoId: number;
    packet: MatchedOpenSourceChallengePacket;
    createdAt: string;
  },
): Promise<AssessmentProgressSnapshot> {
  const store = new RepoTaskInterviewSessionStore(db);
  const session = await store.createSession({
    ingestionKey: `assessment-session:${input.interviewId}:matched-open-source-challenge:${input.packet.packetId}`,
    interviewId: input.interviewId,
    mode: 'OPEN_SOURCE_BUG_FIX',
    candidateId: input.candidateId,
    createdBy: input.userId,
    metadata: {
      challengePacketSource: 'matched_review_challenge_packet',
      matchedRepoId: input.matchedRepoId,
      repositoryUrl: input.packet.repositoryUrl,
      githubPrNumber: input.packet.githubPrNumber,
      baseCommitSha: input.packet.baseCommitSha,
      verificationCommand: input.packet.verificationCommand,
      challengePacketId: input.packet.packetId,
      repoSnapshotId: input.packet.repoSnapshotId,
      challengeTitle: input.packet.title,
    },
  });
  const exactText = buildMatchedOpenSourceChallengeExactText(input.packet);
  const sourceRef: AssessmentEvidenceSourceRefInput = {
    sourceRefType: 'review_challenge_packet',
    sourceRefId: input.packet.packetId,
    evidenceRole: 'assigned_challenge',
    locator: {
      scheduledInterviewId: input.interviewId,
      matchedRepoId: input.matchedRepoId,
      repositoryUrl: input.packet.repositoryUrl,
      githubPrNumber: input.packet.githubPrNumber,
      pullRequestUrl: input.packet.pullRequestUrl,
      baseCommitSha: input.packet.baseCommitSha,
      headCommitSha: input.packet.headCommitSha,
      verificationCommand: input.packet.verificationCommand,
      repoSnapshotId: input.packet.repoSnapshotId,
    },
    exactText,
    contentHash: input.packet.sourceHash,
    metadata: {
      schemaVersion: 'matched-open-source-challenge-packet-v1',
      source: 'matched_review_challenge_packet',
      challengeTitle: input.packet.title,
      qualityScore: input.packet.qualityScore,
      demandCount: input.packet.demandCount,
      demandFamilies: input.packet.demandFamilies,
    },
  };

  await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${session.id}:matched-open-source-challenge:${input.packet.packetId}`,
    kind: 'match_decision',
    actorType: 'system',
    actorId: 'pipe-matcher',
    narrative: 'PIPE assigned a source-backed open-source implementation challenge packet from the matched repository.',
    payload: {
      matchedRepoId: input.matchedRepoId,
      repositoryUrl: input.packet.repositoryUrl,
      githubPrNumber: input.packet.githubPrNumber,
      pullRequestUrl: input.packet.pullRequestUrl,
      baseCommitSha: input.packet.baseCommitSha,
      verificationCommand: input.packet.verificationCommand,
      title: input.packet.title,
      successCriteria: input.packet.successCriteria,
      expectedEvidence: input.packet.expectedEvidence,
      challengePacketId: input.packet.packetId,
      repoSnapshotId: input.packet.repoSnapshotId,
      qualityScore: input.packet.qualityScore,
    },
    occurredAt: input.createdAt,
    sourceRefs: [sourceRef],
  });
  await recordAssessmentCandidateProfileEvidence(db, {
    sessionId: session.id,
    candidateId: input.candidateId,
    actorId: input.userId,
    occurredAt: input.createdAt,
  });

  return store.loadProgress(session.id);
}

async function ensureRecipientContact(
  db: D1Database,
  ownerId: string,
  recipient: { name: string; email: string },
): Promise<string> {
  const email = recipient.email.trim().toLowerCase();
  const name = recipient.name.trim();
  const existing = await db.prepare(
    `SELECT id
       FROM contacts
      WHERE owner_id = ?1
        AND lower(email) = ?2
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(ownerId, email).first<{ id: string }>();
  const now = new Date().toISOString();

  if (existing) {
    await db.prepare(
      `UPDATE contacts
          SET name = COALESCE(NULLIF(name, ''), ?1),
              updated_at = ?2
        WHERE id = ?3`,
    ).bind(name, now, existing.id).run();
    await ensureContactLivingContext(db, existing.id);
    return existing.id;
  }

  const contactId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO contacts (
       id, owner_id, email, name, type, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, 'lead', ?5, ?5)`,
  ).bind(contactId, ownerId, email, name, now).run();
  await ensureContactLivingContext(db, contactId);
  return contactId;
}

/**
 * Ensure a standalone (pipeline-free) candidate exists for the given email,
 * returning the candidate id + invite token. Used for assessment-only
 * CODE_REVIEW handoffs so the email can include an /assess/:token link.
 */
async function ensureStandaloneCandidateForInterview(
  db: D1Database,
  ownerId: string,
  recipient: { name: string; email: string },
  interviewId: string,
): Promise<{ candidateId: string; inviteToken: string }> {
  const email = recipient.email.trim().toLowerCase();
  const name = recipient.name.trim();
  // The contact/person graph deduplicates the human by email. A standalone
  // assessment invite still needs its own candidate/application token so two
  // active assessment links for the same person do not route to the latest row.
  const candidateId = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, 'INVITED', NULL, ?, ?)`,
    )
    .bind(candidateId, ownerId, name, email, inviteToken, now, now)
    .run();

  // Link the interview to this candidate
  await db
    .prepare('UPDATE scheduled_interviews SET candidate_id = ?, updated_at = ? WHERE id = ?')
    .bind(candidateId, now, interviewId)
    .run();

  await ensureCandidateLivingContext(db, candidateId);

  return { candidateId, inviteToken };
}

async function ensureScheduledInterviewRoomLinks(
  db: D1Database,
  ownerId: string,
  env: Env,
  interview: {
    id: string;
    scheduled_at: string | null;
    candidate_name: string | null;
    candidate_email: string | null;
    recipient_name: string | null;
    recipient_email: string | null;
    pipeline_title: string | null;
    stage_title: string | null;
    interview_type: string | null;
    scheduling_provider?: string | null;
    external_event_id?: string | null;
  },
  inviteEmail: string,
): Promise<{
  roomId: string;
  sessionId: string;
  hostUrl: string;
  guestUrl: string;
  expiresAt: string;
  contactId: string;
  meetingId: string;
}> {
  const email = inviteEmail.trim().toLowerCase();
  const name = (
    interview.candidate_name
    ?? interview.recipient_name
    ?? email.split('@')[0]
    ?? 'Interview guest'
  ).trim();
  const contactId = await ensureRecipientContact(db, ownerId, { name, email });
  const now = new Date().toISOString();

  let meeting = await db.prepare(
    `SELECT id
       FROM meetings
      WHERE scheduled_interview_id = ?1
        AND owner_id = ?2
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(interview.id, ownerId).first<{ id: string }>();

  if (!meeting) {
    const meetingId = crypto.randomUUID();
    const role = interview.pipeline_title ?? 'Talent Pool';
    const stage = interview.stage_title ?? interview.interview_type ?? 'Interview';
    const copy = scheduledInterviewMeetingCopy({
      candidateName: name,
      roleTitle: role,
      stageTitle: stage,
      interviewType: interview.interview_type,
    });
    const features = scheduledInterviewRoomFeatures(interview.interview_type);
    await db.prepare(
      `INSERT INTO meetings
       (id, owner_id, title, description, status, scheduled_at, meeting_type,
        scheduled_interview_id, scheduling_provider, external_event_id,
        video_enabled, workspace_enabled, recording_enabled, agent_enabled,
        created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'SCHEDULED', ?5, 'INTERVIEW', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
    ).bind(
      meetingId,
      ownerId,
      copy.title,
      copy.description,
      interview.scheduled_at,
      interview.id,
      interview.scheduling_provider ?? null,
      interview.external_event_id ?? null,
      features.videoEnabled ? 1 : 0,
      features.workspaceEnabled ? 1 : 0,
      features.recordingEnabled ? 1 : 0,
      features.agentEnabled ? 1 : 0,
      now,
    ).run();
    meeting = { id: meetingId };
  } else {
    const role = interview.pipeline_title ?? 'Talent Pool';
    const stage = interview.stage_title ?? interview.interview_type ?? 'Interview';
    const copy = scheduledInterviewMeetingCopy({
      candidateName: name,
      roleTitle: role,
      stageTitle: stage,
      interviewType: interview.interview_type,
    });
    const features = scheduledInterviewRoomFeatures(interview.interview_type);
    await db.prepare(
      `UPDATE meetings
          SET scheduled_at = ?1,
              scheduling_provider = COALESCE(?2, scheduling_provider),
              external_event_id = COALESCE(?3, external_event_id),
              title = ?4,
              description = ?5,
              video_enabled = ?6,
              workspace_enabled = ?7,
              recording_enabled = ?8,
              agent_enabled = ?9,
              updated_at = ?10
        WHERE id = ?11`,
    ).bind(
      interview.scheduled_at,
      interview.scheduling_provider ?? null,
      interview.external_event_id ?? null,
      copy.title,
      copy.description,
      features.videoEnabled ? 1 : 0,
      features.workspaceEnabled ? 1 : 0,
      features.recordingEnabled ? 1 : 0,
      features.agentEnabled ? 1 : 0,
      now,
      meeting.id,
    ).run();
  }

  const participant = await db.prepare(
    `SELECT mp.id
       FROM meeting_participants mp
      WHERE mp.meeting_id = ?1
        AND mp.contact_id = ?2
      LIMIT 1`,
  ).bind(meeting.id, contactId).first<{ id: string }>();

  if (!participant) {
    await db.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'ATTENDEE', ?4, ?4)`,
    ).bind(crypto.randomUUID(), meeting.id, contactId, now).run();
  }

  const room = await ensureMeetingRoomLinks(
    db,
    meeting.id,
    env.VIDEO_ROOM_APP_URL ?? 'http://localhost:5175',
    env,
  );
  await db.prepare(
    `UPDATE scheduled_interviews
        SET meeting_url = ?1,
            updated_at = ?2
      WHERE id = ?3`,
  ).bind(room.guestUrl, now, interview.id).run();

  return {
    roomId: room.id,
    sessionId: room.sessionId,
    hostUrl: room.hostUrl,
    guestUrl: room.guestUrl,
    expiresAt: room.expiresAt,
    contactId,
    meetingId: meeting.id,
  };
}

function lineCount(value: string): number {
  return Math.max(1, value.split('\n').length);
}

const tableExistsCache = new WeakMap<D1Database, Map<string, Promise<boolean>>>();

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  let dbCache = tableExistsCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, Promise<boolean>>();
    tableExistsCache.set(db, dbCache);
  }
  const cached = dbCache.get(tableName);
  if (cached) return cached;

  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>()
    .then((row) => Boolean(row))
    .catch((error: unknown) => {
      dbCache?.delete(tableName);
      throw error;
    });
  dbCache.set(tableName, exists);
  return exists;
}

async function hasScheduledAssessmentProgressSchema(db: D1Database): Promise<boolean> {
  return await tableExists(db, 'assessment_sessions')
    && await tableExists(db, 'assessment_evidence_events')
    && await tableExists(db, 'assessment_event_source_refs')
    && await tableExists(db, 'assessment_evaluation_reports');
}

async function hasAssessmentLayerSchema(db: D1Database): Promise<boolean> {
  return await tableExists(db, 'assessment_sessions')
    && await tableExists(db, 'assessment_evidence_events')
    && await tableExists(db, 'assessment_event_source_refs')
    && await tableExists(db, 'context_records')
    && await tableExists(db, 'context_record_source_refs');
}

function contactFirstInterviewSourceText(input: {
  recipientName: string;
  recipientEmail: string;
  meetingType: string;
  interviewType: string;
  assessmentSetup: ScheduledAssessmentSetupProjection;
  scheduledAt: string | null;
  schedulingProvider: string | null;
  schedulingUrl: string | null;
  recruiterNotes?: string | null;
  createdAt: string;
}): string {
  return [
    'Contact-first interview invite',
    `Recipient name: ${input.recipientName}`,
    `Recipient email: ${input.recipientEmail}`,
    `Meeting type: ${input.meetingType}`,
    `Interview type: ${input.interviewType}`,
    `Assessment setup status: ${input.assessmentSetup.status}`,
    `Assessment setup kind: ${input.assessmentSetup.kind}`,
    `Assessment setup source: ${input.assessmentSetup.source}`,
    `Assessment setup blocks positive assessment: ${input.assessmentSetup.blocksPositiveAssessment ? 'yes' : 'no'}`,
    `Assessment setup message: ${input.assessmentSetup.message ?? 'none'}`,
    `Assessment setup next action: ${input.assessmentSetup.nextAction}`,
    `Assessment setup next action label: ${input.assessmentSetup.nextActionLabel ?? 'none'}`,
    `Scheduled at: ${input.scheduledAt ?? 'unscheduled'}`,
    `Scheduling provider: ${input.schedulingProvider ?? 'none'}`,
    `Scheduling URL: ${input.schedulingUrl ?? 'none'}`,
    `Recruiter notes: ${input.recruiterNotes?.trim() || 'none'}`,
    `Created at: ${input.createdAt}`,
  ].join('\n');
}

async function persistContactFirstInterviewInviteContext(
  db: D1Database,
  input: {
    contactId: string;
    ownerId: string;
    interviewId: string;
    recipientName: string;
    recipientEmail: string;
    meetingType: string;
    interviewType: string;
    assessmentSetup: ScheduledAssessmentSetupProjection;
    scheduledAt: string | null;
    schedulingProvider: string | null;
    schedulingUrl: string | null;
    recruiterNotes?: string | null;
    createdAt: string;
  },
): Promise<void> {
  const identity = await ensureContactLivingContext(db, input.contactId);
  if (!identity) return;

  const store = new LivingContextStore(db, () => input.createdAt);
  const interaction = await store.upsertInteraction({
    ingestionKey: `scheduled-interview:${input.interviewId}:contact:${input.contactId}`,
    workspacePersonId: identity.workspacePersonId,
    interactionType: input.meetingType === 'DIRECT_VIDEO_CALL'
      ? 'direct_video_call'
      : 'screening_interview',
    externalReference: input.interviewId,
    startedAt: input.scheduledAt,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingType: input.meetingType,
      interviewType: input.interviewType,
      assessmentSetupStatus: input.assessmentSetup.status,
      assessmentSetupKind: input.assessmentSetup.kind,
      assessmentSetupSource: input.assessmentSetup.source,
      assessmentSetupBlocksPositiveAssessment: input.assessmentSetup.blocksPositiveAssessment,
      assessmentSetupNextAction: input.assessmentSetup.nextAction,
      assessmentSetupNextActionLabel: input.assessmentSetup.nextActionLabel,
      recruiterNotes: input.recruiterNotes ?? null,
    },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'scheduled_interview_invite',
    logicalKey: `${input.interviewId}:invite`,
    metadata: {
      scheduledInterviewId: input.interviewId,
      contactId: input.contactId,
      ownerId: input.ownerId,
    },
  });
  const sourceText = contactFirstInterviewSourceText(input);
  const contentHash = await deterministicEntityId('content', sourceText);
  const version = await store.createArtifactVersion({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite:${contentHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: sourceText,
    byteLength: new TextEncoder().encode(sourceText).byteLength,
    metadata: {
      scheduledInterviewId: input.interviewId,
      source: 'contact_first_interview_create',
      assessmentSetupStatus: input.assessmentSetup.status,
    },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite:${version.id}:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'invite-full',
    byteStart: 0,
    byteEnd: new TextEncoder().encode(sourceText).byteLength,
    charStart: 0,
    charEnd: sourceText.length,
    lineStart: 1,
    lineEnd: lineCount(sourceText),
    exactText: sourceText,
    metadata: {
      scheduledInterviewId: input.interviewId,
      source: 'contact_first_interview_create',
      assessmentSetupStatus: input.assessmentSetup.status,
    },
  });
  await store.upsertContextRecord({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-context`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    recordType: 'scheduled_interview_invite',
    predicate: 'preserves contact-first interview invite',
    narrative: `Contact-first interview invite for ${input.recipientName}.`,
    qualifiers: {
      scheduledInterviewId: input.interviewId,
      contactId: input.contactId,
      meetingType: input.meetingType,
      interviewType: input.interviewType,
      assessmentSetupStatus: input.assessmentSetup.status,
      assessmentSetupKind: input.assessmentSetup.kind,
      assessmentSetupSource: input.assessmentSetup.source,
      assessmentSetupBlocksPositiveAssessment: input.assessmentSetup.blocksPositiveAssessment,
      assessmentSetupMessage: input.assessmentSetup.message,
      assessmentSetupNextAction: input.assessmentSetup.nextAction,
      assessmentSetupNextActionLabel: input.assessmentSetup.nextActionLabel,
      recruiterNotes: input.recruiterNotes ?? null,
    },
    confidence: 1,
    extractionVersion: 'scheduled-interview-create-v1',
    observedAt: input.createdAt,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'scheduled_interview',
        entityId: input.interviewId,
        relationship: 'source_event',
      },
      {
        entityType: 'contact',
        entityId: input.contactId,
        relationship: 'participant',
      },
    ],
  });
}

function codeReviewContextCallSourceText(input: {
  originalInterviewId: string;
  contextCallInterviewId: string;
  personName: string;
  personEmail: string;
  matchStatus: string;
  matchSummary: string;
  gaps: string[];
  questions: readonly string[];
  createdAt: string;
}): string {
  return [
    'Code-review context call recommendation',
    `Original interview id: ${input.originalInterviewId}`,
    `Context call interview id: ${input.contextCallInterviewId}`,
    `Person name: ${input.personName}`,
    `Person email: ${input.personEmail}`,
    `Match status: ${input.matchStatus}`,
    `Match summary: ${input.matchSummary}`,
    ...(input.gaps.length > 0
      ? input.gaps.map((gap, index) => `Evidence gap ${index + 1}: ${gap}`)
      : ['Evidence gap: none recorded']),
    ...input.questions.map((question, index) => `Question ${index + 1}: ${question}`),
    `Created at: ${input.createdAt}`,
  ].join('\n');
}

async function persistCodeReviewContextCallRecommendation(
  db: D1Database,
  input: {
    ownerId: string;
    candidateId: string | null;
    contactId: string | null;
    originalInterviewId: string;
    contextCallInterviewId: string;
    personName: string;
    personEmail: string;
    matchRunId: string | null;
    matchStatus: string;
    matchSummary: string;
    gaps: string[];
    questions: readonly string[];
    createdAt: string;
  },
): Promise<string | null> {
  const identity = input.candidateId
    ? await ensureCandidateLivingContext(db, input.candidateId)
    : input.contactId
      ? await ensureContactLivingContext(db, input.contactId)
      : null;
  if (!identity) return null;

  const applicationId: string | null = 'applicationId' in identity && typeof identity.applicationId === 'string'
    ? identity.applicationId
    : null;
  const store = new LivingContextStore(db, () => input.createdAt);
  const interaction = await store.upsertInteraction({
    ingestionKey: `code-review-context-call:${input.originalInterviewId}:${input.contextCallInterviewId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId,
    interactionType: 'code_review_context_call_recommendation',
    externalReference: input.originalInterviewId,
    startedAt: input.createdAt,
    metadata: {
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
    },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `code-review-context-call:${input.contextCallInterviewId}:artifact`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'code_review_context_call_recommendation',
    logicalKey: `${input.originalInterviewId}:context-call:${input.contextCallInterviewId}`,
    metadata: {
      ownerId: input.ownerId,
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
    },
  });
  const sourceText = codeReviewContextCallSourceText(input);
  const contentHash = await deterministicEntityId('content', sourceText);
  const version = await store.createArtifactVersion({
    ingestionKey: `code-review-context-call:${input.contextCallInterviewId}:${contentHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: sourceText,
    byteLength: new TextEncoder().encode(sourceText).byteLength,
    metadata: {
      source: 'code_review_context_call_recommendation',
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
    },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `code-review-context-call:${input.contextCallInterviewId}:${version.id}:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'context-call-recommendation-full',
    byteStart: 0,
    byteEnd: new TextEncoder().encode(sourceText).byteLength,
    charStart: 0,
    charEnd: sourceText.length,
    lineStart: 1,
    lineEnd: lineCount(sourceText),
    exactText: sourceText,
    metadata: {
      source: 'code_review_context_call_recommendation',
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchStatus: input.matchStatus,
    },
  });
  await store.upsertContextRecord({
    ingestionKey: `code-review-context-call:${input.originalInterviewId}:${input.contextCallInterviewId}:context`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    applicationId,
    recordType: 'code_review_context_call_recommendation',
    predicate: 'recommends context call for repo matching',
    narrative: `PIPE recommended a context call for ${input.personName} before assigning a code review challenge.`,
    qualifiers: {
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
      matchSummary: input.matchSummary,
      gaps: input.gaps,
      questions: [...input.questions],
    },
    confidence: 1,
    extractionVersion: 'code-review-context-call-v1',
    observedAt: input.createdAt,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'scheduled_interview',
        entityId: input.originalInterviewId,
        relationship: 'originating_assessment',
      },
      {
        entityType: 'scheduled_interview',
        entityId: input.contextCallInterviewId,
        relationship: 'recommended_follow_up',
      },
      ...(input.matchRunId
        ? [{
            entityType: 'match_run',
            entityId: input.matchRunId,
            relationship: 'blocked_match',
          }]
        : []),
      ...(input.candidateId
        ? [{
            entityType: 'candidate',
            entityId: input.candidateId,
            relationship: 'participant',
          }]
        : []),
      ...(input.contactId
        ? [{
            entityType: 'contact',
            entityId: input.contactId,
            relationship: 'participant',
          }]
        : []),
    ],
  });

  if (!await hasAssessmentLayerSchema(db)) return null;

  const assessmentStore = new AssessmentLayerStore(db, () => input.createdAt);
  const assessmentSession = await assessmentStore.createAssessmentSession({
    ingestionKey: `assessment-session:code-review-evidence-plan:${input.originalInterviewId}:${input.contextCallInterviewId}`,
    interviewId: input.contextCallInterviewId,
    mode: 'TECHNICAL',
    candidateId: input.candidateId,
    workspaceId: input.ownerId,
    createdBy: 'code-review-evidence-plan',
    metadata: {
      source: 'code_review_evidence_plan',
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
      matchSummary: input.matchSummary,
      gaps: input.gaps,
      questions: [...input.questions],
      workspacePersonId: identity.workspacePersonId,
      applicationId,
    },
  });

  await assessmentStore.recordAssessmentEvent({
    sessionId: assessmentSession.id,
    ingestionKey: `assessment-event:code-review-evidence-plan:${input.originalInterviewId}:${input.contextCallInterviewId}:created`,
    kind: 'evidence_plan_created',
    actorType: 'system',
    narrative: `PIPE created a source-backed evidence plan for ${input.personName} before assigning a code-review challenge.`,
    payload: {
      originalInterviewId: input.originalInterviewId,
      contextCallInterviewId: input.contextCallInterviewId,
      matchRunId: input.matchRunId,
      matchStatus: input.matchStatus,
      matchSummary: input.matchSummary,
      gaps: input.gaps,
      questions: [...input.questions],
      workspacePersonId: identity.workspacePersonId,
      applicationId,
    },
    occurredAt: input.createdAt,
    sourceRefs: [{
      sourceRefType: 'source_span',
      sourceRefId: span.id,
      sourceSpanId: span.id,
      evidenceRole: 'evidence_plan_source',
      locator: {
        originalInterviewId: input.originalInterviewId,
        contextCallInterviewId: input.contextCallInterviewId,
        matchRunId: input.matchRunId,
        stableSegmentId: 'context-call-recommendation-full',
      },
      exactText: sourceText,
      contentHash,
      metadata: {
        sourceKind: 'code_review_context_call_recommendation.source_span',
        matchStatus: input.matchStatus,
      },
    }],
  });

  await assessmentStore.transitionAssessmentState({
    sessionId: assessmentSession.id,
    toState: 'IN_PROGRESS',
    reason: 'Recruiter created a source-backed evidence plan follow-up for blocked code-review matching.',
    actorType: 'system',
  });

  return assessmentSession.id;
}

function inviteDeliverySourceText(input: {
  recipientEmail: string;
  subject: string;
  deliveredUrl: string;
  roomUrl: string | null;
  customMessage: string | null;
  emailSent: boolean;
  providerMessageId: string | null;
  createdAt: string;
}): string {
  return [
    'Scheduled interview invite delivery',
    `Recipient email: ${input.recipientEmail}`,
    `Subject: ${input.subject}`,
    `Delivered URL: ${input.deliveredUrl}`,
    `Room URL: ${input.roomUrl ?? 'none'}`,
    `Custom message: ${input.customMessage ?? 'none'}`,
    `Email sent: ${input.emailSent ? 'yes' : 'no'}`,
    `Provider message id: ${input.providerMessageId ?? 'none'}`,
    `Created at: ${input.createdAt}`,
  ].join('\n');
}

async function persistScheduledInterviewInviteDeliveryContext(
  db: D1Database,
  input: {
    contactId: string;
    ownerId: string;
    interviewId: string;
    meetingId: string | null;
    recipientEmail: string;
    subject: string;
    deliveredUrl: string;
    roomUrl: string | null;
    customMessage: string | null;
    emailSent: boolean;
    providerMessageId: string | null;
    createdAt: string;
  },
): Promise<void> {
  const identity = await ensureContactLivingContext(db, input.contactId);
  if (!identity) return;

  const store = new LivingContextStore(db, () => input.createdAt);
  const interaction = await store.upsertInteraction({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-delivery:${input.contactId}:${input.createdAt}`,
    workspacePersonId: identity.workspacePersonId,
    interactionType: 'scheduled_interview_invite_delivery',
    externalReference: input.interviewId,
    startedAt: input.createdAt,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingId: input.meetingId,
      emailSent: input.emailSent,
      deliveredUrl: input.deliveredUrl,
      roomUrl: input.roomUrl,
    },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-delivery:${input.contactId}:${input.createdAt}:artifact`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'scheduled_interview_invite_delivery',
    logicalKey: `${input.interviewId}:invite-delivery:${input.createdAt}`,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingId: input.meetingId,
      contactId: input.contactId,
      ownerId: input.ownerId,
      emailSent: input.emailSent,
    },
  });
  const sourceText = inviteDeliverySourceText(input);
  const contentHash = await deterministicEntityId('content', sourceText);
  const version = await store.createArtifactVersion({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-delivery:${input.createdAt}:${contentHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: sourceText,
    byteLength: new TextEncoder().encode(sourceText).byteLength,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingId: input.meetingId,
      deliveredUrl: input.deliveredUrl,
      roomUrl: input.roomUrl,
      source: 'scheduled_interview_invite_delivery',
    },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-delivery:${version.id}:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'invite-delivery-full',
    byteStart: 0,
    byteEnd: new TextEncoder().encode(sourceText).byteLength,
    charStart: 0,
    charEnd: sourceText.length,
    lineStart: 1,
    lineEnd: lineCount(sourceText),
    exactText: sourceText,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingId: input.meetingId,
      deliveredUrl: input.deliveredUrl,
      roomUrl: input.roomUrl,
      source: 'scheduled_interview_invite_delivery',
    },
  });
  await store.upsertContextRecord({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-delivery:${input.contactId}:${input.createdAt}:context`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    recordType: 'scheduled_interview_invite_delivery',
    predicate: 'preserves scheduled interview invite delivery',
    narrative: `Scheduled interview invite delivery for ${input.recipientEmail}.`,
    qualifiers: {
      scheduledInterviewId: input.interviewId,
      meetingId: input.meetingId,
      contactId: input.contactId,
      emailSent: input.emailSent,
    },
    confidence: 1,
    extractionVersion: 'scheduled-interview-invite-delivery-v1',
    observedAt: input.createdAt,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'scheduled_interview',
        entityId: input.interviewId,
        relationship: 'source_event',
      },
      ...(input.meetingId
        ? [{
            entityType: 'meeting',
            entityId: input.meetingId,
            relationship: 'delivery_link_target',
          }]
        : []),
      {
        entityType: 'contact',
        entityId: input.contactId,
        relationship: 'recipient',
      },
    ],
  });
}

interface BookingConfirmationDetails {
  id: string;
  recipientName: string | null;
  recipientEmail: string | null;
  pipelineTitle: string | null;
  stageTitle: string | null;
  scheduledAt: string | null;
  meetingUrl: string | null;
  bookingConfirmationSentAt: string | null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function nameFromEmail(email: string): string {
  return email.split('@')[0] || 'there';
}

function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatScheduledTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function buildScheduledBookingEmailHtml(input: {
  recipientName: string;
  pipelineTitle: string;
  stageTitle: string | null;
  scheduledTime: string | null;
  meetingUrl: string;
  logoUrl: string;
}): string {
  const recipientName = escapeEmailHtml(input.recipientName);
  const pipelineTitle = escapeEmailHtml(input.pipelineTitle);
  const stageTitle = input.stageTitle ? escapeEmailHtml(input.stageTitle) : null;
  const scheduledTime = input.scheduledTime ? escapeEmailHtml(input.scheduledTime) : null;
  const safeMeetingUrl = encodeURI(input.meetingUrl);

  return `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${buildPipeEmailLogoImg(input.logoUrl)}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Interview Confirmed</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    Hi ${recipientName}, your interview for <strong>${pipelineTitle}</strong> is confirmed.
  </p>
  <div style="padding: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 32px;">
    ${stageTitle ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Stage:</strong> ${stageTitle}</p>` : ''}
    ${scheduledTime ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Time:</strong> ${scheduledTime}</p>` : ''}
    <p style="font-size: 14px; margin: 0;"><strong style="color: #888;">Link:</strong> <a href="${safeMeetingUrl}" style="color: #60a5fa;">Join Meeting</a></p>
  </div>
  <a href="${safeMeetingUrl}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    JOIN INTERVIEW →
  </a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="${safeMeetingUrl}" style="color: #888;">${escapeEmailHtml(input.meetingUrl)}</a>
  </p>
</div>`;
}

async function loadBookingConfirmationDetails(
  db: D1Database,
  ownerId: string,
  interviewId: string,
): Promise<BookingConfirmationDetails | null> {
  return db.prepare(
    `SELECT si.id,
            COALESCE(c.name, si.recipient_name) AS recipient_name,
            COALESCE(c.email, si.recipient_email) AS recipient_email,
            p.title AS pipeline_title,
            s.title AS stage_title,
            si.scheduled_at,
            si.meeting_url,
            si.booking_confirmation_sent_at
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
      WHERE si.id = ?1
        AND si.owner_id = ?2`,
  ).bind(interviewId, ownerId).first<{
    id: string;
    recipient_name: string | null;
    recipient_email: string | null;
    pipeline_title: string | null;
    stage_title: string | null;
    scheduled_at: string | null;
    meeting_url: string | null;
    booking_confirmation_sent_at: string | null;
  }>().then((row) => row ? {
    id: row.id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    pipelineTitle: row.pipeline_title,
    stageTitle: row.stage_title,
    scheduledAt: row.scheduled_at,
    meetingUrl: row.meeting_url,
    bookingConfirmationSentAt: row.booking_confirmation_sent_at,
  } : null);
}

async function sendScheduledBookingConfirmationEmail(
  db: D1Database,
  env: Env,
  ownerId: string,
  interviewId: string,
): Promise<void> {
  const details = await loadBookingConfirmationDetails(db, ownerId, interviewId);
  const recipientEmail = normalizeEmail(details?.recipientEmail);
  const meetingUrl = details?.meetingUrl ? withDevBasicAuth(details.meetingUrl, env) : null;

  if (!details || !recipientEmail || !meetingUrl || details.bookingConfirmationSentAt) return;

  const recipientName = details.recipientName?.trim()
    || nameFromEmail(recipientEmail);
  const pipelineTitle = details.pipelineTitle?.trim() || 'Interview';
  const scheduledTime = formatScheduledTime(details.scheduledAt);
  const subject = `Interview scheduled — ${pipelineTitle}`;
  const html = buildScheduledBookingEmailHtml({
    recipientName,
    pipelineTitle,
    stageTitle: details.stageTitle,
    scheduledTime,
    meetingUrl,
    logoUrl: resolvePipeEmailLogoUrl(null, env.PUBLIC_EMAIL_LOGO_URL),
  });

  try {
    const result = await sendTransactionalEmail(env, {
      to: recipientEmail,
      subject,
      html,
    });
    if (!result) return;

    const sentAt = new Date().toISOString();
    await db.prepare(
      `UPDATE scheduled_interviews
          SET booking_confirmation_sent_at = COALESCE(booking_confirmation_sent_at, ?1),
              email_sent_at = COALESCE(email_sent_at, ?1),
              updated_at = ?1
        WHERE id = ?2
          AND owner_id = ?3`,
    ).bind(sentAt, interviewId, ownerId).run();
  } catch (err) {
    console.error('[scheduling/booking-confirmation] Email send failed:', {
      interviewId,
      recipientEmail,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function queueScheduledBookingConfirmation(
  c: { env: Env; executionCtx: ExecutionContext },
  db: D1Database,
  ownerId: string,
  interviewId: string,
): void {
  if (!c.env.EMAIL && !c.env.RESEND_API_KEY) return;
  c.executionCtx.waitUntil(
    sendScheduledBookingConfirmationEmail(db, c.env, ownerId, interviewId),
  );
}

function queueBestEffortBackgroundTask(
  c: { executionCtx: ExecutionContext },
  task: Promise<unknown>,
): void {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}

interface CalendlyInvitee {
  uri?: string;
  name?: string;
  email?: string;
  tracking?: {
    utm_content?: string;
    utm_term?: string;
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    salesforce_uuid?: string;
  };
  answers?: Array<{
    position?: number;
    value?: string;
  }>;
  questions_and_answers?: Array<{
    position?: number;
    question?: string;
    answer?: string;
  }>;
}

function calendlyInviteeInterviewId(invitee: CalendlyInvitee): string | null {
  const trackingInterviewId = invitee.tracking?.utm_content?.trim()
    || invitee.tracking?.utm_term?.trim();
  if (trackingInterviewId) return trackingInterviewId;

  const answer = invitee.answers?.find((item) => item.position === 1 && item.value?.trim());
  if (answer?.value) return answer.value.trim();

  const questionAnswer = invitee.questions_and_answers?.find(
    (item) =>
      item.position === 1
      && item.answer?.trim(),
  );
  return questionAnswer?.answer?.trim() ?? null;
}

// ─── Authenticated routes ───────────────────────────────────────────────────

const schedulingAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
schedulingAuth.use('*', authMiddleware);

// POST /connect — return OAuth authorization URL
schedulingAuth.post('/connect', async (c) => {
  const body = await c.req.json();
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, redirectUri, codeChallenge } = parsed.data;

  if (providerId === 'CALENDLY') {
    const clientId = ((c.env as unknown as Record<string, string>)['CALENDLY_CLIENT_ID'] ?? '').trim();
    if (!clientId) {
      return apiError(c, 'SERVICE_UNAVAILABLE', 'Calendly not configured.');
    }



    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'event_types:read scheduled_events:read users:read webhooks:read webhooks:write',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    const authUrl = `https://auth.calendly.com/oauth/authorize?${params.toString()}`;
    console.log('[scheduling] Generated Calendly auth URL:', authUrl);

    return c.json({
      authUrl,
    });
  }

  if (providerId === 'CAL_COM') {
    const clientId = ((c.env as unknown as Record<string, string>)['CALCOM_CLIENT_ID'] ?? '').trim();
    if (!clientId) {
      return apiError(c, 'SERVICE_UNAVAILABLE', 'Cal.com not configured.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'READ_BOOKING READ_PROFILE',
    });

    return c.json({
      authUrl: `https://app.cal.com/auth/oauth2/authorize?${params.toString()}`,
    });
  }

  return apiError(c, 'VALIDATION_ERROR', `Unknown provider: ${providerId}`);
});

// POST /callback — exchange OAuth code for tokens
schedulingAuth.post('/callback', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, code, redirectUri, codeVerifier } = parsed.data;
  const config = getProviderConfig(providerId, c.env);
  if (!config || !config.clientId) {
    return apiError(c, 'SERVICE_UNAVAILABLE', `${providerId} not configured.`);
  }



  // Exchange code for tokens
  const tokenParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
  if (codeVerifier) {
    tokenParams['code_verifier'] = codeVerifier;
  }

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokenParams),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error('[scheduling] Token exchange failed', {
      status: tokenResponse.status,
      body: errorBody.slice(0, 500),
    });
    return apiError(c, 'INTERNAL_ERROR', `Token exchange failed: ${tokenResponse.status}`);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Fetch user info for display (Calendly only)
  let accountEmail = '';
  let accountName = '';
  if (providerId === 'CALENDLY' && config.userInfoUrl) {
    try {
      const userResp = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userResp.ok) {
        const userData = await userResp.json() as {
          resource?: { name?: string; email?: string };
        };
        accountEmail = userData.resource?.email ?? '';
        accountName = userData.resource?.name ?? '';
      }
    } catch (err) {
      console.warn('[scheduling] Failed to fetch user info', { err });
    }
  }

  // Generate webhook secret
  const webhookSecretBytes = new Uint8Array(32);
  crypto.getRandomValues(webhookSecretBytes);
  const webhookSecret = Array.from(webhookSecretBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expiresIn = tokens.expires_in ?? 7200;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  const connectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Revoke any existing ACTIVE connections for this user+provider
  await db
    .prepare(
      `UPDATE scheduling_connections SET status = 'REVOKED', updated_at = ?
       WHERE owner_id = ? AND provider_id = ? AND status = 'ACTIVE'`
    )
    .bind(now, userId, providerId)
    .run();

  // Create new connection
  await db
    .prepare(
      `INSERT INTO scheduling_connections
       (id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ACTIVE', ?, NULL, ?, ?)`
    )
    .bind(
      connectionId, userId, providerId,
      tokens.access_token, tokens.refresh_token ?? null, tokenExpiry,
      accountEmail, accountName, webhookSecret,
      now, now, now,
    )
    .run();

  // Register webhook with provider (best-effort)
  let webhookId: string | null = null;
  try {
    webhookId = await registerProviderWebhook(
      connectionId, providerId, tokens.access_token,
      webhookSecret, config, c.env,
    );

    if (webhookId) {
      await db
        .prepare('UPDATE scheduling_connections SET webhook_id = ?, updated_at = ? WHERE id = ?')
        .bind(webhookId, new Date().toISOString(), connectionId)
        .run();
    }
  } catch (err) {
    console.warn('[scheduling] Webhook registration failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({
    connection: {
      id: connectionId,
      providerId,
      accountEmail,
      accountName,
      status: 'ACTIVE',
      webhookRegistered: !!webhookId,
    },
  });
});

// GET /connection — current active connection
schedulingAuth.get('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT id, provider_id, account_email, account_name, status,
              connected_at, last_sync_at
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      account_email: string | null;
      account_name: string | null;
      status: string;
      connected_at: string;
      last_sync_at: string | null;
    }>();

  if (!row) {
    return c.json({ connection: null });
  }

  return c.json({
    connection: {
      id: row.id,
      providerId: row.provider_id,
      accountEmail: row.account_email,
      accountName: row.account_name,
      status: row.status,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
    },
  });
});

// DELETE /connection — disconnect provider
schedulingAuth.delete('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, webhook_id
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      webhook_id: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'No active connection.');
  }

  // Delete webhook from provider (best-effort)
  if (connection.webhook_id) {
    try {
      await deleteProviderWebhook(
        connection.provider_id, connection.access_token, connection.webhook_id,
      );
    } catch (err) {
      console.warn('[scheduling] Webhook deletion failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db
    .prepare(
      `UPDATE scheduling_connections SET status = 'REVOKED', updated_at = ? WHERE id = ?`
    )
    .bind(new Date().toISOString(), connection.id)
    .run();

  return c.json({ success: true });
});

// GET /connection/:id/event-types — list event types for a specific connection
schedulingAuth.get('/connection/:id/event-types', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const { id: connectionId } = c.req.param();

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE id = ? AND owner_id = ? AND status = 'ACTIVE'`
    )
    .bind(connectionId, userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'Connection not found.');
  }

  // Auto-refresh if needed
  let accessToken = connection.access_token;
  if (connection.token_expiry) {
    const expiryTime = new Date(connection.token_expiry).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() >= expiryTime - bufferMs && connection.refresh_token) {
      const refreshed = await refreshToken(connection, c.env);
      if (refreshed) {
        accessToken = refreshed;
      } else {
        return apiError(c, 'INTERNAL_ERROR', 'Token refresh failed.');
      }
    }
  }

  const config = getProviderConfig(connection.provider_id, c.env);
  if (!config?.eventTypesUrl) {
    return apiError(c, 'INTERNAL_ERROR', 'Provider does not support event types.');
  }

  let eventTypes: ProviderEventTypeSummary[] = [];

  if (connection.provider_id === 'CALENDLY') {
    eventTypes = await fetchCalendlyEventTypes(accessToken, config);
  } else if (connection.provider_id === 'CAL_COM') {
    eventTypes = await fetchCalComEventTypes(accessToken, config);
  }

  return c.json({ eventTypes });
});

// GET /event-types — list provider event types
schedulingAuth.get('/event-types', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'No active connection.');
  }

  // Auto-refresh if needed
  let accessToken = connection.access_token;
  if (connection.token_expiry) {
    const expiryTime = new Date(connection.token_expiry).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() >= expiryTime - bufferMs && connection.refresh_token) {
      const refreshed = await refreshToken(connection, c.env);
      if (refreshed) {
        accessToken = refreshed;
      } else {
        return apiError(c, 'INTERNAL_ERROR', 'Token refresh failed.');
      }
    }
  }

  const config = getProviderConfig(connection.provider_id, c.env);
  if (!config?.eventTypesUrl) {
    return apiError(c, 'INTERNAL_ERROR', 'Provider does not support event types.');
  }

  let eventTypes: ProviderEventTypeSummary[] = [];

  if (connection.provider_id === 'CALENDLY') {
    eventTypes = await fetchCalendlyEventTypes(accessToken, config);
  } else if (connection.provider_id === 'CAL_COM') {
    eventTypes = await fetchCalComEventTypes(accessToken, config);
  }

  return c.json({ eventTypes });
});

// GET /interviews — list scheduled interviews
schedulingAuth.get('/interviews', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const limit = parsePositiveInt(
    c.req.query('limit'),
    SCHEDULED_INTERVIEWS_DEFAULT_LIMIT,
    SCHEDULED_INTERVIEWS_MAX_LIMIT,
  );
  const offset = parseNonNegativeInt(c.req.query('offset'), 0);
  const sort = parseScheduledInterviewsSort(c.req.query('sort'));
  const orderByClause = scheduledInterviewsOrderByClause(sort);
  const hasWorkspaceSessions = await tableExists(db, 'dev_container_sessions');
  const workspaceSessionSelect = hasWorkspaceSessions
    ? `dcs.status AS workspace_status,
              dcs.error_message AS workspace_error_message,
              dcs.expires_at AS workspace_expires_at,
              dcs.updated_at AS workspace_updated_at,
              dcs.repo_git_url AS workspace_repo_git_url,
              dcs.base_commit_sha AS workspace_base_commit_sha`
    : `NULL AS workspace_status,
              NULL AS workspace_error_message,
              NULL AS workspace_expires_at,
              NULL AS workspace_updated_at,
              NULL AS workspace_repo_git_url,
              NULL AS workspace_base_commit_sha`;
  const workspaceSessionJoin = hasWorkspaceSessions
    ? `LEFT JOIN dev_container_sessions dcs ON dcs.id = (
         SELECT latest_dcs.id
           FROM dev_container_sessions latest_dcs
          WHERE latest_dcs.meeting_id = m.id
             OR latest_dcs.meeting_room_id = mr.id
          ORDER BY latest_dcs.updated_at DESC, latest_dcs.created_at DESC
          LIMIT 1
       )`
    : '';
  const hasCandidateChallengeAssignments = await tableExists(db, 'candidate_challenge_assignment');
  const assignmentSelect = hasCandidateChallengeAssignments
    ? `cca.repo_id AS assignment_repo_id,
              cca.github_repo_url AS assignment_github_repo_url,
              cca.github_pr_number AS assignment_github_pr_number`
    : `NULL AS assignment_repo_id,
              NULL AS assignment_github_repo_url,
              NULL AS assignment_github_pr_number`;
  const assignmentJoin = hasCandidateChallengeAssignments
    ? `LEFT JOIN candidate_challenge_assignment cca ON cca.id = (
         SELECT latest_cca.id
           FROM candidate_challenge_assignment latest_cca
          WHERE latest_cca.candidate_id = si.candidate_id
            AND latest_cca.stage_id = si.stage_id
            AND latest_cca.github_repo_url IS NOT NULL
            AND latest_cca.github_pr_number IS NOT NULL
          ORDER BY latest_cca.assigned_at DESC, latest_cca.id DESC
          LIMIT 1
       )`
    : '';

  const countRow = await db
    .prepare('SELECT COUNT(*) AS total FROM scheduled_interviews WHERE owner_id = ?')
    .bind(userId)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const result = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.title, si.description,
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.booking_confirmation_sent_at,
              si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              ${assignmentSelect},
              si.completed_at, si.created_at, si.updated_at,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title,
              m.id AS meeting_id,
              m.scheduling_provider AS meeting_scheduling_provider,
              m.external_event_id AS meeting_external_event_id,
              mr.status AS room_status,
              ${workspaceSessionSelect},
              EXISTS (
                SELECT 1
                  FROM meeting_participants guest_mp
                 WHERE guest_mp.meeting_id = m.id
                   AND guest_mp.role = 'ATTENDEE'
                   AND guest_mp.joined_at IS NOT NULL
                   AND guest_mp.left_at IS NULL
                   AND COALESCE(mr.status, '') <> 'ENDED'
              ) AS guest_waiting
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       ${assignmentJoin}
       LEFT JOIN meetings m ON m.id = (
         SELECT lm.id
           FROM meetings lm
          WHERE lm.scheduled_interview_id = si.id
            AND lm.owner_id = si.owner_id
          ORDER BY lm.created_at DESC
          LIMIT 1
       )
       LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
       ${workspaceSessionJoin}
       WHERE si.owner_id = ?
       ORDER BY ${orderByClause}
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      title: string | null;
      description: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      external_event_id: string | null;
      recruiter_notes: string | null;
      sync_source: string | null;
      last_synced_at: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
      booking_confirmation_sent_at: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      assignment_repo_id: number | null;
      assignment_github_repo_url: string | null;
      assignment_github_pr_number: number | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
      meeting_id: string | null;
      meeting_scheduling_provider: string | null;
      meeting_external_event_id: string | null;
      room_status: string | null;
      workspace_status: string | null;
      workspace_error_message: string | null;
      workspace_expires_at: string | null;
      workspace_updated_at: string | null;
      workspace_repo_git_url: string | null;
      workspace_base_commit_sha: string | null;
      guest_waiting: number | null;
    }>();

  const rows = result.results ?? [];
  const assessmentInterviewIds = rows
    .filter((row) => isWorkspaceAssessmentInterviewType(row.interview_type))
    .map((row) => row.id);
  const assessmentProgressByInterviewId = await loadScheduledAssessmentProgressByInterviewIds(
    db,
    assessmentInterviewIds,
  );
  const candidateIdsNeedingPendingMatchDiagnostics = rows.flatMap((row) => {
    if (!isWorkspaceAssessmentInterviewType(row.interview_type)) return [];
    return row.candidate_id ? [row.candidate_id] : [];
  });
  const pendingMatchDiagnosticsByCandidateId = await loadPendingCodeReviewMatchDiagnosticsByCandidateIds(
    db,
    candidateIdsNeedingPendingMatchDiagnostics,
  );

  const interviews = rows.map((r) => {
    const assessmentProgress = assessmentProgressByInterviewId.get(r.id) ?? null;
    const matchedRepoId = r.matched_repo_id ?? r.assignment_repo_id;
    const githubRepoUrl = r.github_repo_url ?? r.assignment_github_repo_url;
    const githubPrNumber = r.github_pr_number ?? r.assignment_github_pr_number;
    const pendingMatchDiagnostic = r.candidate_id
      ? pendingMatchDiagnosticsByCandidateId.get(r.candidate_id) ?? null
      : null;
    const matchedRepoSource = r.matched_repo_id != null
      ? 'matched_repo_id'
      : r.assignment_repo_id != null
        ? 'candidate_challenge_assignment'
        : undefined;
    return {
      id: r.id,
      candidateId: r.candidate_id,
      pipelineId: r.pipeline_id,
      stageId: r.stage_id,
      title: r.title,
      description: r.description,
      interviewType: r.interview_type,
      meetingType: r.meeting_type,
      status: r.status,
      scheduledAt: r.scheduled_at,
      meetingUrl: buildInternalVideoUrl(c, r),
      schedulingProvider: r.scheduling_provider,
      schedulingUrl: r.scheduling_url,
      externalEventId: r.external_event_id,
      recruiterNotes: r.recruiter_notes,
      syncSource: r.sync_source,
      lastSyncedAt: r.last_synced_at,
      inviteLinkSentAt: r.invite_link_sent_at,
      emailSentAt: r.email_sent_at,
      bookingConfirmationSentAt: r.booking_confirmation_sent_at,
      recipientName: r.recipient_name,
      recipientEmail: r.recipient_email,
      matchedRepoId,
      githubRepoUrl,
      githubPrNumber,
      assessmentSetup: buildScheduledAssessmentSetup({
        interviewType: r.interview_type,
        candidateId: r.candidate_id,
        matchedRepoId,
        githubRepoUrl,
        githubPrNumber,
        matchedRepoSource,
        manualOpenSourceChallengePacket: assessmentProgress?.hasChallengePacket === true,
        pendingMatchDiagnostic,
      }),
      assessmentProgress,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      candidateName: r.candidate_name,
      candidateEmail: r.candidate_email,
      pipelineTitle: r.pipeline_title,
      stageTitle: r.stage_title,
      meetingId: r.meeting_id,
      meetingSchedulingProvider: r.meeting_scheduling_provider,
      meetingExternalEventId: r.meeting_external_event_id,
      roomStatus: r.room_status,
      guestWaiting: Boolean(r.guest_waiting),
      workspaceSession: buildWorkspaceSessionProjection(r),
    };
  });

  const nextOffset = offset + rows.length < total ? offset + rows.length : null;

  return c.json({
    interviews,
    pagination: {
      total,
      limit,
      offset,
      sort,
      nextOffset,
      hasMore: nextOffset !== null,
    },
  });
});

// GET /interviews/:id — scheduled interview detail
schedulingAuth.get('/interviews/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;
  const hasCandidateChallengeAssignments = await tableExists(db, 'candidate_challenge_assignment');
  const assignmentSelect = hasCandidateChallengeAssignments
    ? `cca.repo_id AS assignment_repo_id,
              cca.github_repo_url AS assignment_github_repo_url,
              cca.github_pr_number AS assignment_github_pr_number`
    : `NULL AS assignment_repo_id,
              NULL AS assignment_github_repo_url,
              NULL AS assignment_github_pr_number`;
  const assignmentJoin = hasCandidateChallengeAssignments
    ? `LEFT JOIN candidate_challenge_assignment cca ON cca.id = (
         SELECT latest_cca.id
           FROM candidate_challenge_assignment latest_cca
          WHERE latest_cca.candidate_id = si.candidate_id
            AND latest_cca.stage_id = si.stage_id
            AND latest_cca.github_repo_url IS NOT NULL
            AND latest_cca.github_pr_number IS NOT NULL
          ORDER BY latest_cca.assigned_at DESC, latest_cca.id DESC
          LIMIT 1
       )`
    : '';

  const interview = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.title, si.description,
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.booking_confirmation_sent_at,
              si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              ${assignmentSelect},
              si.submission_json, si.completed_at, si.created_at, si.updated_at,
              (
                SELECT rc.id
                FROM contacts rc
                WHERE rc.owner_id = si.owner_id
                  AND si.recipient_email IS NOT NULL
                  AND lower(rc.email) = lower(si.recipient_email)
                ORDER BY rc.updated_at DESC
                LIMIT 1
              ) AS recipient_contact_id,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       ${assignmentJoin}
       WHERE si.id = ? AND si.owner_id = ?`
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      title: string | null;
      description: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      external_event_id: string | null;
      recruiter_notes: string | null;
      sync_source: string | null;
      last_synced_at: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
      booking_confirmation_sent_at: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      assignment_repo_id: number | null;
      assignment_github_repo_url: string | null;
      assignment_github_pr_number: number | null;
      submission_json: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
      recipient_contact_id: string | null;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const effectiveMatchedRepoId = interview.matched_repo_id ?? interview.assignment_repo_id;
  const effectiveGithubRepoUrl = interview.github_repo_url ?? interview.assignment_github_repo_url;
  const effectiveGithubPrNumber = interview.github_pr_number ?? interview.assignment_github_pr_number;
  const effectiveMatchedRepoSource = interview.matched_repo_id != null
    ? 'matched_repo_id'
    : interview.assignment_repo_id != null
      ? 'candidate_challenge_assignment'
      : undefined;
  const effectiveCodeReviewInterview = {
    ...interview,
    matched_repo_id: effectiveMatchedRepoId,
    github_repo_url: effectiveGithubRepoUrl,
    github_pr_number: effectiveGithubPrNumber,
  };

  const transcriptArtifactPromise = optionalScheduledDetailProjection(
    'transcriptArtifact',
    db
    .prepare(
      `SELECT id, scheduled_interview_id, status, transcript_json, error_message,
              created_at, updated_at
       FROM transcript_artifacts
       WHERE scheduled_interview_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(id)
    .first<{
      id: string;
      scheduled_interview_id: string;
      status: string;
      transcript_json: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(),
    null,
  );

  const linkedMeetingPromise = optionalScheduledDetailProjection('linkedMeeting', (async () => {
    const hasWorkspaceSessions = await tableExists(db, 'dev_container_sessions');
    const workspaceSessionSelect = hasWorkspaceSessions
      ? `dcs.status AS workspace_status,
                dcs.error_message AS workspace_error_message,
                dcs.expires_at AS workspace_expires_at,
                dcs.updated_at AS workspace_updated_at,
                dcs.repo_git_url AS workspace_repo_git_url,
                dcs.base_commit_sha AS workspace_base_commit_sha`
      : `NULL AS workspace_status,
                NULL AS workspace_error_message,
                NULL AS workspace_expires_at,
                NULL AS workspace_updated_at,
                NULL AS workspace_repo_git_url,
                NULL AS workspace_base_commit_sha`;
    const workspaceSessionJoin = hasWorkspaceSessions
      ? `LEFT JOIN dev_container_sessions dcs ON dcs.id = (
           SELECT latest_dcs.id
             FROM dev_container_sessions latest_dcs
            WHERE latest_dcs.meeting_id = m.id
               OR latest_dcs.meeting_room_id = mr.id
            ORDER BY latest_dcs.updated_at DESC, latest_dcs.created_at DESC
            LIMIT 1
         )`
      : '';

    return db
      .prepare(
        `SELECT m.id, m.title, m.description, m.status, m.scheduled_at,
                m.started_at, m.ended_at, m.duration_secs, m.meeting_url,
                m.meeting_type, m.scheduling_provider, m.external_event_id,
                m.transcript_status, m.transcript_summary,
                m.transcript_json, m.transcript_analysis_json, m.transcript_error,
                m.recording_r2_key, m.created_at, m.updated_at,
                mr.id AS room_id, mr.session_id, mr.status AS room_status,
                ${workspaceSessionSelect},
                EXISTS (
                  SELECT 1
                    FROM meeting_participants guest_mp
                   WHERE guest_mp.meeting_id = m.id
                     AND guest_mp.role = 'ATTENDEE'
                     AND guest_mp.joined_at IS NOT NULL
                     AND guest_mp.left_at IS NULL
                     AND COALESCE(mr.status, '') <> 'ENDED'
                ) AS guest_waiting
         FROM meetings m
         LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
         ${workspaceSessionJoin}
         WHERE m.scheduled_interview_id = ? AND m.owner_id = ?
         ORDER BY m.created_at DESC
         LIMIT 1`
      )
      .bind(id, userId)
      .first<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        scheduled_at: string | null;
        started_at: string | null;
        ended_at: string | null;
        duration_secs: number | null;
        meeting_url: string | null;
        meeting_type: string;
        scheduling_provider: string | null;
        external_event_id: string | null;
        transcript_status: string;
        transcript_summary: string | null;
        transcript_json: string | null;
        transcript_analysis_json: string | null;
        transcript_error: string | null;
        recording_r2_key: string | null;
        created_at: string;
        updated_at: string;
        room_id: string | null;
        session_id: string | null;
        room_status: string | null;
        guest_waiting: number | null;
        workspace_status: string | null;
        workspace_error_message: string | null;
        workspace_expires_at: string | null;
        workspace_updated_at: string | null;
        workspace_repo_git_url: string | null;
        workspace_base_commit_sha: string | null;
      }>();
  })(), null);

  const livingContextPromise = optionalScheduledDetailProjection(
    'livingContext',
    loadScheduledInterviewLivingContext(db, userId, interview),
    null,
  );
  const relatedEvidenceInterviewsPromise = livingContextPromise.then((livingContext) =>
    optionalScheduledDetailProjection(
      'relatedEvidenceInterviews',
      loadRelatedEvidenceInterviews(
        db,
        userId,
        interview.id,
        livingContext,
      ),
      [],
    )
  );
  const codeReviewMatchPromise = optionalScheduledDetailProjection(
    'codeReviewMatch',
    loadScheduledCodeReviewMatchDetail(db, effectiveCodeReviewInterview),
    null,
    6_000,
  );
  const codeReviewScorePromise = optionalScheduledDetailProjection(
    'codeReviewScore',
    loadScheduledCodeReviewScoreSummary(db, interview),
    null,
    6_000,
  );
  const assessmentProgressPromise = optionalScheduledDetailProjection(
    'assessmentProgress',
    loadScheduledAssessmentProgress(db, interview.id),
    null,
  );
  const assessmentInviteLinkPromise = (async () =>
    await loadLatestDeliveredAssessmentUrl(db, interview.id, interview.candidate_id)
      ?? await loadCandidateAssessmentInviteLinkFromToken(db, c.env, {
        interviewType: interview.interview_type,
        candidateId: interview.candidate_id,
      }))();
  const safeAssessmentInviteLinkPromise = optionalScheduledDetailProjection(
    'assessmentInviteLink',
    assessmentInviteLinkPromise,
    null,
  );
  const pendingMatchDiagnosticPromise = isWorkspaceAssessmentInterviewType(interview.interview_type)
    && interview.candidate_id
    ? loadPendingCodeReviewMatchDiagnosticsByCandidateIds(db, [interview.candidate_id])
      .then((diagnostics) => diagnostics.get(interview.candidate_id!) ?? null)
    : Promise.resolve(null);

  const [
    transcriptArtifact,
    linkedMeeting,
    livingContext,
    relatedEvidenceInterviews,
    codeReviewMatch,
    codeReviewScore,
    assessmentProgress,
    assessmentInviteLink,
    pendingMatchDiagnostic,
  ] = await Promise.all([
    transcriptArtifactPromise,
    linkedMeetingPromise,
    livingContextPromise,
    relatedEvidenceInterviewsPromise,
    codeReviewMatchPromise,
    codeReviewScorePromise,
    assessmentProgressPromise,
    safeAssessmentInviteLinkPromise,
    pendingMatchDiagnosticPromise,
  ]);

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      contactId: interview.recipient_contact_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
      title: interview.title,
      description: interview.description,
      interviewType: interview.interview_type ?? 'VIDEO',
      meetingType: interview.meeting_type,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      meetingUrl: buildInternalVideoUrl(c, interview),
      schedulingProvider: interview.scheduling_provider,
      schedulingUrl: interview.scheduling_url,
      externalEventId: interview.external_event_id,
      recruiterNotes: interview.recruiter_notes,
      syncSource: interview.sync_source,
      lastSyncedAt: interview.last_synced_at,
      inviteLinkSentAt: interview.invite_link_sent_at,
      emailSentAt: interview.email_sent_at,
      bookingConfirmationSentAt: interview.booking_confirmation_sent_at,
      recipientName: interview.recipient_name,
      recipientEmail: interview.recipient_email,
      candidateName: interview.candidate_name,
      candidateEmail: interview.candidate_email,
      pipelineTitle: interview.pipeline_title,
      stageTitle: interview.stage_title,
      matchedRepoId: effectiveMatchedRepoId,
      githubRepoUrl: effectiveGithubRepoUrl,
      githubPrNumber: effectiveGithubPrNumber,
      assessmentSetup: buildScheduledAssessmentSetup({
        interviewType: interview.interview_type,
        candidateId: interview.candidate_id,
        matchedRepoId: effectiveMatchedRepoId,
        githubRepoUrl: effectiveGithubRepoUrl,
        githubPrNumber: effectiveGithubPrNumber,
        matchedRepoSource: effectiveMatchedRepoSource,
        manualOpenSourceChallengePacket: assessmentProgress?.hasChallengePacket === true,
        pendingMatchDiagnostic,
        lastDeliveredUrl: assessmentInviteLink?.url ?? null,
        lastDeliveredUrlState: assessmentInviteLink?.state ?? null,
        lastDeliveredUrlMessage: assessmentInviteLink?.message ?? null,
      }),
      submissionJson: interview.submission_json,
      completedAt: interview.completed_at,
      transcriptArtifact: transcriptArtifact ? {
        id: transcriptArtifact.id,
        interviewId: transcriptArtifact.scheduled_interview_id,
        status: transcriptArtifact.status,
        transcriptJson: transcriptArtifact.transcript_json,
        errorMessage: transcriptArtifact.error_message,
        createdAt: transcriptArtifact.created_at,
        updatedAt: transcriptArtifact.updated_at,
      } : null,
      linkedMeeting: linkedMeeting ? {
        id: linkedMeeting.id,
        title: linkedMeeting.title,
        description: linkedMeeting.description,
        status: linkedMeeting.status,
        scheduledAt: linkedMeeting.scheduled_at,
        startedAt: linkedMeeting.started_at,
        endedAt: linkedMeeting.ended_at,
        durationSecs: linkedMeeting.duration_secs,
        meetingUrl: linkedMeeting.meeting_url
          ? withDevBasicAuth(linkedMeeting.meeting_url, c.env)
          : null,
        meetingType: linkedMeeting.meeting_type,
        schedulingProvider: linkedMeeting.scheduling_provider,
        externalEventId: linkedMeeting.external_event_id,
        transcriptStatus: linkedMeeting.transcript_status,
        transcriptSummary: linkedMeeting.transcript_summary,
        transcriptJson: linkedMeeting.transcript_json,
        transcriptAnalysisJson: linkedMeeting.transcript_analysis_json,
        transcriptError: linkedMeeting.transcript_error,
        recordingR2Key: linkedMeeting.recording_r2_key,
        room: linkedMeeting.room_id ? {
          id: linkedMeeting.room_id,
          sessionId: linkedMeeting.session_id,
          status: linkedMeeting.room_status,
          guestWaiting: Boolean(linkedMeeting.guest_waiting),
        } : null,
        createdAt: linkedMeeting.created_at,
        updatedAt: linkedMeeting.updated_at,
      } : null,
      roomStatus: linkedMeeting?.room_status ?? null,
      guestWaiting: Boolean(linkedMeeting?.guest_waiting),
      workspaceSession: linkedMeeting ? buildWorkspaceSessionProjection(linkedMeeting) : null,
      livingContext: redactScheduledInterviewLivingContext(livingContext),
      relatedEvidenceInterviews,
      codeReviewMatch,
      codeReviewScore,
      assessmentProgress,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
});

// GET /interviews/:id/assessment/evidence-bundle — recruiter audit packet for source-backed assessment output
schedulingAuth.get('/interviews/:id/assessment/evidence-bundle', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db.prepare(
    `SELECT id, title, description, interview_type, recipient_name, recipient_email,
            candidate_id, created_at, updated_at
       FROM scheduled_interviews
      WHERE id = ?1
        AND owner_id = ?2
      LIMIT 1`,
  ).bind(id, userId).first<{
    id: string;
    title: string | null;
    description: string | null;
    interview_type: string | null;
    recipient_name: string | null;
    recipient_email: string | null;
    candidate_id: string | null;
    created_at: string;
    updated_at: string;
  }>();
  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const sessionId = await loadScheduledAssessmentSessionId(db, id);
  if (!sessionId) {
    return apiError(
      c,
      'CONFLICT',
      'This interview is not linked to an assessment session yet.',
    );
  }

  try {
    const bundle = await loadAssessmentEvidenceBundle({
      db,
      interview,
      sessionId,
    });
    return c.json({ bundle }, 200);
  } catch (error) {
    console.error('[scheduling/loadAssessmentEvidenceBundle] failed:', {
      interviewId: id,
      assessmentSessionId: sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError(c, 'SERVER_ERROR', 'Unable to load assessment evidence bundle.');
  }
});

// POST /interviews/:id/assessment/start-evaluation — recruiter requests source-backed assessment
schedulingAuth.post('/interviews/:id/assessment/start-evaluation', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db.prepare(
    `SELECT id
       FROM scheduled_interviews
      WHERE id = ?1
        AND owner_id = ?2
      LIMIT 1`,
  ).bind(id, userId).first<{ id: string }>();
  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const sessionId = await loadScheduledAssessmentSessionId(db, id);
  if (!sessionId) {
    return apiError(
      c,
      'CONFLICT',
      'This interview is not linked to an assessment session yet.',
    );
  }

  const store = new RepoTaskInterviewSessionStore(db);
  try {
    const currentProgress = await store.loadProgress(sessionId);
    if (currentProgress.nextAction !== 'START_EVALUATION') {
      if (currentProgress.nextAction === 'WAIT_FOR_EVALUATION') {
        return c.json({
          progress: currentProgress,
          report: null,
          diagnostic: null,
          accepted: true,
        }, 202);
      }
      if (currentProgress.nextAction === 'REVIEW_EVALUATION' && currentProgress.evaluation) {
        return c.json({
          progress: currentProgress,
          report: currentProgress.evaluation,
          diagnostic: null,
          accepted: true,
          alreadyEvaluated: true,
        }, 200);
      }
      return apiError(
        c,
        'CONFLICT',
        `Assessment is not ready for evaluation; next action is ${currentProgress.nextAction}.`,
      );
    }

    const requestedAt = new Date().toISOString();
    const exactText = [
      `Recruiter ${userId} requested source-backed evaluation for scheduled interview ${id}.`,
      `Assessment session: ${sessionId}.`,
      'Result: PIPE will evaluate only source-backed challenge, commit, diff, test, transcript, chat, terminal, and AI evidence.',
    ].join('\n');
    const contentHash = await deterministicEntityId('content', exactText);
    const requestSourceRef: AssessmentEvidenceSourceRefInput = {
      sourceRefType: 'assessment_evaluation_request',
      sourceRefId: `scheduled-interview:${id}:evaluation-request:${contentHash}`,
      evidenceRole: 'evaluation_request',
      locator: {
        scheduledInterviewId: id,
        assessmentSessionId: sessionId,
        requestedBy: userId,
        requestedAt,
        route: '/api/v1/scheduling/interviews/:id/assessment/start-evaluation',
      },
      exactText,
      contentHash,
    };

    const requestEvent = await store.recordEvent({
      sessionId,
      ingestionKey: `assessment-event:${sessionId}:evaluation-request:${contentHash}`,
      kind: 'recruiter_note',
      actorType: 'recruiter',
      actorId: userId,
      narrative: 'Recruiter requested source-backed assessment evaluation.',
      payload: {
        scheduledInterviewId: id,
        action: 'start_evaluation',
        evaluatorStatus: 'source_backed_evaluator_requested',
      },
      occurredAt: requestedAt,
      sourceRefs: [requestSourceRef],
    });

    await store.transitionState({
      sessionId,
      toState: 'EVALUATING',
      reason: 'Recruiter requested source-backed assessment evaluation.',
      eventId: requestEvent.id,
      createdBy: userId,
    });

    const evaluationJob = evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: c.env,
      sessionId,
      scheduledInterviewId: id,
      requestedBy: userId,
      requestedAt,
      requestEventId: requestEvent.id,
      requestSourceRef,
    }).catch(async (error) => {
      console.error('[scheduling/startAssessmentEvaluation] background evaluation failed:', {
        interviewId: id,
        assessmentSessionId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      await store.transitionState({
        sessionId,
        toState: 'DIAGNOSTIC',
        reason: 'Source-backed assessment evaluation failed before producing a report.',
        eventId: requestEvent.id,
        createdBy: userId,
      });
    });

    let backgrounded = false;
    const executionCtx = c.executionCtx as ExecutionContext | undefined;
    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(evaluationJob);
      backgrounded = true;
    } else {
      await evaluationJob;
    }
    const progress = await store.loadProgress(sessionId);
    return c.json({
      progress,
      report: null,
      diagnostic: null,
      accepted: true,
      backgrounded,
    }, backgrounded ? 202 : 200);
  } catch (error) {
    console.error('[scheduling/startAssessmentEvaluation] failed:', {
      interviewId: id,
      assessmentSessionId: sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError(c, 'SERVER_ERROR', 'Unable to start assessment evaluation.');
  }
});

// POST /interviews/:id/assessment/human-decision — recruiter records source-backed final decision
schedulingAuth.post('/interviews/:id/assessment/human-decision', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;
  const body = recordHumanAssessmentDecisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid human assessment decision body.');
  }

  const interview = await db.prepare(
    `SELECT id
       FROM scheduled_interviews
      WHERE id = ?1
        AND owner_id = ?2
      LIMIT 1`,
  ).bind(id, userId).first<{ id: string }>();
  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const sessionId = await loadScheduledAssessmentSessionId(db, id);
  if (!sessionId) {
    return apiError(c, 'CONFLICT', 'This interview is not linked to an assessment session yet.');
  }

  const latestReport = await loadLatestAssessmentEvaluationReport(db, sessionId);
  if (!latestReport) {
    return apiError(c, 'CONFLICT', 'Run source-backed assessment evaluation before recording a human decision.');
  }
  if (latestReport.status !== 'EVALUATED') {
    return apiError(c, 'CONFLICT', 'Resolve assessment diagnostics and produce an evaluated source-backed report before recording a human decision.');
  }

  const store = new RepoTaskInterviewSessionStore(db);
  try {
    const occurredAt = new Date().toISOString();
    const reportSummaryHash = await sha256Hex(latestReport.summary);
    const notes = body.data.notes?.trim() || null;
    const decisionKeyHash = await sha256Hex([
      sessionId,
      latestReport.id,
      userId,
      body.data.decision,
      body.data.summary,
      notes ?? '',
    ].join('\n'));
    const reportSourceRef: AssessmentEvidenceSourceRefInput = {
      sourceRefType: 'assessment_evaluation_report',
      sourceRefId: latestReport.id,
      evidenceRole: 'human_decision_basis',
      locator: {
        scheduledInterviewId: id,
        assessmentSessionId: sessionId,
        reportId: latestReport.id,
        reportStatus: latestReport.status,
        route: '/api/v1/scheduling/interviews/:id/assessment/human-decision',
      },
      exactText: latestReport.summary,
      contentHash: reportSummaryHash,
      metadata: {
        reportStatus: latestReport.status,
      },
    };

    const decision = await store.recordHumanDecision({
      sessionId,
      ingestionKey: `assessment-event:${sessionId}:human-decision:${decisionKeyHash}`,
      decision: body.data.decision,
      reviewerId: userId,
      summary: body.data.summary,
      notes,
      occurredAt,
      sourceRefs: [reportSourceRef],
    });
    const progress = await store.loadProgress(sessionId);

    return c.json({ decision, progress }, 201);
  } catch (error) {
    console.error('[scheduling/recordHumanAssessmentDecision] failed:', {
      interviewId: id,
      assessmentSessionId: sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError(c, 'SERVER_ERROR', 'Unable to record human assessment decision.');
  }
});

// POST /interviews/sync — retained for older clients; Calendly bookings arrive via webhooks.
schedulingAuth.post('/interviews/sync', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  // Get active Calendly connection
  const conn = await db
    .prepare(
      `SELECT id, access_token, provider_id, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE' AND provider_id = 'CALENDLY' LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string; access_token: string; provider_id: string; token_expiry: string | null; refresh_token: string | null }>();

  if (!conn) {
    return c.json({ synced: 0, message: 'No active scheduling connection.' });
  }

  const now = new Date().toISOString();
  await db
    .prepare('UPDATE scheduling_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, conn.id)
    .run();

  return c.json({
    synced: 0,
    total: 0,
    created: 0,
    message: 'Calendly bookings sync from provider webhooks.',
  });
});

// POST /interviews — create scheduled interview
schedulingAuth.post('/interviews', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = createInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const {
    candidateId,
    pipelineId,
    stageId,
    title,
    description,
    recipientName,
    recipientEmail,
    meetingType,
    interviewType,
    scheduledAt,
    schedulingProvider,
    schedulingUrl,
    matchedRepoId,
    githubRepoUrl,
    githubPrNumber,
    challengeBaseCommitSha,
    challengeTitle,
    challengeInstructions,
    challengeSuccessCriteria,
    challengeExpectedEvidence,
    challengeVerificationCommand,
    recruiterNotes,
  } = parsed.data;

  let candidate: { id: string; pipeline_id: string | null } | null = null;
  if (candidateId) {
    candidate = await db
      .prepare('SELECT id, pipeline_id FROM candidates WHERE id = ? AND owner_id = ?')
      .bind(candidateId, userId)
      .first<{ id: string; pipeline_id: string | null }>();
    if (!candidate) return apiError(c, 'NOT_FOUND', 'Person not found.');
  }

  if (stageId && !pipelineId) {
    return apiError(c, 'VALIDATION_ERROR', 'stageId requires pipelineId.');
  }

  if (pipelineId) {
    if (!candidate) {
      return apiError(c, 'VALIDATION_ERROR', 'pipelineId requires candidateId.');
    }
    const pipeline = await db
      .prepare('SELECT id, title FROM pipelines WHERE id = ? AND owner_id = ?')
      .bind(pipelineId, userId)
      .first<{ id: string; title: string }>();
    if (!pipeline) return apiError(c, 'NOT_FOUND', 'Role not found.');

    if (candidate.pipeline_id && candidate.pipeline_id !== pipelineId) {
      return apiError(c, 'VALIDATION_ERROR', 'Person belongs to a different role.');
    }

    if (stageId) {
      const stage = await db
        .prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?')
        .bind(stageId, pipelineId)
        .first<{ id: string }>();
      if (!stage) return apiError(c, 'NOT_FOUND', 'Round not found.');
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const effectiveMeetingType = meetingType ?? (candidateId ? 'SCREENING_INTERVIEW' : 'DIRECT_VIDEO_CALL');
  const effectiveInterviewType = interviewType ?? 'VIDEO';
  const sanitizedSchedulingUrl = sanitizeProviderSchedulingUrl(
    schedulingUrl ?? null,
    schedulingProvider ?? null,
  );
  const hasManualOpenSourceTaskPacket = hasManualOpenSourceChallengePacket({
    interviewType: effectiveInterviewType,
    githubRepoUrl,
    githubPrNumber,
    challengeBaseCommitSha,
    challengeTitle,
    challengeInstructions,
    challengeSuccessCriteria,
    challengeExpectedEvidence,
    challengeVerificationCommand,
  });
  if (hasManualOpenSourceTaskPacket) {
    const commitVerification = await verifyGitHubCommitReachable({
      repositoryUrl: githubRepoUrl!,
      commitSha: challengeBaseCommitSha!,
      githubToken: c.env.GITHUB_TOKEN,
    });
    if (!commitVerification.ok) {
      if (commitVerification.reason === 'not_found') {
        return apiError(
          c,
          'VALIDATION_ERROR',
          'challengeBaseCommitSha must exist in githubRepoUrl and be reachable by PIPE.',
        );
      }
      return apiError(
        c,
        'SERVICE_UNAVAILABLE',
        'Could not verify challengeBaseCommitSha against GitHub. Try again or choose a reachable commit.',
      );
    }
  }
  let matchedOpenSourceChallengePacket: MatchedOpenSourceChallengePacket | null = null;
  let effectiveGithubRepoUrl = githubRepoUrl ?? null;
  let effectiveGithubPrNumber = githubPrNumber ?? null;
  if (
    effectiveInterviewType === 'OPEN_SOURCE_BUG_FIX'
    && matchedRepoId
    && !hasManualOpenSourceTaskPacket
    && !effectiveGithubRepoUrl
    && !effectiveGithubPrNumber
  ) {
    matchedOpenSourceChallengePacket = await loadMatchedOpenSourceChallengePacket(db, matchedRepoId);
    if (matchedOpenSourceChallengePacket) {
      effectiveGithubRepoUrl = matchedOpenSourceChallengePacket.repositoryUrl;
      effectiveGithubPrNumber = matchedOpenSourceChallengePacket.githubPrNumber;
    }
  }
  const assessmentSetup = buildScheduledAssessmentSetup({
    interviewType: effectiveInterviewType,
    candidateId: candidateId ?? null,
    matchedRepoId: matchedRepoId ?? null,
    githubRepoUrl: effectiveGithubRepoUrl,
    githubPrNumber: effectiveGithubPrNumber,
    manualOpenSourceChallengePacket: hasManualOpenSourceTaskPacket,
  });
  const interviewCopy = normalizeScheduledInterviewCopy({
    title,
    description,
    interviewType: effectiveInterviewType,
    challengeTitle,
    challengeInstructions,
    matchedOpenSourceChallengePacket,
  });
  const contactId = !candidateId && recipientName && recipientEmail
    ? await ensureRecipientContact(db, userId, { name: recipientName, email: recipientEmail })
    : null;
  let assessmentProgress: AssessmentProgressSnapshot | null = null;

  await db
    .prepare(
      `INSERT INTO scheduled_interviews
       (id, candidate_id, pipeline_id, stage_id, owner_id, status,
        title, description,
        interview_type, meeting_type, scheduled_at, scheduling_provider,
        scheduling_url, recipient_name, recipient_email, sync_source,
        matched_repo_id, github_repo_url, github_pr_number,
        recruiter_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, candidateId ?? null, pipelineId ?? null, stageId ?? null, userId,
      interviewCopy.title, interviewCopy.description,
      effectiveInterviewType, effectiveMeetingType, scheduledAt ?? null,
      schedulingProvider ?? null, sanitizedSchedulingUrl,
      recipientName ?? null, recipientEmail?.trim().toLowerCase() ?? null,
      matchedRepoId ?? null, effectiveGithubRepoUrl, effectiveGithubPrNumber,
      recruiterNotes ?? null,
      now, now,
    )
    .run();

  if (contactId && recipientName && recipientEmail) {
    await persistContactFirstInterviewInviteContext(db, {
      contactId,
      ownerId: userId,
      interviewId: id,
      recipientName,
      recipientEmail: recipientEmail.trim().toLowerCase(),
      meetingType: effectiveMeetingType,
      interviewType: effectiveInterviewType,
      assessmentSetup,
      scheduledAt: scheduledAt ?? null,
      schedulingProvider: schedulingProvider ?? null,
      schedulingUrl: sanitizedSchedulingUrl,
      recruiterNotes: recruiterNotes ?? null,
      createdAt: now,
    });
  }

  if (hasManualOpenSourceTaskPacket) {
    assessmentProgress = await createManualOpenSourceChallengeAssessmentSession(db, {
      interviewId: id,
      userId,
      candidateId: candidateId ?? null,
      repositoryUrl: githubRepoUrl!,
      githubPrNumber: githubPrNumber ?? null,
      baseCommitSha: challengeBaseCommitSha!,
      title: challengeTitle!,
      instructions: challengeInstructions!,
      successCriteria: challengeSuccessCriteria!,
      expectedEvidence: challengeExpectedEvidence!,
      verificationCommand: challengeVerificationCommand ?? null,
      createdAt: now,
    });
  } else if (matchedOpenSourceChallengePacket && typeof matchedRepoId === 'number') {
    assessmentProgress = await createMatchedOpenSourceChallengeAssessmentSession(db, {
      interviewId: id,
      userId,
      candidateId: candidateId ?? null,
      matchedRepoId,
      packet: matchedOpenSourceChallengePacket,
      createdAt: now,
    });
  }
  assessmentProgress = normalizeScheduledAssessmentProgressAssignmentTrust(assessmentProgress);

  return c.json({
    interview: {
      id,
      candidateId: candidateId ?? null,
      contactId,
      pipelineId: pipelineId ?? null,
      stageId: stageId ?? null,
      title: interviewCopy.title,
      description: interviewCopy.description,
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail?.trim().toLowerCase() ?? null,
      meetingType: effectiveMeetingType,
      status: 'INVITED',
      interviewType: effectiveInterviewType,
      scheduledAt: scheduledAt ?? null,
      schedulingProvider: schedulingProvider ?? null,
      schedulingUrl: sanitizedSchedulingUrl,
      matchedRepoId: matchedRepoId ?? null,
      githubRepoUrl: effectiveGithubRepoUrl,
      githubPrNumber: effectiveGithubPrNumber,
      recruiterNotes: recruiterNotes ?? null,
      assessmentSetup,
      assessmentProgress,
    },
  }, 201);
});

// POST /interviews/:id/context-call — create a follow-up call for blocked CODE_REVIEW matching
schedulingAuth.post('/interviews/:id/context-call', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const source = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.interview_type,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              si.recipient_name, si.recipient_email,
              c.name AS candidate_name, c.email AS candidate_email
         FROM scheduled_interviews si
         LEFT JOIN candidates c ON c.id = si.candidate_id
        WHERE si.id = ?1 AND si.owner_id = ?2`,
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      interview_type: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      recipient_name: string | null;
      recipient_email: string | null;
      candidate_name: string | null;
      candidate_email: string | null;
    }>();

  if (!source) return apiError(c, 'NOT_FOUND', 'Interview not found.');
  if (source.interview_type !== 'CODE_REVIEW') {
    return apiError(c, 'VALIDATION_ERROR', 'Context calls can only be created from code-review interviews.');
  }

  const match = await loadScheduledCodeReviewMatchDetail(db, {
    id: source.id,
    candidate_id: source.candidate_id,
    interview_type: source.interview_type,
    matched_repo_id: source.matched_repo_id,
    github_repo_url: source.github_repo_url,
    github_pr_number: source.github_pr_number,
  });
  if (match?.status === 'MATCHED') {
    return apiError(c, 'VALIDATION_ERROR', 'This code review already has a matched PR challenge.');
  }

  const personName = source.candidate_name ?? source.recipient_name ?? source.candidate_email ?? source.recipient_email;
  const personEmail = source.candidate_email ?? source.recipient_email;
  if (!personName || !personEmail) {
    return apiError(c, 'VALIDATION_ERROR', 'A name and email are required before creating a context call.');
  }

  const existingFollowUp = await loadCodeReviewEvidenceFollowUp(db, source.id, source.candidate_id);
  if (existingFollowUp?.contextCallInterviewId) {
    const existingContextCall = await db.prepare(
      `SELECT id, candidate_id, recruiter_notes
         FROM scheduled_interviews
        WHERE id = ?1 AND owner_id = ?2
        LIMIT 1`,
    ).bind(existingFollowUp.contextCallInterviewId, userId).first<{
      id: string;
      candidate_id: string | null;
      recruiter_notes: string | null;
    }>();

    if (existingContextCall) {
      return c.json({
        contextCall: {
          id: existingContextCall.id,
          originalInterviewId: source.id,
          candidateId: existingContextCall.candidate_id ?? source.candidate_id,
          contactId: null,
          evidenceAssessmentSessionId: existingFollowUp.assessmentSessionId,
          questions: existingFollowUp.questions.length > 0
            ? existingFollowUp.questions
            : [...CONTEXT_CALL_QUESTIONS],
          recruiterNotes: existingContextCall.recruiter_notes ?? '',
          reused: true,
        },
      }, 200);
    }
  }

  const contextCallId = crypto.randomUUID();
  const now = new Date().toISOString();
  const gaps = match?.gaps.filter((gap) => gap.trim().length > 0) ?? [];
  const matchStatus = match?.status ?? 'NO_MATCH_DATA';
  const matchSummary = match?.summary ?? 'No source-backed match record was available when the context call was requested.';
  const evidencePlan = buildCodeReviewEvidencePlan({
    matchStatus,
    matchRunId: match?.matchRunId ?? null,
    gaps,
  });
  const questions = codeReviewContextCallQuestionsForPlan(evidencePlan);
  const recruiterNotes = [
    'PIPE context call for blocked code-review matching.',
    `Original CODE_REVIEW interview: ${source.id}`,
    `Match status: ${matchStatus}`,
    `Match summary: ${matchSummary}`,
    ...(gaps.length > 0
      ? gaps.map((gap, index) => `Evidence gap ${index + 1}: ${gap}`)
      : ['Evidence gap: none recorded']),
    'Suggested questions:',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join('\n');

  const contactId = source.candidate_id
    ? null
    : await ensureRecipientContact(db, userId, {
        name: personName,
        email: personEmail,
      });

  await db
    .prepare(
      `INSERT INTO scheduled_interviews
       (id, candidate_id, pipeline_id, stage_id, owner_id, status,
        interview_type, meeting_type, scheduled_at, scheduling_provider,
        scheduling_url, recipient_name, recipient_email, recruiter_notes,
        sync_source, matched_repo_id, github_repo_url, github_pr_number,
        created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, ?4, 'INVITED',
        'VIDEO', 'SCREENING_INTERVIEW', NULL, 'MANUAL',
        NULL, ?5, ?6, ?7,
        'MANUAL', NULL, NULL, NULL,
        ?8, ?8)`,
    )
    .bind(
      contextCallId,
      source.candidate_id,
      source.pipeline_id,
      userId,
      source.candidate_id ? null : personName,
      source.candidate_id ? null : personEmail.trim().toLowerCase(),
      recruiterNotes,
      now,
    )
    .run();

  const evidenceAssessmentSessionId = await persistCodeReviewContextCallRecommendation(db, {
    ownerId: userId,
    candidateId: source.candidate_id,
    contactId,
    originalInterviewId: source.id,
    contextCallInterviewId: contextCallId,
    personName,
    personEmail: personEmail.trim().toLowerCase(),
    matchRunId: match?.matchRunId ?? null,
    matchStatus,
    matchSummary,
    gaps,
    questions,
    createdAt: now,
  });

  return c.json({
    contextCall: {
      id: contextCallId,
      originalInterviewId: source.id,
      candidateId: source.candidate_id,
      contactId,
      evidenceAssessmentSessionId,
      questions,
      recruiterNotes,
    },
  }, 201);
});

// POST /interviews/:id/code-review-match/refresh — rerun deterministic PR matching after evidence call completion
schedulingAuth.post('/interviews/:id/code-review-match/refresh', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const source = await db.prepare(
    `SELECT si.id, si.candidate_id, si.pipeline_id, si.interview_type,
            si.matched_repo_id, si.github_repo_url, si.github_pr_number
       FROM scheduled_interviews si
      WHERE si.id = ?1 AND si.owner_id = ?2`,
  ).bind(id, userId).first<{
    id: string;
    candidate_id: string | null;
    pipeline_id: string | null;
    interview_type: string | null;
    matched_repo_id: number | null;
    github_repo_url: string | null;
    github_pr_number: number | null;
  }>();

  if (!source) return apiError(c, 'NOT_FOUND', 'Interview not found.');
  if (source.interview_type !== 'CODE_REVIEW') {
    return apiError(c, 'VALIDATION_ERROR', 'Only code-review interviews can refresh repo matching.');
  }
  if (!source.candidate_id) {
    return apiError(c, 'VALIDATION_ERROR', 'A candidate-backed interview is required before refreshing repo matching.');
  }

  let evidenceRefresh = await loadCodeReviewEvidenceRefresh(db, source.id, source.candidate_id);
  if (!evidenceRefresh) {
    return apiError(c, 'CONFLICT', 'A completed evidence-plan follow-up is required before refreshing repo matching.');
  }
  if (evidenceRefresh.matcherContextCount <= 0) {
    const repairedContextCount = await repairCodeReviewEvidenceRefreshMatcherContexts(db, {
      evidenceRefresh,
      originalInterviewId: source.id,
      candidateId: source.candidate_id,
    });
    if (repairedContextCount > 0) {
      evidenceRefresh = {
        ...evidenceRefresh,
        matcherContextCount: repairedContextCount,
      };
    }
  }
  if (evidenceRefresh.matcherContextCount <= 0) {
    return apiError(
      c,
      'CONFLICT',
      'Completed evidence-plan follow-up evidence must be projected into matcher context before refreshing repo matching.',
    );
  }
  const latestMatchRun = await loadLatestCandidateMatchRun(db, source.candidate_id);
  if (evidenceRefreshAlreadyTried(evidenceRefresh, latestMatchRun)) {
    return apiError(
      c,
      'CONFLICT',
      'This evidence refresh has already been tried. Capture new source-backed evidence before rerunning repo matching.',
    );
  }

  const matchOptions = await loadScheduledCodeReviewMatchOptions(db, source.pipeline_id);
  const match = await d1Matcher.matchCandidateToReviewChallenge(db, source.candidate_id, matchOptions);
  if (match.status !== 'MATCHED' || !match.repoId || !match.prNumber) {
    await recordCodeReviewEvidenceRefreshConsumption(db, {
      evidenceRefresh,
      originalInterviewId: source.id,
      candidateId: source.candidate_id,
      refreshed: false,
      consumedByMatchRunId: match.matchRunId,
      consumedByMatchStatus: match.status,
      consumedAt: new Date().toISOString(),
    });
    const codeReviewMatch = await loadScheduledCodeReviewMatchDetail(db, {
      id: source.id,
      candidate_id: source.candidate_id,
      interview_type: source.interview_type,
      matched_repo_id: source.matched_repo_id,
      github_repo_url: source.github_repo_url,
      github_pr_number: source.github_pr_number,
    });

    return c.json({
      refreshed: false,
      status: match.status,
      matchRunId: match.matchRunId,
      evidenceRefresh,
      codeReviewMatch,
    });
  }

  const repo = await db.prepare(
    `SELECT github_url FROM qualified_repos WHERE id = ?1`,
  ).bind(match.repoId).first<{ github_url: string | null }>();
  if (!repo?.github_url) {
    return apiError(c, 'CONFLICT', 'The refreshed match selected a repository that is not available.');
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE scheduled_interviews
        SET matched_repo_id = ?1,
            github_repo_url = ?2,
            github_pr_number = ?3,
            updated_at = ?4
      WHERE id = ?5 AND owner_id = ?6`,
  ).bind(match.repoId, repo.github_url, match.prNumber, now, source.id, userId).run();

  await recordCodeReviewEvidenceRefreshConsumption(db, {
    evidenceRefresh,
    originalInterviewId: source.id,
    candidateId: source.candidate_id,
    refreshed: true,
    consumedByMatchRunId: match.matchRunId,
    consumedByMatchStatus: match.status,
    repoId: match.repoId,
    repoUrl: repo.github_url,
    prNumber: match.prNumber,
    consumedAt: now,
  });

  const codeReviewMatch = await loadScheduledCodeReviewMatchDetail(db, {
    id: source.id,
    candidate_id: source.candidate_id,
    interview_type: source.interview_type,
    matched_repo_id: match.repoId,
    github_repo_url: repo.github_url,
    github_pr_number: match.prNumber,
  });

  return c.json({
    refreshed: true,
    status: match.status,
    matchRunId: match.matchRunId,
    repoId: match.repoId,
    repoUrl: repo.github_url,
    prNumber: match.prNumber,
    evidenceRefresh,
    codeReviewMatch,
  });
});

// PATCH /interviews/:id — update interview
schedulingAuth.patch('/interviews/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db
    .prepare(
      'SELECT id, status FROM scheduled_interviews WHERE id = ? AND owner_id = ?'
    )
    .bind(id, userId)
    .first<{ id: string; status: string }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const body = await c.req.json();
  const parsed = updateInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  if (parsed.data.status && !canInterviewStatusTransition(interview.status, parsed.data.status)) {
    return apiError(c, 'VALIDATION_ERROR',
      `Cannot transition from ${interview.status} to ${parsed.data.status}`);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.status) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.scheduledAt) {
    updates.push('scheduled_at = ?');
    values.push(parsed.data.scheduledAt);
  }
  if (parsed.data.meetingUrl) {
    updates.push('meeting_url = ?');
    values.push(parsed.data.meetingUrl);
  }
  if (parsed.data.recruiterNotes !== undefined) {
    updates.push('recruiter_notes = ?');
    values.push(parsed.data.recruiterNotes);
  }
  if (parsed.data.matchedRepoId !== undefined) {
    updates.push('matched_repo_id = ?');
    values.push(parsed.data.matchedRepoId);
  }
  if (parsed.data.githubRepoUrl !== undefined) {
    updates.push('github_repo_url = ?');
    values.push(parsed.data.githubRepoUrl);
  }
  if (parsed.data.githubPrNumber !== undefined) {
    updates.push('github_pr_number = ?');
    values.push(parsed.data.githubPrNumber);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('sync_source = ?');
  values.push('MANUAL');
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE scheduled_interviews SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

// POST /interviews/:id/invite — send a video call invitation email
schedulingAuth.post('/interviews/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = inviteToCallSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { email, message: customMessage } = parsed.data;
  const shouldSendEmail = parsed.data.sendEmail !== false;

  // Fetch interview with enriched data
  const interview = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id, si.status,
              si.scheduled_at, si.meeting_url, si.recipient_name, si.recipient_email,
              si.interview_type, si.scheduling_provider, si.scheduling_url,
              si.external_event_id,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       WHERE si.id = ? AND si.owner_id = ?`
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      interview_type: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      external_event_id: string | null;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const workspaceAssessment = isWorkspaceAssessmentInterviewType(interview.interview_type);
  const needsAssessmentLink = isAssessmentOnlyInviteInterviewType(interview.interview_type);
  const needsRoomBackedWorkspace = isRoomBackedWorkspaceAssessmentInterviewType(interview.interview_type);
  const inviteRecipientName = (
    interview.candidate_name
    ?? interview.recipient_name
    ?? email.split('@')[0]
    ?? 'Candidate'
  ).trim();
  const roomLinks = needsAssessmentLink
    ? null
    : await ensureScheduledInterviewRoomLinks(
        db,
        userId,
        c.env,
        interview,
        email,
      );
  const contactId = roomLinks?.contactId
    ?? await ensureRecipientContact(db, userId, { name: inviteRecipientName, email });
  const meetingUrl = roomLinks?.guestUrl ?? null;
  const recipientNameForScheduling = interview.candidate_name
    ?? interview.recipient_name
    ?? null;
  const recipientEmailForScheduling = normalizeEmail(
    interview.candidate_email ?? interview.recipient_email ?? email,
  );
  const schedulingInviteUrl = interview.scheduling_url
    && (interview.scheduling_provider === 'CALENDLY' || interview.scheduling_provider === 'CAL_COM')
    ? buildProviderSchedulingInviteUrl({
        schedulingUrl: interview.scheduling_url,
        provider: interview.scheduling_provider,
        env: c.env,
        interviewId: id,
        recipientName: recipientNameForScheduling,
        recipientEmail: recipientEmailForScheduling,
      })
    : null;

  // For assessment-only CODE_REVIEW handoffs, ensure a standalone
  // candidate exists so the email includes an assessment link that authenticates
  // the candidate and routes them to the CODE_REVIEW runtime.
  let assessUrl: string | null = null;
  if (needsAssessmentLink && !interview.candidate_id) {
    const { inviteToken } = await ensureStandaloneCandidateForInterview(
      db,
      userId,
      { name: inviteRecipientName, email },
      interview.id,
    );
    const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
    assessUrl = withDevBasicAuth(`${baseUrl}/assess/${inviteToken}`, c.env);
  } else if (needsAssessmentLink && interview.candidate_id) {
    // Candidate already exists — fetch their invite token
    const candidate = await db
      .prepare('SELECT invite_token FROM candidates WHERE id = ?')
      .bind(interview.candidate_id)
      .first<{ invite_token: string }>();
    if (candidate?.invite_token) {
      const inviteToken = await ensureUsableCandidateInviteToken(
        db,
        interview.candidate_id,
        candidate.invite_token,
      );
      const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
      assessUrl = withDevBasicAuth(`${baseUrl}/assess/${inviteToken}`, c.env);
    }
  }

  // Assessment-specific interviews should not deliver stale provider scheduling
  // URLs. CODE_REVIEW uses /assess; room-backed workspace assessments use the
  // generated room URL.
  const effectiveSchedulingInviteUrl = workspaceAssessment ? null : schedulingInviteUrl;
  const deliveredUrl = assessUrl ?? effectiveSchedulingInviteUrl ?? meetingUrl;
  if (!deliveredUrl) {
    return apiError(c, 'INTERNAL_ERROR', 'Could not create an invite link for this interview.');
  }
  const inviteVerb = needsAssessmentLink
    ? 'start your assessment'
    : needsRoomBackedWorkspace
      ? 'join your assessment workspace'
      : effectiveSchedulingInviteUrl
        ? 'schedule an interview'
        : 'join a video call';
  const inviteCta = needsAssessmentLink
    ? 'START ASSESSMENT'
    : needsRoomBackedWorkspace
      ? 'JOIN ASSESSMENT WORKSPACE'
      : effectiveSchedulingInviteUrl
        ? 'SCHEDULE INTERVIEW'
        : 'JOIN VIDEO CALL';
  const linkLabel = effectiveSchedulingInviteUrl ? 'Scheduling link' : 'Link';

  const scheduledTime = interview.scheduled_at
    ? new Date(interview.scheduled_at).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : null;

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const candidateName = escapeHtml(
    interview.candidate_name
    ?? interview.recipient_name
    ?? email.split('@')[0]
    ?? 'there',
  );
  const pipelineTitle = escapeHtml(interview.pipeline_title ?? 'Interview');
  const stageTitle = escapeHtml(interview.stage_title ?? '');
  const safeDeliveredUrl = escapeHtml(deliveredUrl);

  // Build HTML email
  const customBlock = customMessage
    ? `<p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.05); border-left: 3px solid rgba(96,165,250,0.4); border-radius: 4px;">${escapeHtml(customMessage)}</p>`
    : '';

  const timeBlock = scheduledTime
    ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">When:</strong> ${scheduledTime}</p>`
    : '';

  const html = `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  ${emailLogoImgForRequest(c)}
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi ${candidateName},</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've been invited to ${inviteVerb} for <strong>${pipelineTitle}</strong>.
  </p>
  ${customBlock}
  <div style="padding: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 32px;">
    ${stageTitle ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Stage:</strong> ${stageTitle}</p>` : ''}
    ${timeBlock}
    <p style="font-size: 14px; margin: 0;"><strong style="color: #888;">${linkLabel}:</strong> <a href="${safeDeliveredUrl}" style="color: #60a5fa;">${escapeHtml(inviteCta)}</a></p>
  </div>
  <a href="${safeDeliveredUrl}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    ${escapeHtml(inviteCta)} →
  </a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="${safeDeliveredUrl}" style="color: #888;">${escapeHtml(deliveredUrl)}</a>
  </p>
</div>`;

  const rawPipelineTitle = interview.pipeline_title ?? 'Interview';
  const subjectPrefix = effectiveSchedulingInviteUrl
    ? 'Schedule interview'
    : workspaceAssessment
      ? 'Assessment invitation'
      : 'Video call invitation';
  const subject = scheduledTime
    ? `${subjectPrefix} — ${rawPipelineTitle} (${scheduledTime})`
    : `${subjectPrefix} — ${rawPipelineTitle}`;
  const now = new Date().toISOString();

  if (!shouldSendEmail) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
         SET invite_link_sent_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, id)
      .run();
    await persistScheduledInterviewInviteDeliveryContext(db, {
      contactId,
      ownerId: userId,
      interviewId: id,
      meetingId: roomLinks?.meetingId ?? null,
      recipientEmail: email.trim().toLowerCase(),
      subject,
      deliveredUrl,
      roomUrl: meetingUrl,
      customMessage: customMessage ?? null,
      emailSent: false,
      providerMessageId: null,
      createdAt: now,
    });
    return c.json({
      success: true,
      emailSent: false,
      meetingUrl,
      schedulingUrl: effectiveSchedulingInviteUrl,
      deliveredUrl,
      room: roomLinks
        ? {
            id: roomLinks.roomId,
            sessionId: roomLinks.sessionId,
            hostUrl: roomLinks.hostUrl,
            guestUrl: roomLinks.guestUrl,
            expiresAt: roomLinks.expiresAt,
          }
        : null,
    });
  }

  await db
    .prepare(
      `UPDATE scheduled_interviews
       SET invite_link_sent_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, now, id)
    .run();

  if (!c.env.EMAIL && !c.env.RESEND_API_KEY) {
    await persistScheduledInterviewInviteDeliveryContext(db, {
      contactId,
      ownerId: userId,
      interviewId: id,
      meetingId: roomLinks?.meetingId ?? null,
      recipientEmail: email.trim().toLowerCase(),
      subject,
      deliveredUrl,
      roomUrl: meetingUrl,
      customMessage: customMessage ?? null,
      emailSent: false,
      providerMessageId: null,
      createdAt: now,
    });
    return c.json({
      success: true,
      emailSent: false,
      meetingUrl,
      schedulingUrl: effectiveSchedulingInviteUrl,
      deliveredUrl,
      room: roomLinks
        ? {
            id: roomLinks.roomId,
            sessionId: roomLinks.sessionId,
            hostUrl: roomLinks.hostUrl,
            guestUrl: roomLinks.guestUrl,
            expiresAt: roomLinks.expiresAt,
          }
        : null,
    });
  }

  const emailDeliveryTask = (async () => {
    try {
      const result = await sendTransactionalEmail(c.env, {
        to: email,
        subject,
        html,
      });
      if (!result) {
        await persistScheduledInterviewInviteDeliveryContext(db, {
          contactId,
          ownerId: userId,
          interviewId: id,
          meetingId: roomLinks?.meetingId ?? null,
          recipientEmail: email.trim().toLowerCase(),
          subject,
          deliveredUrl,
          roomUrl: meetingUrl,
          customMessage: customMessage ?? null,
          emailSent: false,
          providerMessageId: null,
          createdAt: new Date().toISOString(),
        });
        return;
      }
      const completedAt = new Date().toISOString();
      await db
        .prepare(
          `UPDATE scheduled_interviews
           SET email_sent_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(completedAt, completedAt, id)
        .run();
      await persistScheduledInterviewInviteDeliveryContext(db, {
        contactId,
        ownerId: userId,
        interviewId: id,
        meetingId: roomLinks?.meetingId ?? null,
        recipientEmail: email.trim().toLowerCase(),
        subject,
        deliveredUrl,
        roomUrl: meetingUrl,
        customMessage: customMessage ?? null,
        emailSent: true,
        providerMessageId: result.id,
        createdAt: completedAt,
      });
    } catch (err) {
      const failedAt = new Date().toISOString();
      console.error('[scheduling/invite] Email send failed:', err);
      await persistScheduledInterviewInviteDeliveryContext(db, {
        contactId,
        ownerId: userId,
        interviewId: id,
        meetingId: roomLinks?.meetingId ?? null,
        recipientEmail: email.trim().toLowerCase(),
        subject,
        deliveredUrl,
        roomUrl: meetingUrl,
        customMessage: customMessage ?? null,
        emailSent: false,
        providerMessageId: null,
        createdAt: failedAt,
      });
    }
  })().catch((err) => {
    console.error('[scheduling/invite] Background email delivery task failed:', err);
  });
  queueBestEffortBackgroundTask(c, emailDeliveryTask);

  return c.json({
    success: true,
    emailSent: false,
    emailQueued: true,
    meetingUrl,
    schedulingUrl: effectiveSchedulingInviteUrl,
    deliveredUrl,
    room: roomLinks
      ? {
          id: roomLinks.roomId,
          sessionId: roomLinks.sessionId,
          hostUrl: roomLinks.hostUrl,
          guestUrl: roomLinks.guestUrl,
          expiresAt: roomLinks.expiresAt,
        }
      : null,
  });
});

// ─── Public webhook route ───────────────────────────────────────────────────

const schedulingPublic = new Hono<{ Bindings: Env }>();

// POST /webhook — receive Calendly/Cal.com webhook events
schedulingPublic.post('/webhook', async (c) => {
  const db = c.env.DB;
  const headers = Object.fromEntries(
    Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v]),
  );

  // Identify provider from headers
  const isCalendly =
    'calendly-webhook-signature' in headers ||
    (headers['user-agent'] ?? '').includes('Calendly');
  const isCalCom = 'x-cal-signature-v2' in headers;

  const providerId = isCalendly ? 'CALENDLY' : isCalCom ? 'CAL_COM' : null;
  if (!providerId) {
    return c.json({ message: 'Unknown provider' }, 400);
  }

  // Find active connection for this provider. Webhook registrations include
  // connectionId, which is required to disambiguate multiple Calendly accounts.
  const connectionId = c.req.query('connectionId');
  const connection = connectionId
    ? await db
        .prepare(
          `SELECT id, owner_id, webhook_secret, access_token
             FROM scheduling_connections
            WHERE id = ?1
              AND provider_id = ?2
              AND status = 'ACTIVE'
            LIMIT 1`,
        )
        .bind(connectionId, providerId)
        .first<{ id: string; owner_id: string; webhook_secret: string | null; access_token: string }>()
    : await db
        .prepare(
          `SELECT id, owner_id, webhook_secret, access_token
             FROM scheduling_connections
            WHERE provider_id = ?1
              AND status = 'ACTIVE'
            ORDER BY connected_at DESC
            LIMIT 1`,
        )
        .bind(providerId)
        .first<{ id: string; owner_id: string; webhook_secret: string | null; access_token: string }>();

  if (!connection) {
    return c.json({ message: 'No active connection' }, 404);
  }

  // Verify HMAC signature
  const payloadStr = await c.req.text();

  if (connection.webhook_secret) {
    const sigHeader = isCalendly ? 'calendly-webhook-signature' : 'x-cal-signature-v2';
    const signature = headers[sigHeader];

    if (!signature) {
      return c.json({ message: 'Missing signature' }, 401);
    }

    const isValid = await verifyWebhookSignature(
      providerId, payloadStr, signature, connection.webhook_secret,
    );
    if (!isValid) {
      return c.json({ message: 'Invalid signature' }, 401);
    }
  }

  // Parse and normalize payload
  const payload = JSON.parse(payloadStr) as Record<string, unknown>;
  const normalized = normalizeWebhookPayload(providerId, payload);

  if (!normalized) {
    return c.json({ message: 'Could not normalize payload' }, 200);
  }

  // If Calendly webhook didn't include a meeting URL, fetch it from the API
  if (providerId === 'CALENDLY' && !normalized.meetingUrl && normalized.externalEventId && connection.access_token) {
    try {
      const eventRes = await fetch(normalized.externalEventId, {
        headers: { Authorization: `Bearer ${connection.access_token}` },
      });
      if (eventRes.ok) {
        const eventData = await eventRes.json() as { resource?: { location?: { join_url?: string; location?: string } } };
        const loc = eventData.resource?.location;
        normalized.meetingUrl = loc?.join_url ?? loc?.location ?? null;
      }
    } catch (err) {
      console.error('[scheduling/webhook] Failed to fetch Calendly event location:', err);
    }
  }

  // Fetch invitee details to extract custom answers (a1 = interview ID)
  if (providerId === 'CALENDLY' && normalized.inviteeUri && connection.access_token) {
    try {
      const inviteeRes = await fetch(normalized.inviteeUri, {
        headers: { Authorization: `Bearer ${connection.access_token}` },
      });
      if (inviteeRes.ok) {
        const inviteeData = await inviteeRes.json() as {
          resource?: {
            name?: string;
            email?: string;
            tracking?: CalendlyInvitee['tracking'];
            answers?: Array<{ position: number; value: string }>;
            questions_and_answers?: Array<{ position?: number; question?: string; answer?: string }>;
          };
        };
        if (inviteeData.resource?.name) {
          normalized.candidateName = inviteeData.resource.name;
        }
        if (inviteeData.resource?.email) {
          normalized.candidateEmail = inviteeData.resource.email;
        }
        const customInterviewId = calendlyInviteeInterviewId(inviteeData.resource ?? {});
        if (customInterviewId) {
          normalized.interviewId = customInterviewId;
        }
      }
    } catch (err) {
      console.error('[scheduling/webhook] Failed to fetch Calendly invitee answers:', err);
    }
  }

  // Find matching scheduled interview
  let interview: { id: string; status: string } | null = null;

  // Try by interview ID from custom field first (most reliable)
  if (normalized.interviewId) {
    interview = await db
      .prepare(
        'SELECT id, status FROM scheduled_interviews WHERE id = ? AND owner_id = ?'
      )
      .bind(normalized.interviewId, connection.owner_id)
      .first<{ id: string; status: string }>();
  }

  // Try by external event ID
  if (!interview && normalized.externalEventId) {
    interview = await db
      .prepare(
        `SELECT id, status
           FROM scheduled_interviews
          WHERE external_event_id = ?
            AND owner_id = ?
          ORDER BY updated_at DESC
          LIMIT 1`
      )
      .bind(normalized.externalEventId, connection.owner_id)
      .first<{ id: string; status: string }>();
  }

  // Fallback: match by candidate email OR recipient_email
  if (!interview && normalized.candidateEmail) {
    const candidateEmail = normalizeEmail(normalized.candidateEmail);
    if (candidateEmail) {
      const emailMatches = await db
        .prepare(
          `SELECT si.id, si.status, si.scheduled_at
             FROM scheduled_interviews si
             LEFT JOIN candidates c ON c.id = si.candidate_id
            WHERE si.owner_id = ?
              AND (
                lower(COALESCE(c.email, '')) = ?
                OR lower(COALESCE(si.recipient_email, '')) = ?
              )
              AND si.status IN ('INVITED', 'SCHEDULED')
            ORDER BY si.created_at DESC`
        )
        .bind(connection.owner_id, candidateEmail, candidateEmail)
        .all<{ id: string; status: string; scheduled_at: string | null }>();
      const pendingMatches = emailMatches.results ?? [];
      const scheduledAtMatches = normalized.scheduledAt
        ? pendingMatches.filter((row) => row.scheduled_at === normalized.scheduledAt)
        : [];
      const selectedMatch = scheduledAtMatches.length === 1
        ? scheduledAtMatches[0]
        : pendingMatches.length === 1
          ? pendingMatches[0]
          : null;

      if (selectedMatch) {
        interview = { id: selectedMatch.id, status: selectedMatch.status };
      } else if (pendingMatches.length > 1) {
        console.warn('[scheduling/webhook] Ambiguous email fallback; importing provider event instead of mutating an arbitrary pending interview', {
          candidateEmail,
          externalEventId: normalized.externalEventId,
          scheduledAt: normalized.scheduledAt,
          pendingInterviewIds: pendingMatches.map((row) => row.id),
        });
      }
    }
  }

  const now = new Date().toISOString();
  let created = false;

  if (!interview) {
    const candidateEmail = normalizeEmail(normalized.candidateEmail);
    if (
      normalized.status !== 'SCHEDULED'
      || !normalized.externalEventId
      || !candidateEmail
      || !normalized.scheduledAt
    ) {
      console.log('[scheduling/webhook] No importable interview match', {
        externalEventId: normalized.externalEventId,
        candidateEmail: normalized.candidateEmail,
        status: normalized.status,
      });
      return c.json({ message: 'No matching interview' }, 200);
    }

    const importedInterviewId = crypto.randomUUID();
    const recipientName = normalized.candidateName?.trim() || nameFromEmail(candidateEmail);
    const contactId = await ensureRecipientContact(db, connection.owner_id, {
      name: recipientName,
      email: candidateEmail,
    });

    await db
      .prepare(
        `INSERT INTO scheduled_interviews
         (id, candidate_id, pipeline_id, stage_id, owner_id, status,
          interview_type, meeting_type, scheduled_at, meeting_url,
          scheduling_provider, external_event_id, recipient_name,
          recipient_email, sync_source, last_synced_at, created_at, updated_at)
         VALUES (?1, NULL, NULL, NULL, ?2, 'SCHEDULED',
          'VIDEO', 'DIRECT_VIDEO_CALL', ?3, NULL,
          ?4, ?5, ?6, ?7, 'WEBHOOK', ?8, ?8, ?8)`,
      )
      .bind(
        importedInterviewId,
        connection.owner_id,
        normalized.scheduledAt,
        providerId,
        normalized.externalEventId,
        recipientName,
        candidateEmail,
        now,
      )
      .run();

    await persistContactFirstInterviewInviteContext(db, {
      contactId,
      ownerId: connection.owner_id,
      interviewId: importedInterviewId,
      recipientName,
      recipientEmail: candidateEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'VIDEO',
      assessmentSetup: buildScheduledAssessmentSetup({
        interviewType: 'VIDEO',
        candidateId: null,
        matchedRepoId: null,
        githubRepoUrl: null,
        githubPrNumber: null,
      }),
      scheduledAt: normalized.scheduledAt,
      schedulingProvider: providerId,
      schedulingUrl: null,
      createdAt: now,
    });

    interview = { id: importedInterviewId, status: 'SCHEDULED' };
    created = true;
  }

  // Validate status transition. Duplicate webhook deliveries may repeat the
  // same status and should refresh provider metadata idempotently.
  if (interview.status !== normalized.status && !canInterviewStatusTransition(interview.status, normalized.status)) {
    console.warn('[scheduling/webhook] Invalid transition', {
      from: interview.status,
      to: normalized.status,
    });
    return c.json({ message: 'Transition not allowed' }, 200);
  }

  // Update interview
  const updateFields = [
    'status = ?', 'sync_source = ?', 'last_synced_at = ?',
    'external_event_id = ?', 'scheduling_provider = ?', 'updated_at = ?',
  ];
  const updateValues: unknown[] = [
    normalized.status, 'WEBHOOK', now,
    normalized.externalEventId, providerId, now,
  ];

  if (normalized.scheduledAt) {
    updateFields.push('scheduled_at = ?');
    updateValues.push(normalized.scheduledAt);
  }

  updateValues.push(interview.id);

  await db
    .prepare(`UPDATE scheduled_interviews SET ${updateFields.join(', ')} WHERE id = ?`)
    .bind(...updateValues)
    .run();

  if (normalized.status === 'CANCELLED') {
    await db.prepare(
      `UPDATE meetings
          SET status = 'CANCELLED',
              scheduling_provider = COALESCE(?1, scheduling_provider),
              external_event_id = COALESCE(?2, external_event_id),
              updated_at = ?3
        WHERE scheduled_interview_id = ?4
          AND owner_id = ?5`,
    ).bind(providerId, normalized.externalEventId, now, interview.id, connection.owner_id).run();
  }

  // Update connection lastSyncAt
  await db
    .prepare('UPDATE scheduling_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, connection.id)
    .run();

  if (normalized.status === 'SCHEDULED') {
    const roomInterview = await db.prepare(
      `SELECT si.id, si.scheduled_at, si.scheduling_provider, si.external_event_id,
              si.recipient_name, si.recipient_email, si.interview_type,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
         FROM scheduled_interviews si
         LEFT JOIN candidates c ON c.id = si.candidate_id
         LEFT JOIN pipelines p ON p.id = si.pipeline_id
         LEFT JOIN stages s ON s.id = si.stage_id
        WHERE si.id = ?1
          AND si.owner_id = ?2`,
    ).bind(interview.id, connection.owner_id).first<{
      id: string;
      scheduled_at: string | null;
      scheduling_provider: string | null;
      external_event_id: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      interview_type: string | null;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();
    const recipientEmail = normalizeEmail(
      normalized.candidateEmail ?? roomInterview?.candidate_email ?? roomInterview?.recipient_email,
    );
    if (roomInterview && recipientEmail) {
      await ensureScheduledInterviewRoomLinks(
        db,
        connection.owner_id,
        c.env,
        roomInterview,
        recipientEmail,
      );
    }
    queueScheduledBookingConfirmation(c, db, connection.owner_id, interview.id);
  }

  console.log('[scheduling/webhook] Interview updated', {
    interviewId: interview.id,
    newStatus: normalized.status,
    created,
  });

  return c.json({ message: created ? 'Interview imported' : 'Interview updated', interviewId: interview.id, created });
});

// ─── Helpers: Provider API calls ────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshToken(
  connection: { id: string; provider_id: string; access_token: string; refresh_token: string | null },
  env: Env,
): Promise<string | null> {
  if (!connection.refresh_token) return null;

  const config = getProviderConfig(connection.provider_id, env);
  if (!config) return null;

  const resp = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!resp.ok) {
    console.error('[scheduling] Token refresh failed', { status: resp.status });
    await env.DB
      .prepare("UPDATE scheduling_connections SET status = 'EXPIRED', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), connection.id)
      .run();
    return null;
  }

  const tokens = await resp.json() as TokenResponse;
  const expiresIn = tokens.expires_in ?? 7200;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  await env.DB
    .prepare(
      `UPDATE scheduling_connections
       SET access_token = ?, refresh_token = ?, token_expiry = ?, status = 'ACTIVE', updated_at = ?
       WHERE id = ?`
    )
    .bind(
      tokens.access_token,
      tokens.refresh_token ?? connection.refresh_token,
      tokenExpiry,
      new Date().toISOString(),
      connection.id,
    )
    .run();

  return tokens.access_token;
}

async function fetchCalendlyEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<ProviderEventTypeSummary[]> {
  const user = await fetchCalendlyCurrentUser(accessToken, config);
  if (!user) return [];

  if (user.uri) {
    const userEventTypes = await fetchCalendlyEventTypesForOwner(accessToken, config, 'user', user.uri, user);
    if (userEventTypes.length > 0) return userEventTypes;
  }

  if (user.current_organization) {
    const organizationEventTypes = await fetchCalendlyEventTypesForOwner(
      accessToken,
      config,
      'organization',
      user.current_organization,
      user,
    );
    if (organizationEventTypes.length > 0) return organizationEventTypes;
  }

  return calendlySchedulingPageFallback(user);
}

async function fetchCalendlyCurrentUser(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<CalendlyUserResource | null> {
  if (!config.userInfoUrl) return null;
  const userResp = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResp.ok) return null;

  const userData = await userResp.json() as { resource?: CalendlyUserResource };
  return userData.resource ?? null;
}

async function fetchCalendlyEventTypesForOwner(
  accessToken: string,
  config: ProviderOAuthConfig,
  ownerParam: 'user' | 'organization',
  ownerUri: string,
  user: CalendlyUserResource,
): Promise<ProviderEventTypeSummary[]> {
  if (!config.eventTypesUrl) return [];
  const eventTypes: ProviderEventTypeSummary[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(config.eventTypesUrl);
    url.searchParams.set(ownerParam, ownerUri);
    url.searchParams.set('active', 'true');
    url.searchParams.set('count', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return [];

    const data = await resp.json() as {
      collection?: CalendlyEventTypeResource[];
      pagination?: { next_page_token?: string | null };
    };

    for (const eventType of data.collection ?? []) {
      const normalized = normalizeCalendlyEventType(eventType, user);
      if (normalized) eventTypes.push(normalized);
    }

    pageToken = data.pagination?.next_page_token ?? null;
  } while (pageToken);

  return eventTypes;
}

function normalizeCalendlyEventType(
  eventType: CalendlyEventTypeResource,
  user: CalendlyUserResource,
): ProviderEventTypeSummary | null {
  const id = eventType.uri?.trim();
  const schedulingUrl = eventType.scheduling_url?.trim()
    ?? calendlySchedulingUrlFromSlug(user.scheduling_url, eventType.slug);
  if (!id || !schedulingUrl) return null;
  return {
    id,
    name: eventType.name?.trim() || 'Calendly event',
    durationMinutes: eventType.duration ?? 30,
    url: id,
    schedulingUrl,
  };
}

function calendlySchedulingUrlFromSlug(
  userSchedulingUrl: string | undefined,
  slug: string | undefined,
): string | null {
  const base = userSchedulingUrl?.trim();
  const eventSlug = slug?.trim();
  if (!base || !eventSlug) return null;
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(eventSlug)}`;
}

function calendlySchedulingPageFallback(user: CalendlyUserResource): ProviderEventTypeSummary[] {
  const schedulingUrl = user.scheduling_url?.trim();
  if (!schedulingUrl) return [];
  return [{
    id: user.uri?.trim() || schedulingUrl,
    name: user.name?.trim() ? `${user.name.trim()} Calendly` : 'Calendly scheduling page',
    durationMinutes: 30,
    url: user.uri?.trim() || schedulingUrl,
    schedulingUrl,
  }];
}

async function fetchCalComEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<ProviderEventTypeSummary[]> {
  const resp = await fetch(config.eventTypesUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return [];

  const data = await resp.json() as {
    event_types?: Array<{ id?: number; title?: string; length?: number; slug?: string }>;
  };

  return (data.event_types ?? []).map((et) => {
    const url = et.slug ? `https://cal.com/${et.slug}` : '';
    return {
      id: String(et.id ?? ''),
      name: et.title ?? 'Unnamed',
      durationMinutes: et.length ?? 30,
      url,
      schedulingUrl: url,
    };
  });
}

async function registerProviderWebhook(
  connectionId: string,
  providerId: string,
  accessToken: string,
  webhookSecret: string,
  config: ProviderOAuthConfig,
  env: Env,
): Promise<string | null> {
  const baseUrl = env.API_BASE_URL ?? env.APP_BASE_URL ?? 'https://api.pipe.build';
  const callbackUrl = `${baseUrl}/api/v1/scheduling/webhook?connectionId=${encodeURIComponent(connectionId)}`;

  if (providerId === 'CALENDLY' && config.webhookUrl) {
    const userResp = await fetch(config.userInfoUrl!, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) return null;

    const userData = await userResp.json() as {
      resource?: { uri?: string; current_organization?: string };
    };

    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: userData.resource?.current_organization,
        user: userData.resource?.uri,
        scope: 'user',
        signing_key: webhookSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('[scheduling] Calendly webhook registration failed', {
        status: resp.status, body: body.slice(0, 500),
      });
      return null;
    }

    const result = await resp.json() as { resource?: { uri?: string } };
    return result.resource?.uri ?? null;
  }

  if (providerId === 'CAL_COM' && config.webhookUrl) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriberUrl: callbackUrl,
        eventTriggers: ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'MEETING_ENDED'],
        active: true,
        secret: webhookSecret,
      }),
    });

    if (!resp.ok) return null;

    const result = await resp.json() as { webhook?: { id?: number } };
    return result.webhook?.id ? String(result.webhook.id) : null;
  }

  return null;
}

async function deleteProviderWebhook(
  providerId: string,
  accessToken: string,
  webhookId: string,
): Promise<void> {
  if (providerId === 'CALENDLY') {
    await fetch(webhookId, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } else if (providerId === 'CAL_COM') {
    await fetch(`https://api.cal.com/v1/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}

// ─── Webhook signature verification ─────────────────────────────────────────

async function verifyWebhookSignature(
  providerId: string,
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  if (providerId === 'CALENDLY') {
    // Calendly: t=<timestamp>,v1=<hex_signature>
    const parts = signature.split(',');
    const tPart = parts.find((p) => p.startsWith('t='));
    const v1Part = parts.find((p) => p.startsWith('v1='));

    let data: string;
    let receivedSig: string;

    if (tPart && v1Part) {
      const timestamp = tPart.slice(2);
      receivedSig = v1Part.slice(3);
      data = `${timestamp}.${payload}`;
    } else {
      receivedSig = signature;
      data = payload;
    }

    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return expected === receivedSig;
  }

  if (providerId === 'CAL_COM') {
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return expected === signature;
  }

  return false;
}

// ─── Webhook payload normalization ──────────────────────────────────────────

interface NormalizedEvent {
  externalEventId: string;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  candidateName: string | null;
  candidateEmail: string | null;
  interviewId: string | null;
  inviteeUri: string | null;
}

function normalizeWebhookPayload(
  providerId: string,
  payload: Record<string, unknown>,
): NormalizedEvent | null {
  if (providerId === 'CALENDLY') {
    const event = payload['event'] as string | undefined;
    const p = payload['payload'] as Record<string, unknown> | undefined;
    if (!p) return null;

    const scheduledEvent = p['scheduled_event'] as Record<string, unknown> | undefined;
    const location = scheduledEvent?.['location'] as Record<string, unknown> | undefined;
    const tracking = p['tracking'] as CalendlyInvitee['tracking'] | undefined;

    return {
      externalEventId: (scheduledEvent?.['uri'] as string) ?? (p['uri'] as string) ?? '',
      status: event === 'invitee.canceled' ? 'CANCELLED' : 'SCHEDULED',
      scheduledAt: (scheduledEvent?.['start_time'] as string) ?? null,
      meetingUrl: (location?.['join_url'] as string) ?? null,
      candidateName: (p['name'] as string) ?? null,
      candidateEmail: (p['email'] as string) ?? null,
      interviewId: calendlyInviteeInterviewId({ tracking }),
      inviteeUri: (p['uri'] as string) ?? null,
    };
  }

  if (providerId === 'CAL_COM') {
    const triggerEvent = payload['triggerEvent'] as string | undefined;
    const p = payload['payload'] as Record<string, unknown> | undefined;
    if (!p) return null;

    const attendees = p['attendees'] as Array<Record<string, unknown>> | undefined;
    const firstAttendee = attendees?.[0];

    let status: string;
    switch (triggerEvent) {
      case 'BOOKING_CREATED': status = 'SCHEDULED'; break;
      case 'BOOKING_CANCELLED': status = 'CANCELLED'; break;
      case 'MEETING_ENDED': status = 'COMPLETED'; break;
      default: status = 'SCHEDULED';
    }

    return {
      externalEventId: String(p['id'] ?? ''),
      status,
      scheduledAt: (p['startTime'] as string) ?? null,
      meetingUrl: (p['metadata']as Record<string, unknown>)?.['videoCallUrl'] as string ?? null,
      candidateName: (firstAttendee?.['name'] as string) ?? null,
      candidateEmail: (firstAttendee?.['email'] as string) ?? null,
      interviewId: null,
      inviteeUri: null,
    };
  }

  return null;
}

// ─── SSE: Booking notifications ─────────────────────────────────────────────
//
// GET /events — SSE stream that polls for interview status changes.
// Emits 'booking_update' events when an interview transitions to SCHEDULED,
// CANCELLED, or COMPLETED via webhook or poll sync.
//

interface RoomStatusPayload {
  interviewId: string;
  meetingId: string | null;
  meetingStatus: string | null;
  roomStatus: string | null;
  guestJoinedAt: string | null;
  guestLeftAt: string | null;
  guestWaiting: boolean;
  updatedAt: string;
}

interface RoomStatusRow {
  interview_id: string;
  meeting_id: string | null;
  meeting_status: string | null;
  meeting_updated_at: string | null;
  room_status: string | null;
  room_updated_at: string | null;
  guest_joined_at: string | null;
  guest_left_at: string | null;
  guest_updated_at: string | null;
  interview_updated_at: string | null;
}

function latestRoomStatusTimestamp(row: RoomStatusRow): string {
  const timestamps = [
    row.guest_updated_at,
    row.room_updated_at,
    row.meeting_updated_at,
    row.interview_updated_at,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (timestamps.length === 0) return new Date(0).toISOString();
  timestamps.sort();
  return timestamps[timestamps.length - 1] ?? new Date(0).toISOString();
}

function roomStatusSignature(payload: RoomStatusPayload): string {
  return [
    payload.meetingId ?? '',
    payload.meetingStatus ?? '',
    payload.roomStatus ?? '',
    payload.guestJoinedAt ?? '',
    payload.guestLeftAt ?? '',
    payload.guestWaiting ? 'waiting' : 'not-waiting',
    payload.updatedAt,
  ].join('|');
}

async function fetchRoomStatusPayloads(db: Env['DB'], ownerId: string): Promise<RoomStatusPayload[]> {
  const result = await db
    .prepare(
      `SELECT si.id AS interview_id,
              si.updated_at AS interview_updated_at,
              m.id AS meeting_id,
              m.status AS meeting_status,
              m.updated_at AS meeting_updated_at,
              mr.status AS room_status,
              mr.updated_at AS room_updated_at,
              guest_mp.joined_at AS guest_joined_at,
              guest_mp.left_at AS guest_left_at,
              guest_mp.updated_at AS guest_updated_at
         FROM scheduled_interviews si
         LEFT JOIN meetings m ON m.scheduled_interview_id = si.id AND m.owner_id = si.owner_id
         LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
         LEFT JOIN meeting_participants guest_mp ON guest_mp.meeting_id = m.id AND guest_mp.role = 'ATTENDEE'
        WHERE si.owner_id = ?
          AND m.id IS NOT NULL
        ORDER BY COALESCE(guest_mp.updated_at, mr.updated_at, m.updated_at, si.updated_at) ASC`
    )
    .bind(ownerId)
    .all<RoomStatusRow>();

  return (result.results ?? []).map((row) => {
    const guestWaiting = Boolean(
      row.guest_joined_at && !row.guest_left_at && row.room_status && row.room_status !== 'ENDED',
    );
    return {
      interviewId: row.interview_id,
      meetingId: row.meeting_id,
      meetingStatus: row.meeting_status,
      roomStatus: row.room_status,
      guestJoinedAt: row.guest_joined_at,
      guestLeftAt: row.guest_left_at,
      guestWaiting,
      updatedAt: latestRoomStatusTimestamp(row),
    };
  });
}

schedulingAuth.get('/room-events', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const acceptHeader = c.req.header('Accept');

  if (acceptHeader !== 'text/event-stream') {
    return c.json({ rooms: await fetchRoomStatusPayloads(db, userId) });
  }

  const seenSignatures = new Map<string, string>();

  const response = streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ts: Date.now() }) });

      while (true) {
        const payloads = await fetchRoomStatusPayloads(db, userId);
        for (const payload of payloads) {
          const signature = roomStatusSignature(payload);
          if (seenSignatures.get(payload.interviewId) === signature) continue;
          seenSignatures.set(payload.interviewId, signature);
          await stream.writeSSE({
            event: 'room_status',
            data: JSON.stringify(payload),
          });
        }
        await stream.sleep(2500);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[scheduling/room-events] SSE error:', msg);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ code: 'INTERNAL_ERROR', message: msg }),
      });
    }
  });

  response.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  response.headers.set('Cache-Control', 'no-cache');
  response.headers.set('Connection', 'keep-alive');
  return response;
});

schedulingAuth.get('/events', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const acceptHeader = c.req.header('Accept');

  // Non-streaming: return current state
  if (acceptHeader !== 'text/event-stream') {
    const recent = await db
      .prepare(
        `SELECT id, status, scheduled_at, meeting_url, recipient_name, recipient_email,
                candidate_id, sync_source, updated_at
         FROM scheduled_interviews
         WHERE owner_id = ? AND updated_at > datetime('now', '-5 minutes')
         ORDER BY updated_at DESC LIMIT 20`
      )
      .bind(userId)
      .all();
    return c.json({ interviews: recent.results ?? [] });
  }

  // Streaming: poll every 5s for status changes
  let lastCheck = new Date(Date.now() - 5000).toISOString();

  const response = streamSSE(c, async (stream) => {
    try {
      // Send initial heartbeat
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ ts: Date.now() }) });

      while (true) {
        const changed = await db
          .prepare(
            `SELECT id, status, scheduled_at, meeting_url, recipient_name, recipient_email,
                    candidate_id, sync_source, updated_at
             FROM scheduled_interviews
             WHERE owner_id = ? AND updated_at > ?
             ORDER BY updated_at ASC`
          )
          .bind(userId, lastCheck)
          .all();

        for (const row of changed.results ?? []) {
          const r = row as {
            id: string; status: string; scheduled_at: string | null;
            meeting_url: string | null; recipient_name: string | null;
            recipient_email: string | null; candidate_id: string | null;
            sync_source: string | null; updated_at: string;
          };

          // Only emit for webhook/poll-sourced updates (not manual recruiter changes)
          if (r.sync_source === 'WEBHOOK' || r.sync_source === 'POLL') {
            await stream.writeSSE({
              event: 'booking_update',
              data: JSON.stringify({
                interviewId: r.id,
                status: r.status,
                scheduledAt: r.scheduled_at,
                meetingUrl: r.meeting_url,
                recipientName: r.recipient_name,
                recipientEmail: r.recipient_email,
                candidateId: r.candidate_id,
                syncSource: r.sync_source,
                updatedAt: r.updated_at,
              }),
            });
          }
        }

        lastCheck = new Date().toISOString();
        await stream.sleep(5000);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[scheduling/events] SSE error:', msg);
    }
  });

  response.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  response.headers.set('Cache-Control', 'no-cache');
  response.headers.set('Connection', 'keep-alive');
  return response;
});

export { schedulingAuth, schedulingPublic };
