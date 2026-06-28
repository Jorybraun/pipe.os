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
import { ensureUsableCandidateInviteToken } from '../../lib/candidateInviteTokens';
import { ensureMeetingRoomLinks, withDevBasicAuth } from '../meetingRooms';
import {
  LivingContextStore,
  deterministicEntityId,
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  loadCandidateLivingContext,
  loadContactLivingContext,
} from '../../lib/livingContext';
import { AssessmentLayerStore } from '../../lib/assessmentLayer/persistence';
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

type ScheduledAssessmentSetupStatus =
  | 'not_applicable'
  | 'reviewable_task_assigned'
  | 'missing_reviewable_task'
  | 'waiting_for_candidate_evidence'
  | 'waiting_for_source_backed_match';

type ScheduledAssessmentSetupKind =
  | 'not_applicable'
  | 'github_pr'
  | 'matched_repo_without_pr'
  | 'auto_match';

type ScheduledAssessmentSetupSource =
  | 'not_workspace_assessment'
  | 'recruiter_manual_override'
  | 'matched_repo_id'
  | 'contact_first_invite'
  | 'candidate_id';

interface ScheduledAssessmentSetupProjection {
  status: ScheduledAssessmentSetupStatus;
  kind: ScheduledAssessmentSetupKind;
  source: ScheduledAssessmentSetupSource;
  blocksPositiveAssessment: boolean;
  message: string | null;
}

function buildScheduledAssessmentSetup(input: {
  interviewType: string | null | undefined;
  candidateId: string | null | undefined;
  matchedRepoId: number | null | undefined;
  githubRepoUrl: string | null | undefined;
  githubPrNumber: number | null | undefined;
}): ScheduledAssessmentSetupProjection {
  if (!isWorkspaceAssessmentInterviewType(input.interviewType)) {
    return {
      status: 'not_applicable',
      kind: 'not_applicable',
      source: 'not_workspace_assessment',
      blocksPositiveAssessment: false,
      message: null,
    };
  }

  if (input.githubRepoUrl && input.githubPrNumber) {
    return {
      status: 'reviewable_task_assigned',
      kind: 'github_pr',
      source: 'recruiter_manual_override',
      blocksPositiveAssessment: false,
      message: 'A concrete GitHub PR was assigned by the recruiter. PIPE can launch that task, but candidate-specific alignment is not inferred from this manual override.',
    };
  }

  if (input.matchedRepoId) {
    return {
      status: 'missing_reviewable_task',
      kind: 'matched_repo_without_pr',
      source: 'matched_repo_id',
      blocksPositiveAssessment: true,
      message: 'A matched repository exists, but no GitHub PR or task was assigned. Treat this as an assessment setup gap, not candidate evidence.',
    };
  }

  if (!input.candidateId) {
    return {
      status: 'waiting_for_candidate_evidence',
      kind: 'auto_match',
      source: 'contact_first_invite',
      blocksPositiveAssessment: true,
      message: 'This contact-first assessment invite has no candidate evidence yet. PIPE must ingest source-backed resume, transcript, chat, or interview evidence before selecting a PR task.',
    };
  }

  return {
    status: 'waiting_for_source_backed_match',
    kind: 'auto_match',
    source: 'candidate_id',
    blocksPositiveAssessment: true,
    message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
  };
}

const createInterviewSchema = z.object({
  candidateId: z.string().min(1).optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
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
    const hasRepoUrlAndPr = Boolean(value.githubRepoUrl && value.githubPrNumber);
    const hasPartialManual = Boolean(value.githubRepoUrl) !== Boolean(value.githubPrNumber);
    if (hasPartialManual) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Manual repo override requires both githubRepoUrl and githubPrNumber, or omit both for auto-match.',
        path: ['githubRepoUrl'],
      });
    }
    if (hasMatchedRepo && hasRepoUrlAndPr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide either matchedRepoId or githubRepoUrl + githubPrNumber, not both.',
        path: ['matchedRepoId'],
      });
    }
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

const inviteToCallSchema = z.object({
  email: z.string().email(),
  message: z.string().max(1000).optional(),
  sendEmail: z.boolean().optional(),
});

const CONTEXT_CALL_QUESTIONS = [
  'Walk me through a real code review or debugging task that best matches the work PIPE should assess here.',
  'What did you inspect, what trade-offs mattered, and how did you verify the outcome?',
  'Which codebase constraints or PR style would make the assessment fair rather than misleading?',
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

type InterviewLivingContext = Awaited<ReturnType<typeof loadCandidateLivingContext>>;

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
    return loadCandidateLivingContext(db, interview.candidate_id);
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
  return loadContactLivingContext(db, contactId);
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
  reviewProfile: ScheduledCodeReviewReviewProfile | null;
  validatorAgent: ScheduledCodeReviewValidatorAgent | null;
  roleSources: ScheduledCodeReviewRoleSource[];
  evidence: ScheduledCodeReviewAlignment[];
  evidenceHyperedges: ScheduledCodeReviewHyperedge[];
  gaps: string[];
  evidencePlan: ScheduledCodeReviewEvidencePlanItem[];
  evidenceRefresh: ScheduledCodeReviewEvidenceRefresh | null;
}

interface ScheduledCodeReviewEvidenceRefresh {
  status: string;
  assessmentSessionId: string;
  contextCallInterviewId: string | null;
  reportId: string;
  summary: string;
  sourceSpanCount: number | null;
  matchRunId: string | null;
  matchStatus: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
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

function parseScheduledCodeReviewSourceRefs(value: unknown): ScheduledCodeReviewSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScheduledCodeReviewSourceRef[] => {
    if (!isRecord(item)) return [];
    const sourceRef: ScheduledCodeReviewSourceRef = {};
    const sourceRefType = optionalString(item.sourceRefType);
    const sourceRefId = optionalString(item.sourceRefId);
    const sourceSpanId = optionalString(item.sourceSpanId);
    const locator = optionalString(item.locator);
    const exactText = optionalString(item.exactText);
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
    const locator = optionalString(item.locator);
    const exactText = optionalString(item.exactText);
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
      question: CONTEXT_CALL_QUESTIONS[0],
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
      question: CONTEXT_CALL_QUESTIONS[2],
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
      question: CONTEXT_CALL_QUESTIONS[1],
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
    question: CONTEXT_CALL_QUESTIONS[0],
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
    reviewProfile: parseScheduledCodeReviewPacketReviewProfile(packet.packet_json),
    validatorAgent: scheduledManualCodeReviewValidator(interview.github_pr_number),
    roleSources: [],
    evidence: [],
    evidenceHyperedges: [],
    gaps: ['Manual override did not run automatic candidate-to-PR contrast ranking.'],
    evidencePlan: [],
    evidenceRefresh: null,
  };
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
    return {
      status,
      assessmentSessionId: row.assessment_session_id,
      contextCallInterviewId: optionalString(output.contextCallInterviewId)
        ?? optionalString(metadata.contextCallInterviewId)
        ?? row.context_call_interview_id,
      reportId: row.report_id,
      summary: row.report_summary,
      sourceSpanCount,
      matchRunId: optionalString(output.matchRunId) ?? optionalString(metadata.matchRunId) ?? null,
      matchStatus: optionalString(output.matchStatus) ?? optionalString(metadata.matchStatus) ?? null,
      completedAt: row.session_completed_at ?? row.report_created_at,
      updatedAt: row.report_updated_at ?? row.session_updated_at,
    };
  }

  return null;
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
    return manual ? { ...manual, evidenceRefresh } : null;
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
  const contrastGap = roleBackedContrastGapReason(selected, roleSources);
  const gaps = [
    ...summary.gaps,
    ...(contrastGap ? [contrastGap] : []),
  ];
  const uniqueGaps = [...new Set(gaps)];

  return {
    status: run.status,
    matchRunId: run.id,
    packetId: selectedPacketId,
    summary: summary.summary,
    score: selected?.score ?? null,
    assessmentQuality: normalizeScheduledCodeReviewAssessmentQuality(selected, roleSources),
    reviewProfile,
    validatorAgent: normalizeScheduledCodeReviewValidatorAgent(selected, roleSources),
    roleSources,
    evidence,
    evidenceHyperedges: buildScheduledCodeReviewHyperedges(evidence, roleSources),
    gaps: uniqueGaps,
    evidencePlan: buildCodeReviewEvidencePlan({
      matchStatus: run.status,
      matchRunId: run.id,
      gaps: uniqueGaps,
    }),
    evidenceRefresh,
  };
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
 * returning the candidate id + invite token. Used for workspace-backed
 * assessments so the email can include an assessment link that authenticates
 * the candidate through /assess/:token.
 */
async function ensureStandaloneCandidateForInterview(
  db: D1Database,
  ownerId: string,
  recipient: { name: string; email: string },
  interviewId: string,
): Promise<{ candidateId: string; inviteToken: string }> {
  const email = recipient.email.trim().toLowerCase();
  const name = recipient.name.trim();
  const existing = await db
    .prepare('SELECT id, invite_token FROM candidates WHERE owner_id = ? AND email = ? AND pipeline_id IS NULL')
    .bind(ownerId, email)
    .first<{ id: string; invite_token: string }>();

  if (existing) {
    // Link the interview to this candidate if not already linked
    await db
      .prepare('UPDATE scheduled_interviews SET candidate_id = ?, updated_at = ? WHERE id = ? AND candidate_id IS NULL')
      .bind(existing.id, new Date().toISOString(), interviewId)
      .run();
    const inviteToken = await ensureUsableCandidateInviteToken(db, existing.id, existing.invite_token);
    return { candidateId: existing.id, inviteToken };
  }

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
    await db.prepare(
      `INSERT INTO meetings
       (id, owner_id, title, description, status, scheduled_at, meeting_type,
        scheduled_interview_id, scheduling_provider, external_event_id,
        created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'SCHEDULED', ?5, 'INTERVIEW', ?6, ?7, ?8, ?9, ?9)`,
    ).bind(
      meetingId,
      ownerId,
      `${name} interview`,
      `${role} · ${stage}`,
      interview.scheduled_at,
      interview.id,
      interview.scheduling_provider ?? null,
      interview.external_event_id ?? null,
      now,
    ).run();
    meeting = { id: meetingId };
  } else {
    await db.prepare(
      `UPDATE meetings
          SET scheduled_at = ?1,
              scheduling_provider = COALESCE(?2, scheduling_provider),
              external_event_id = COALESCE(?3, external_event_id),
              updated_at = ?4
        WHERE id = ?5`,
    ).bind(
      interview.scheduled_at,
      interview.scheduling_provider ?? null,
      interview.external_event_id ?? null,
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

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
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
    `Scheduled at: ${input.scheduledAt ?? 'unscheduled'}`,
    `Scheduling provider: ${input.schedulingProvider ?? 'none'}`,
    `Scheduling URL: ${input.schedulingUrl ?? 'none'}`,
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
  roomUrl: string;
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
    `Room URL: ${input.roomUrl}`,
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
    meetingId: string;
    recipientEmail: string;
    subject: string;
    deliveredUrl: string;
    roomUrl: string;
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
      {
        entityType: 'meeting',
        entityId: input.meetingId,
        relationship: 'delivery_link_target',
      },
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
  emailSentAt: string | null;
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
            si.email_sent_at
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
    email_sent_at: string | null;
  }>().then((row) => row ? {
    id: row.id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    pipelineTitle: row.pipeline_title,
    stageTitle: row.stage_title,
    scheduledAt: row.scheduled_at,
    meetingUrl: row.meeting_url,
    emailSentAt: row.email_sent_at,
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

  if (!details || !recipientEmail || !meetingUrl || details.emailSentAt) return;

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
          SET email_sent_at = COALESCE(email_sent_at, ?1),
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

interface CalendlyInvitee {
  uri?: string;
  name?: string;
  email?: string;
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

  const result = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              si.completed_at, si.created_at, si.updated_at,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title,
              m.id AS meeting_id,
              m.scheduling_provider AS meeting_scheduling_provider,
              m.external_event_id AS meeting_external_event_id,
              mr.status AS room_status,
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
       LEFT JOIN meetings m ON m.id = (
         SELECT lm.id
           FROM meetings lm
          WHERE lm.scheduled_interview_id = si.id
            AND lm.owner_id = si.owner_id
          ORDER BY lm.created_at DESC
          LIMIT 1
       )
       LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
       WHERE si.owner_id = ?
       ORDER BY si.scheduled_at ASC`
    )
    .bind(userId)
    .all<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
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
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
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
      guest_waiting: number | null;
    }>();

  const interviews = (result.results ?? []).map((r) => {
    return {
      id: r.id,
      candidateId: r.candidate_id,
      pipelineId: r.pipeline_id,
      stageId: r.stage_id,
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
      recipientName: r.recipient_name,
      recipientEmail: r.recipient_email,
      matchedRepoId: r.matched_repo_id,
      githubRepoUrl: r.github_repo_url,
      githubPrNumber: r.github_pr_number,
      assessmentSetup: buildScheduledAssessmentSetup({
        interviewType: r.interview_type,
        candidateId: r.candidate_id,
        matchedRepoId: r.matched_repo_id,
        githubRepoUrl: r.github_repo_url,
        githubPrNumber: r.github_pr_number,
      }),
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
    };
  });

  return c.json({ interviews });
});

// GET /interviews/:id — scheduled interview detail
schedulingAuth.get('/interviews/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
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
       WHERE si.id = ? AND si.owner_id = ?`
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
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
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
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

  const transcriptArtifact = await db
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
    }>();

  const linkedMeeting = await db
    .prepare(
      `SELECT m.id, m.title, m.description, m.status, m.scheduled_at,
              m.started_at, m.ended_at, m.duration_secs, m.meeting_url,
              m.meeting_type, m.scheduling_provider, m.external_event_id,
              m.transcript_status, m.transcript_summary,
              m.transcript_json, m.transcript_analysis_json, m.transcript_error,
              m.recording_r2_key, m.created_at, m.updated_at,
              mr.id AS room_id, mr.session_id, mr.status AS room_status
       FROM meetings m
       LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
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
    }>();

  const livingContext = await loadScheduledInterviewLivingContext(db, userId, interview);
  const codeReviewMatch = await loadScheduledCodeReviewMatchDetail(db, interview);

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      contactId: interview.recipient_contact_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
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
      recipientName: interview.recipient_name,
      recipientEmail: interview.recipient_email,
      candidateName: interview.candidate_name,
      candidateEmail: interview.candidate_email,
      pipelineTitle: interview.pipeline_title,
      stageTitle: interview.stage_title,
      matchedRepoId: interview.matched_repo_id,
      githubRepoUrl: interview.github_repo_url,
      githubPrNumber: interview.github_pr_number,
      assessmentSetup: buildScheduledAssessmentSetup({
        interviewType: interview.interview_type,
        candidateId: interview.candidate_id,
        matchedRepoId: interview.matched_repo_id,
        githubRepoUrl: interview.github_repo_url,
        githubPrNumber: interview.github_pr_number,
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
        } : null,
        createdAt: linkedMeeting.created_at,
        updatedAt: linkedMeeting.updated_at,
      } : null,
      livingContext,
      codeReviewMatch,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
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
  const assessmentSetup = buildScheduledAssessmentSetup({
    interviewType: effectiveInterviewType,
    candidateId: candidateId ?? null,
    matchedRepoId: matchedRepoId ?? null,
    githubRepoUrl: githubRepoUrl ?? null,
    githubPrNumber: githubPrNumber ?? null,
  });
  const contactId = !candidateId && recipientName && recipientEmail
    ? await ensureRecipientContact(db, userId, { name: recipientName, email: recipientEmail })
    : null;

  await db
    .prepare(
      `INSERT INTO scheduled_interviews
       (id, candidate_id, pipeline_id, stage_id, owner_id, status,
        interview_type, meeting_type, scheduled_at, scheduling_provider,
        scheduling_url, recipient_name, recipient_email, sync_source,
        matched_repo_id, github_repo_url, github_pr_number,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?)`
    )
    .bind(
      id, candidateId ?? null, pipelineId ?? null, stageId ?? null, userId,
      effectiveInterviewType, effectiveMeetingType, scheduledAt ?? null,
      schedulingProvider ?? null, schedulingUrl ?? null,
      recipientName ?? null, recipientEmail?.trim().toLowerCase() ?? null,
      matchedRepoId ?? null, githubRepoUrl ?? null, githubPrNumber ?? null,
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
      schedulingUrl: schedulingUrl ?? null,
      createdAt: now,
    });
  }

  return c.json({
    interview: {
      id,
      candidateId: candidateId ?? null,
      contactId,
      pipelineId: pipelineId ?? null,
      stageId: stageId ?? null,
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail?.trim().toLowerCase() ?? null,
      meetingType: effectiveMeetingType,
      status: 'INVITED',
      interviewType: effectiveInterviewType,
      scheduledAt: scheduledAt ?? null,
      schedulingProvider: schedulingProvider ?? null,
      schedulingUrl: schedulingUrl ?? null,
      matchedRepoId: matchedRepoId ?? null,
      githubRepoUrl: githubRepoUrl ?? null,
      githubPrNumber: githubPrNumber ?? null,
      assessmentSetup,
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

  const contextCallId = crypto.randomUUID();
  const now = new Date().toISOString();
  const questions = [...CONTEXT_CALL_QUESTIONS];
  const gaps = match?.gaps.filter((gap) => gap.trim().length > 0) ?? [];
  const matchStatus = match?.status ?? 'NO_MATCH_DATA';
  const matchSummary = match?.summary ?? 'No source-backed match record was available when the context call was requested.';
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

  const roomLinks = await ensureScheduledInterviewRoomLinks(
    db,
    userId,
    c.env,
    interview,
    email,
  );
  const meetingUrl = roomLinks.guestUrl;
  const schedulingInviteUrl = interview.scheduling_url
    && (interview.scheduling_provider === 'CALENDLY' || interview.scheduling_provider === 'CAL_COM')
    ? withDevBasicAuth(interview.scheduling_url, c.env)
    : null;

  // For workspace-backed assessments, ensure a standalone
  // candidate exists so the email includes an assessment link that authenticates
  // the candidate and routes them to the code review / dev container challenge.
  const needsAssessmentLink = isWorkspaceAssessmentInterviewType(interview.interview_type);
  let assessUrl: string | null = null;
  if (needsAssessmentLink && !interview.candidate_id) {
    const recipientName = interview.candidate_name
      ?? interview.recipient_name
      ?? email.split('@')[0]
      ?? 'Candidate';
    const { inviteToken } = await ensureStandaloneCandidateForInterview(
      db,
      userId,
      { name: recipientName, email },
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

  // For assessment-type interviews, the candidate should land on the assess URL
  // (which renders the code review / dev container challenge), not the video room.
  // Assessment links also take precedence over any stale scheduling URL that may
  // exist on the row from earlier flows.
  const effectiveSchedulingInviteUrl = needsAssessmentLink ? null : schedulingInviteUrl;
  const deliveredUrl = assessUrl ?? effectiveSchedulingInviteUrl ?? meetingUrl;
  const inviteVerb = needsAssessmentLink ? 'start your assessment' : effectiveSchedulingInviteUrl ? 'schedule an interview' : 'join a video call';
  const inviteCta = needsAssessmentLink ? 'START ASSESSMENT' : effectiveSchedulingInviteUrl ? 'SCHEDULE INTERVIEW' : 'JOIN VIDEO CALL';
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
  const safeDeliveredUrl = encodeURI(deliveredUrl);

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
    : needsAssessmentLink
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
      contactId: roomLinks.contactId,
      ownerId: userId,
      interviewId: id,
      meetingId: roomLinks.meetingId,
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
      room: {
        id: roomLinks.roomId,
        sessionId: roomLinks.sessionId,
        hostUrl: roomLinks.hostUrl,
        guestUrl: roomLinks.guestUrl,
        expiresAt: roomLinks.expiresAt,
      },
    });
  }

  let result: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null;
  try {
    result = await sendTransactionalEmail(c.env, {
      to: email,
      subject,
      html,
    });
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error('[scheduling/invite] Email send failed:', err);
    await db
      .prepare(
        `UPDATE scheduled_interviews
         SET invite_link_sent_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, id)
      .run();
    await persistScheduledInterviewInviteDeliveryContext(db, {
      contactId: roomLinks.contactId,
      ownerId: userId,
      interviewId: id,
      meetingId: roomLinks.meetingId,
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
      emailError,
      meetingUrl,
      schedulingUrl: effectiveSchedulingInviteUrl,
      deliveredUrl,
      room: {
        id: roomLinks.roomId,
        sessionId: roomLinks.sessionId,
        hostUrl: roomLinks.hostUrl,
        guestUrl: roomLinks.guestUrl,
        expiresAt: roomLinks.expiresAt,
      },
    });
  }

  if (!result) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
         SET invite_link_sent_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, id)
      .run();
    await persistScheduledInterviewInviteDeliveryContext(db, {
      contactId: roomLinks.contactId,
      ownerId: userId,
      interviewId: id,
      meetingId: roomLinks.meetingId,
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
      room: {
        id: roomLinks.roomId,
        sessionId: roomLinks.sessionId,
        hostUrl: roomLinks.hostUrl,
        guestUrl: roomLinks.guestUrl,
        expiresAt: roomLinks.expiresAt,
      },
    });
  }

  // Update the interview to track the invite
  if (result) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
         SET invite_link_sent_at = ?, email_sent_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, now, now, id)
      .run();
  }

  await persistScheduledInterviewInviteDeliveryContext(db, {
    contactId: roomLinks.contactId,
    ownerId: userId,
    interviewId: id,
    meetingId: roomLinks.meetingId,
    recipientEmail: email.trim().toLowerCase(),
    subject,
    deliveredUrl,
    roomUrl: meetingUrl,
    customMessage: customMessage ?? null,
    emailSent: Boolean(result),
    providerMessageId: result.id,
    createdAt: now,
  });

  return c.json({
    success: true,
    emailSent: true,
    meetingUrl,
    schedulingUrl: effectiveSchedulingInviteUrl,
    deliveredUrl,
    provider: result.provider,
    room: {
      id: roomLinks.roomId,
      sessionId: roomLinks.sessionId,
      hostUrl: roomLinks.hostUrl,
      guestUrl: roomLinks.guestUrl,
      expiresAt: roomLinks.expiresAt,
    },
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
    interview = await db
      .prepare(
        `SELECT si.id, si.status
         FROM scheduled_interviews si
         LEFT JOIN candidates c ON c.id = si.candidate_id
         WHERE si.owner_id = ?
           AND (
             lower(COALESCE(c.email, '')) = ?
             OR lower(COALESCE(si.recipient_email, '')) = ?
           )
           AND si.status IN ('INVITED', 'SCHEDULED')
         ORDER BY si.created_at DESC LIMIT 1`
      )
      .bind(connection.owner_id, candidateEmail, candidateEmail)
      .first<{ id: string; status: string }>();
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

    return {
      externalEventId: (scheduledEvent?.['uri'] as string) ?? (p['uri'] as string) ?? '',
      status: event === 'invitee.canceled' ? 'CANCELLED' : 'SCHEDULED',
      scheduledAt: (scheduledEvent?.['start_time'] as string) ?? null,
      meetingUrl: (location?.['join_url'] as string) ?? null,
      candidateName: (p['name'] as string) ?? null,
      candidateEmail: (p['email'] as string) ?? null,
      interviewId: null,
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
