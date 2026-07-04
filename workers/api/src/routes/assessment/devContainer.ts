/**
 * Dev Container routes — Phase 3b Cloudflare Containers migration (ADR-037).
 *
 * Mounts under /rpc/dev-container via rpcAuth (candidate JWT).
 *
 * Routes:
 *   POST /rpc/dev-container/launch              — spin up DO + container
 *   GET  /rpc/dev-container/:sessionId/status   — countdown + state
 *   POST /rpc/dev-container/:sessionId/destroy  — manual teardown
 *   ALL  /rpc/dev-container/:sessionId/proxy/*  — code-server passthrough (HTTP + WS)
 *
 * All routes assume candidateAuth has already populated candidateId + pipelineId.
 * Ownership is re-checked against dev_container_sessions in D1 before any DO call.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../types';
import type { CandidateVariables } from '../../middleware/candidateAuth';
import {
  computeEffectiveTtl,
  MIN_TTL_SECONDS,
  type TtlSource,
} from '../../lib/devContainerTtl';
import {
  insertSession,
  getChallengeTtlMeta,
  getSessionByIdForCandidate,
  markError,
  markStopped,
  mintExchangeToken,
  consumeExchangeToken,
  type DevContainerSessionRow,
} from '../../lib/devContainerSessions';
import { signJwt, verifyJwt } from '../../lib/jwt';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentProgressSnapshot,
  type CommitSubmissionChangedFileStatus,
} from '../../lib/repoTaskInterviewSession';
import type { JsonObject, JsonValue } from '../../lib/livingContext/types';

// ─── Defaults (used when the wrangler vars are not set) ─────────────────────

const DEFAULT_GLOBAL_TTL = 3600; // 60 min
const DEFAULT_MAX_TTL = 7200; // 2 hours
const DEFAULT_INSTANCE_TYPE = 'standard-1';
const MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS = 1_000;
const GIT_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;

const finalizeAllowedStatus: ReadonlySet<string> = new Set(['READY', 'SLEEPING']);

interface CandidateAssessmentSessionRow {
  id: string;
  mode: string;
  state: string;
}

const assessmentJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(assessmentJsonValueSchema),
  z.record(assessmentJsonValueSchema),
]));
const assessmentJsonObjectSchema: z.ZodType<JsonObject> = z.record(assessmentJsonValueSchema);

const sourceRefSchema = z.object({
  sourceRefType: z.string().trim().min(1),
  sourceRefId: z.string().trim().min(1),
  sourceSpanId: z.string().trim().min(1).nullable().optional(),
  evidenceRole: z.string().trim().min(1).optional(),
  locator: assessmentJsonObjectSchema.optional(),
  exactText: z.string().min(1),
  contentHash: z.string().trim().min(1),
  metadata: assessmentJsonObjectSchema.optional(),
});

const changedFileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
] satisfies [CommitSubmissionChangedFileStatus, ...CommitSubmissionChangedFileStatus[]]);

const changedFileSchema = z.object({
  path: z.string().trim().min(1),
  status: changedFileStatusSchema,
  previousPath: z.string().trim().min(1).nullable().optional(),
  additions: z.number().int().min(0).nullable().optional(),
  deletions: z.number().int().min(0).nullable().optional(),
});

const workspaceFinalizeRequestSchema = z.object({
  narrative: z.string().trim().min(1).optional(),
  testCommand: z.string().trim().min(1).max(1_000).optional(),
  verificationNotes: z.string().trim().min(1).max(4_000).optional(),
  forkRepositoryUrl: z.string().trim().min(1).nullable().optional(),
  commitUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPullRequestUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPrConsent: z.boolean().optional(),
});

const bridgeSubmissionPayloadSchema = z.object({
  narrative: z.string().trim().min(1),
  repositoryUrl: z.string().trim().min(1),
  forkRepositoryUrl: z.string().trim().min(1).nullable().optional(),
  branchName: z.string().trim().min(1),
  baseCommitSha: z.string().trim().min(1),
  commitSha: z.string().trim().min(1),
  commitUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPullRequestUrl: z.string().trim().min(1).nullable().optional(),
  upstreamPrConsent: z.boolean().optional(),
  changedFiles: z.array(changedFileSchema).min(1),
  occurredAt: z.string().trim().min(1).nullable().optional(),
  sourceRefs: z.array(sourceRefSchema).min(2),
});

const bridgeFinalizeResponseSchema = z.object({
  ok: z.literal(true),
  submitted: z.literal(false),
  submissionPayload: bridgeSubmissionPayloadSchema,
});

type WorkspaceFinalizeRequest = z.infer<typeof workspaceFinalizeRequestSchema>;
type BridgeSubmissionPayload = z.infer<typeof bridgeSubmissionPayloadSchema>;
type BridgeSubmissionSourceRef = BridgeSubmissionPayload['sourceRefs'][number];

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeDevContainerInitDiagnostic(value: string): string {
  const redacted = value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-[redacted]')
    .replace(/\b(cog_[A-Za-z0-9]{16,})\b/g, 'cog_[redacted]')
    .replace(/\b((?:DEVIN_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .trim();
  if (redacted.length <= MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS) return redacted;
  return `${redacted.slice(0, MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS)}\n[diagnostic truncated]`;
}

async function markInitFailedIfStillLaunching(input: {
  db: D1Database;
  sessionId: string;
  candidateId: string;
  diagnostic: string;
}): Promise<void> {
  const session = await getSessionByIdForCandidate(input.db, input.sessionId, input.candidateId);
  if (!session || session.status !== 'LAUNCHING') return;
  await markError(input.db, input.sessionId, input.diagnostic);
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

async function loadAssessmentSessionForDevContainer(
  db: D1Database,
  candidateId: string,
  devContainerSession: DevContainerSessionRow,
): Promise<CandidateAssessmentSessionRow | null> {
  if (!await assessmentSessionsTableExists(db)) return null;
  return db.prepare(
    `SELECT s.id, s.mode, s.state
       FROM assessment_sessions s
       LEFT JOIN scheduled_interviews si ON si.id = s.interview_id
      WHERE s.state <> 'CANCELLED'
        AND s.mode IN ('OPEN_SOURCE_BUG_FIX', 'DEV_CONTAINER_REPO_TASK', 'DEV_CONTAINER_CHALLENGE')
        AND (s.candidate_id = ?1 OR si.candidate_id = ?1)
        AND (
          s.workspace_id = ?2
          OR (?3 IS NOT NULL AND s.interview_id = ?3)
          OR (s.workspace_id IS NULL AND (?3 IS NULL OR s.interview_id IS NULL OR s.interview_id = ?3))
        )
      ORDER BY
        CASE
          WHEN s.workspace_id = ?2 THEN 0
          WHEN ?3 IS NOT NULL AND s.interview_id = ?3 THEN 1
          ELSE 2
        END,
        s.created_at DESC
      LIMIT 1`,
  ).bind(
    candidateId,
    devContainerSession.session_id,
    devContainerSession.meeting_id,
  ).first<CandidateAssessmentSessionRow>();
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

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function serializeCandidateAssessmentProgress(
  progress: AssessmentProgressSnapshot,
): JsonObject {
  return toJsonObject({
    mode: progress.session.mode,
    state: progress.session.state,
    stage: progress.stage,
    nextAction: progress.nextAction,
    nextActionLabel: progress.nextActionLabel,
    assignmentTrust: progress.assignmentTrust,
    readiness: progress.readiness,
    challengePacketContract: progress.challengePacketContract,
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
          upstreamPullRequestUrl: progress.commit.upstreamPullRequestUrl,
          upstreamPrConsent: progress.commit.upstreamPrConsent,
          submissionSource: progress.commit.submissionSource,
          submissionSourceLabel: progress.commit.submissionSourceLabel,
          integrity: progress.commit.integrity,
          challengeBinding: progress.commit.challengeBinding,
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
  });
}

function stringLocatorValue(locator: JsonObject | undefined, key: string): string | null {
  const value = locator?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function progressRepositoryUrl(progress: AssessmentProgressSnapshot): string | null {
  return progress.commit?.repositoryUrl
    ?? stringLocatorValue(progress.challenge?.locator, 'repositoryUrl')
    ?? stringLocatorValue(progress.challenge?.locator, 'githubRepoUrl')
    ?? stringLocatorValue(progress.challenge?.locator, 'repoUrl');
}

function progressBaseCommitSha(progress: AssessmentProgressSnapshot): string | null {
  const value = progress.commit?.baseCommitSha
    ?? stringLocatorValue(progress.challenge?.locator, 'baseCommitSha')
    ?? stringLocatorValue(progress.challenge?.locator, 'baseCommit')
    ?? stringLocatorValue(progress.challenge?.locator, 'base_commit_sha')
    ?? stringLocatorValue(progress.challenge?.locator, 'base_commit');
  return value && GIT_COMMIT_SHA_PATTERN.test(value) ? value.toLowerCase() : null;
}

function devContainerErrorResponse(message: string, status = 422): Response {
  return new Response(JSON.stringify({
    error: {
      code: status === 404
        ? 'NOT_FOUND'
        : status === 409
          ? 'CONFLICT'
          : status === 425
            ? 'NOT_READY'
            : status === 410
              ? 'SESSION_ENDED'
              : status >= 500
                ? 'INTERNAL_ERROR'
                : 'BAD_REQUEST',
      message,
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function storeErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Commit finalization failed.';
  if (message.includes('does not exist')) return devContainerErrorResponse(message, 404);
  if (
    message.includes('requires')
    || message.includes('must')
    || message.includes('cannot transition')
    || message.includes('is required')
  ) {
    return devContainerErrorResponse(message, 422);
  }
  console.error('[devContainer.assessment.finalize] failed:', { error: message });
  return devContainerErrorResponse('Commit finalization failed.', 500);
}

function bridgeErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : null;
}

function bridgePayloadHasVerificationEvidence(
  payload: z.infer<typeof bridgeSubmissionPayloadSchema>,
): boolean {
  return payload.sourceRefs.some((sourceRef) =>
    sourceRef.sourceRefType === 'test_run'
    || sourceRef.sourceRefType === 'verification_gap');
}

function bridgePayloadHasProcessTelemetry(
  payload: BridgeSubmissionPayload,
): boolean {
  return payload.sourceRefs.some((sourceRef) =>
    sourceRef.sourceRefType === 'terminal_command');
}

function bridgePayloadHasBoundSourceRefs(payload: BridgeSubmissionPayload): boolean {
  return payload.sourceRefs.some((sourceRef) =>
    sourceRef.sourceRefType === 'git_commit'
    && sourceRef.sourceRefId.toLowerCase() === payload.commitSha.toLowerCase()
    && bridgeSourceRefLocatorMatchesSubmittedCommit(sourceRef, payload, { requireBaseCommitSha: false }))
    && payload.sourceRefs.some((sourceRef) =>
      sourceRef.sourceRefType === 'code_diff'
      && sourceRef.sourceRefId.toLowerCase()
        === `${payload.baseCommitSha.toLowerCase()}..${payload.commitSha.toLowerCase()}`
      && bridgeSourceRefLocatorMatchesSubmittedCommit(sourceRef, payload, { requireBaseCommitSha: true }))
    && payload.sourceRefs.some((sourceRef) =>
      sourceRef.sourceRefType === 'terminal_command'
      && bridgeSourceRefLocatorMatchesSubmittedCommit(sourceRef, payload, { requireBaseCommitSha: true }))
    && payload.sourceRefs.some((sourceRef) =>
      (sourceRef.sourceRefType === 'test_run' || sourceRef.sourceRefType === 'verification_gap')
      && bridgeSourceRefLocatorMatchesSubmittedCommit(sourceRef, payload, { requireBaseCommitSha: true }));
}

function bridgeSourceRefLocatorMatchesSubmittedCommit(
  sourceRef: BridgeSubmissionSourceRef,
  payload: BridgeSubmissionPayload,
  options: { requireBaseCommitSha: boolean },
): boolean {
  const locatorRepositoryUrl = sourceRefLocatorString(sourceRef, 'repositoryUrl');
  if (!locatorRepositoryUrl) return false;

  const allowedRepositoryUrls = new Set(
    [payload.repositoryUrl, payload.forkRepositoryUrl ?? null]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeEvidenceRepositoryUrl),
  );
  if (!allowedRepositoryUrls.has(normalizeEvidenceRepositoryUrl(locatorRepositoryUrl))) return false;

  const locatorCommitSha = sourceRefLocatorString(sourceRef, 'commitSha')?.toLowerCase();
  if (locatorCommitSha !== payload.commitSha.toLowerCase()) return false;

  if (!options.requireBaseCommitSha) return true;
  const locatorBaseCommitSha = sourceRefLocatorString(sourceRef, 'baseCommitSha')?.toLowerCase();
  return locatorBaseCommitSha === payload.baseCommitSha.toLowerCase();
}

function sourceRefLocatorString(sourceRef: BridgeSubmissionSourceRef, key: string): string | null {
  const value = sourceRef.locator?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeEvidenceRepositoryUrl(value: string): string {
  return value.trim().replace(/\/+$/g, '').replace(/\.git$/i, '').toLowerCase();
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const devContainer = new Hono<{
  Bindings: Env;
  Variables: CandidateVariables;
}>();

// ─── POST /launch ────────────────────────────────────────────────────────────

interface LaunchRequestBody {
  challengeId?: string | null;
  ttlSecondsOverride?: number | null;
}

interface LaunchResponseBody {
  sessionId: string;
  status: 'LAUNCHING';
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
}

devContainer.post('/launch', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: LaunchRequestBody;
  try {
    body = (await c.req.json()) as LaunchRequestBody;
  } catch {
    body = {};
  }

  const challengeId =
    typeof body.challengeId === 'string' && body.challengeId.trim() !== ''
      ? body.challengeId.trim()
      : null;

  // Look up per-challenge TTL + repo metadata, if a challenge was specified.
  let challengeTtl: number | null = null;
  let repoGitUrl: string | null = null;
  let challengeBranch: string | null = null;
  if (challengeId) {
    const meta = await getChallengeTtlMeta(c.env.DB, challengeId, candidateId);
    if (meta) {
      challengeTtl = meta.dev_container_ttl_seconds;
      repoGitUrl = meta.repo_git_url;
      challengeBranch = meta.challenge_branch;
    }
  }

  // For pipeline-free candidates (standalone dev container challenge),
  // look up the repo URL from the scheduled_interviews table.
  if (!pipelineId && !repoGitUrl) {
    const interview = await c.env.DB.prepare(
      `SELECT github_repo_url, github_pr_number
       FROM scheduled_interviews
       WHERE candidate_id = ?1
         AND interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')
         AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<{ github_repo_url: string | null; github_pr_number: number | null }>();

    if (interview?.github_repo_url) {
      repoGitUrl = interview.github_repo_url;
    }
  }

  if (!pipelineId && !repoGitUrl) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No repository URL configured for this dev container challenge.' } }, 400);
  }

  // Per-launch admin override is honored only with the shared secret header.
  let override: number | null = null;
  const overrideHeader = c.req.header('X-Pipe-Admin-Override');
  const adminSecret = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (
    overrideHeader &&
    adminSecret &&
    overrideHeader === adminSecret &&
    typeof body.ttlSecondsOverride === 'number'
  ) {
    override = body.ttlSecondsOverride;
  }

  const globalDefault = parseIntEnv(
    c.env.DEV_CONTAINER_DEFAULT_TTL_SECONDS,
    DEFAULT_GLOBAL_TTL,
  );
  const hardCap = parseIntEnv(
    c.env.DEV_CONTAINER_MAX_TTL_SECONDS,
    DEFAULT_MAX_TTL,
  );

  let effective;
  try {
    effective = computeEffectiveTtl({
      globalDefault,
      challengeTtl,
      override,
      hardCap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid TTL configuration.';
    const isUserError = message.includes(`>= ${MIN_TTL_SECONDS}s`);
    return c.json(
      {
        error: {
          code: isUserError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
          message,
        },
      },
      isUserError ? 400 : 500,
    );
  }

  const sessionId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + effective.ttlSeconds * 1000,
  ).toISOString();

  try {
    await insertSession(c.env.DB, {
      id,
      sessionId,
      candidateId,
      challengeId,
      pipelineId: pipelineId ?? null,
      instanceType: DEFAULT_INSTANCE_TYPE,
      ttlSeconds: effective.ttlSeconds,
      ttlSource: effective.source,
      expiresAt,
      repoGitUrl,
      challengeBranch,
    });
  } catch (err) {
    console.error('[devContainer.launch] insert failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create session.' } },
      500,
    );
  }

  // Fire-and-forget the DO /__init call. The handler returns 201 LAUNCHING
  // immediately; the DO flips the D1 row to READY once the container is up.
  // Using executionCtx.waitUntil keeps the promise alive past the response.
  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  const initPromise = doStub
    .fetch('https://do.internal/__init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        expiresAt,
        ttlSeconds: effective.ttlSeconds,
        repoGitUrl,
        challengeBranch,
        agentType: 'devin',
        agentApiKey: c.env.DEVIN_API_KEY ?? null,
        agentOrgId: c.env.DEVIN_ORG_ID ?? null,
        pipeApiUrl: c.env.API_BASE_URL
          ?? c.env.APP_BASE_URL
          ?? `https://${c.req.header('host') ?? 'api.pipe.os'}`,
      }),
    })
    .then(async (response) => {
      if (response.ok) return;
      const responseText = await response.text().catch(() => '');
      const diagnostic = sanitizeDevContainerInitDiagnostic(
        `Dev-container init returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
      );
      console.error('[devContainer.launch] DO init returned non-OK:', diagnostic);
      await markInitFailedIfStillLaunching({
        db: c.env.DB,
        sessionId,
        candidateId,
        diagnostic,
      });
    })
    .catch(async (err: unknown) => {
      const diagnostic = sanitizeDevContainerInitDiagnostic(
        `Dev-container init request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('[devContainer.launch] DO init failed:', diagnostic);
      await markInitFailedIfStillLaunching({
        db: c.env.DB,
        sessionId,
        candidateId,
        diagnostic,
      });
    });
  c.executionCtx.waitUntil(initPromise);

  const response: LaunchResponseBody = {
    sessionId,
    status: 'LAUNCHING',
    ttlSeconds: effective.ttlSeconds,
    ttlSource: effective.source,
    expiresAt,
  };
  return c.json(response, 201);
});

// ─── GET /:sessionId/status ──────────────────────────────────────────────────

interface StatusResponseBody {
  sessionId: string;
  status: string;
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
  warnedAt: string | null;
  url: string | null;
  expiringSoon: boolean;
  errorMessage: string | null;
}

devContainer.get('/:sessionId/status', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  const response: StatusResponseBody = {
    sessionId: row.session_id,
    status: row.status,
    ttlSeconds: row.ttl_seconds,
    ttlSource: row.ttl_source,
    expiresAt: row.expires_at,
    warnedAt: row.warned_at,
    url: row.url,
    expiringSoon: row.warned_at != null,
    errorMessage: row.error_message,
  };
  return c.json(response, 200);
});

// ─── POST /:sessionId/destroy ────────────────────────────────────────────────

devContainer.post('/:sessionId/destroy', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  // Idempotent: already terminal states are success.
  if (row.status === 'STOPPED' || row.status === 'EXPIRED') {
    return c.json({ sessionId: row.session_id, status: row.status }, 200);
  }

  const stoppedAt = new Date().toISOString();
  try {
    await markStopped(c.env.DB, sessionId, stoppedAt);
  } catch (err) {
    console.error('[devContainer.destroy] update failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to destroy session.' } },
      500,
    );
  }

  // Tell the DO to stop the container and clear storage. Fire-and-forget
  // since the D1 status is already STOPPED — even if the DO call fails,
  // the session is logically terminated. The container will eventually
  // time out via the TTL alarm if this fails.
  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  const destroyPromise = doStub
    .fetch('https://do.internal/__destroy', { method: 'POST' })
    .catch((err: unknown) => {
      console.error('[devContainer.destroy] DO destroy failed:', err);
    });
  // waitUntil keeps the promise alive past the response; falls back to
  // fire-and-forget in test environments where executionCtx is not available.
  try {
    c.executionCtx.waitUntil(destroyPromise);
  } catch {
    // Test environment — no executionCtx available. The promise fires but
    // may not complete before the test exits. Acceptable for unit tests.
  }

  return c.json({ sessionId, status: 'STOPPED' }, 200);
});

// ─── POST /:sessionId/assessment/finalize ───────────────────────────────────
//
// Candidate-facing one-click commit submission. The Worker owns auth and
// persistence; the container bridge only inspects the actual git workspace and
// returns source-backed commit/diff/test evidence.

devContainer.post('/:sessionId/assessment/finalize', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');
  const requestBody = workspaceFinalizeRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!requestBody.success) {
    return devContainerErrorResponse(
      requestBody.error.issues[0]?.message ?? 'Invalid workspace finalization body.',
      422,
    );
  }

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return devContainerErrorResponse('Session not found.', 404);
  }

  if (!finalizeAllowedStatus.has(row.status)) {
    const status = row.status === 'LAUNCHING' ? 425 : 410;
    return devContainerErrorResponse(`Session is ${row.status}.`, status);
  }

  const assessmentSession = await loadAssessmentSessionForDevContainer(c.env.DB, candidateId, row);
  if (!assessmentSession) {
    return devContainerErrorResponse(
      'No open-source assessment session is available for this candidate.',
      409,
    );
  }

  const store = new RepoTaskInterviewSessionStore(c.env.DB);
  let progress: AssessmentProgressSnapshot;
  try {
    progress = await store.loadProgress(assessmentSession.id);
  } catch (error) {
    console.error('[devContainer.assessment.finalize] progress load failed:', {
      candidateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return devContainerErrorResponse('Assessment progress failed.', 500);
  }

  const repositoryUrl = row.repo_git_url ?? progressRepositoryUrl(progress);
  const baseCommitSha = row.base_commit_sha ?? progressBaseCommitSha(progress);
  if (!repositoryUrl || !baseCommitSha) {
    return devContainerErrorResponse(
      'Challenge packet must include repository URL and base commit SHA before workspace finalization.',
      409,
    );
  }

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  const upstream = await doStub.fetch('https://do.internal/assessment/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...requestBody.data,
      submitToPipe: false,
      repositoryUrl,
      baseCommitSha,
    }),
  }).catch((error: unknown) => {
    console.error('[devContainer.assessment.finalize] bridge fetch failed:', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!upstream) {
    return devContainerErrorResponse('Workspace finalizer bridge is unavailable.', 502);
  }

  const upstreamBody = await upstream.json().catch(() => null) as unknown;
  if (!upstream.ok) {
    const message = bridgeErrorMessage(upstreamBody)
      ?? `Workspace finalizer failed with HTTP ${upstream.status}.`;
    return devContainerErrorResponse(message, upstream.status === 409 ? 422 : 502);
  }

  const parsedBridge = bridgeFinalizeResponseSchema.safeParse(upstreamBody);
  if (!parsedBridge.success) {
    console.error('[devContainer.assessment.finalize] invalid bridge response:', parsedBridge.error.issues);
    return devContainerErrorResponse('Workspace finalizer returned invalid evidence payload.', 502);
  }

  const payload = parsedBridge.data.submissionPayload;
  if (!bridgePayloadHasVerificationEvidence(payload)) {
    return devContainerErrorResponse(
      'Workspace finalizer returned commit evidence without a test_run or verification_gap source ref.',
      502,
    );
  }
  if (!bridgePayloadHasProcessTelemetry(payload)) {
    return devContainerErrorResponse(
      'Workspace finalizer returned commit evidence without a terminal_command source ref.',
      502,
    );
  }
  if (!bridgePayloadHasBoundSourceRefs(payload)) {
    return devContainerErrorResponse(
      'Workspace finalizer source refs are not bound to the submitted repo/base/commit.',
      502,
    );
  }

  const commitSha = payload.commitSha.trim().toLowerCase();
  try {
    await store.submitCommit({
      sessionId: assessmentSession.id,
      ingestionKey: `assessment-event:candidate-workspace-finalize:${assessmentSession.id}:${commitSha}`,
      actorType: 'candidate',
      actorId: candidateId,
      narrative: payload.narrative,
      repositoryUrl: payload.repositoryUrl,
      forkRepositoryUrl: payload.forkRepositoryUrl ?? null,
      branchName: payload.branchName,
      baseCommitSha: payload.baseCommitSha,
      commitSha: payload.commitSha,
      commitUrl: payload.commitUrl ?? null,
      upstreamPullRequestUrl: payload.upstreamPullRequestUrl ?? null,
      upstreamPrConsent: payload.upstreamPrConsent,
      changedFiles: payload.changedFiles,
      occurredAt: payload.occurredAt,
      sourceRefs: payload.sourceRefs,
    });
    const updatedProgress = await store.loadProgress(assessmentSession.id);
    return c.json({
      submission: {
        accepted: true,
        repositoryUrl: updatedProgress.commit?.repositoryUrl ?? payload.repositoryUrl,
        branchName: updatedProgress.commit?.branchName ?? payload.branchName,
        commitSha: updatedProgress.commit?.commitSha ?? commitSha,
        commitUrl: updatedProgress.commit?.commitUrl ?? payload.commitUrl ?? null,
        upstreamPullRequestUrl: updatedProgress.commit?.upstreamPullRequestUrl ?? payload.upstreamPullRequestUrl ?? null,
        upstreamPrConsent: updatedProgress.commit?.upstreamPrConsent ?? payload.upstreamPrConsent === true,
      },
      progress: serializeCandidateAssessmentProgress(updatedProgress),
    }, 201);
  } catch (error) {
    return storeErrorResponse(error);
  }
});

// ─── POST /:sessionId/exchange-token ─────────────────────────────────────────
//
// Mint a short-lived, single-use exchange token for iframe auth. The client
// calls this endpoint with the candidate JWT, then embeds the exchange token
// in the iframe URL. This prevents the full JWT from leaking via Referer
// headers and browser history.

interface ExchangeTokenResponseBody {
  exchangeToken: string;
  expiresAt: string;
}

devContainer.post('/:sessionId/exchange-token', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  // Verify ownership before minting a token
  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  try {
    const { token, expiresAt } = await mintExchangeToken(
      c.env.DB,
      sessionId,
      candidateId,
    );
    const response: ExchangeTokenResponseBody = {
      exchangeToken: token,
      expiresAt,
    };
    return c.json(response, 201);
  } catch (err) {
    console.error('[devContainer.exchangeToken] mint failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to mint exchange token.' } },
      500,
    );
  }
});

// ─── ALL /:sessionId/proxy/* ─────────────────────────────────────────────────
//
// Transparent passthrough to the code-server container. Supports HTTP and
// WebSocket upgrades.
//
// Auth is handled in two ways:
//   1. candidateAuth middleware has set candidateId from JWT (header or ?token=)
//   2. ?exchangeToken= query param — consumed here, bypasses JWT requirement
//
// We strip the `/rpc/dev-container/:sessionId/proxy` prefix before forwarding
// so code-server sees the path it expects (root = `/`, assets = `/static/…`).

const PROXY_ALLOWED_STATUS: ReadonlySet<string> = new Set(['READY', 'SLEEPING']);
const PROXY_COOKIE_NAME = 'pipe_dev_container_proxy';
const PROXY_COOKIE_MAX_AGE_SECONDS = 3600;

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=') || null;
  }
  return null;
}

function buildProxyCookie(sessionId: string, token: string): string {
  return [
    `${PROXY_COOKIE_NAME}=${token}`,
    `Path=/rpc/dev-container-proxy/${encodeURIComponent(sessionId)}`,
    `Max-Age=${PROXY_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

function withProxyCookie(response: Response, sessionId: string, token: string | null): Response {
  if (!token) return response;
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', buildProxyCookie(sessionId, token));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

devContainer.all('/:sessionId/proxy/*', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  if (!PROXY_ALLOWED_STATUS.has(row.status)) {
    const code =
      row.status === 'LAUNCHING'
        ? 'NOT_READY'
        : row.status === 'ERROR'
          ? 'CONTAINER_ERROR'
          : 'SESSION_ENDED';
    const http = row.status === 'LAUNCHING' ? 425 : 410;
    return c.json(
      { error: { code, message: `Session is ${row.status}.` } },
      http,
    );
  }

  // Rewrite the URL to drop the proxy prefix. Anchors on the literal
  // `/proxy/` marker so we don't depend on Worker mount depth (`/rpc` in
  // production, `''` in unit tests driving the sub-app directly).
  const incoming = new URL(c.req.url);
  const marker = `/${sessionId}/proxy`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  // The candidate session token is a Worker-layer secret — don't leak it
  // into the container environment on every request.
  innerUrl.searchParams.delete('token');

  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);

  try {
    return await doStub.fetch(forwarded);
  } catch (err) {
    console.error('[devContainer.proxy] upstream failed:', err);
    return c.json(
      { error: { code: 'BAD_GATEWAY', message: 'Container proxy failed.' } },
      502,
    );
  }
});

// ─── Exchange-token proxy (public, no candidateAuth) ────────────────────────
//
// Separate router for iframe access via exchange tokens. This bypasses the
// candidateAuth middleware entirely — the exchange token IS the auth.
// Mounted on rpcPublic at /rpc/dev-container-proxy.

export const devContainerProxyPublic = new Hono<{ Bindings: Env }>();

devContainerProxyPublic.all('/:sessionId/*', async (c) => {
  const sessionId = c.req.param('sessionId');
  const url = new URL(c.req.url);
  const exchangeToken = url.searchParams.get('exchangeToken');
  let candidateId: string | null = null;
  let proxyCookieToken: string | null = null;

  if (exchangeToken) {
    // Consume the exchange token — single-use, validates ownership for the
    // first iframe request. We then set a scoped proxy cookie so code-server
    // redirects and asset requests do not need to keep the query token.
    const consumed = await consumeExchangeToken(c.env.DB, exchangeToken);
    if (!consumed) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired exchange token.' } },
        401,
      );
    }

    // Verify the token was issued for this session.
    if (consumed.sessionId !== sessionId) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Token not valid for this session.' } },
        403,
      );
    }

    const secret = c.env.SESSION_TOKEN_SECRET;
    if (!secret) {
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } },
        500,
      );
    }

    candidateId = consumed.candidateId;
    proxyCookieToken = await signJwt(
      { sub: consumed.candidateId, pid: sessionId },
      secret,
      PROXY_COOKIE_MAX_AGE_SECONDS,
    );
  } else {
    const secret = c.env.SESSION_TOKEN_SECRET;
    const cookieToken = readCookie(c.req.header('Cookie'), PROXY_COOKIE_NAME);
    const payload = secret && cookieToken ? await verifyJwt(cookieToken, secret) : null;
    if (!payload || payload.pid !== sessionId) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid proxy session.' } },
        401,
      );
    }
    candidateId = payload.sub;
  }

  // Look up the session to check status (we already validated ownership via token)
  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  if (!PROXY_ALLOWED_STATUS.has(row.status)) {
    const code =
      row.status === 'LAUNCHING'
        ? 'NOT_READY'
        : row.status === 'ERROR'
          ? 'CONTAINER_ERROR'
          : 'SESSION_ENDED';
    const http = row.status === 'LAUNCHING' ? 425 : 410;
    return c.json(
      { error: { code, message: `Session is ${row.status}.` } },
      http,
    );
  }

  // Rewrite URL for the DO proxy
  const incoming = new URL(c.req.url);
  const marker = `/${sessionId}`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  // Strip exchange token from forwarded request
  innerUrl.searchParams.delete('exchangeToken');

  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);

  try {
    const response = await doStub.fetch(forwarded);
    return withProxyCookie(response, sessionId, proxyCookieToken);
  } catch (err) {
    console.error('[devContainerProxyPublic] upstream failed:', err);
    return c.json(
      { error: { code: 'BAD_GATEWAY', message: 'Container proxy failed.' } },
      502,
    );
  }
});
