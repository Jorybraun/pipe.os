import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables } from '../../types';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentActorType,
  type AssessmentDiagnosticSeverity,
  type AssessmentEvidenceEventKind,
  type AssessmentEvaluationClaimPolarity,
  type EvaluationReportStatus,
  type RepoTaskInterviewMode,
  type RepoTaskInterviewState,
} from '../../lib/repoTaskInterviewSession';
import type { JsonObject, JsonValue } from '../../lib/livingContext/types';

const repoTaskSessions = new Hono<{ Bindings: Env; Variables: Variables }>();
repoTaskSessions.use('*', authMiddleware);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonValueSchema);

const modeSchema = z.enum([
  'STANDARD_VIDEO_INTERVIEW',
  'CODE_REVIEW',
  'DEV_CONTAINER_REPO_TASK',
  'OPEN_SOURCE_BUG_FIX',
  'NINETY_FIVE_UNTIL_INFINITY_ROOM',
  'CLIPPY_DEVIN_INTERACTION',
] satisfies [RepoTaskInterviewMode, ...RepoTaskInterviewMode[]]);

const stateSchema = z.enum([
  'INTAKE',
  'IN_PROGRESS',
  'FINAL_SUBMITTED',
  'EVALUATING',
  'EVALUATED',
  'DIAGNOSTIC',
  'CANCELLED',
] satisfies [RepoTaskInterviewState, ...RepoTaskInterviewState[]]);

const eventKindSchema = z.enum([
  'candidate_plan',
  'diagram',
  'message',
  'terminal_output',
  'test_run',
  'code_diff',
  'ai_interaction',
  'tool_usage',
  'transcript_span',
  'final_submission',
  'recruiter_note',
  'dev_container_event',
  'system_diagnostic',
] satisfies [AssessmentEvidenceEventKind, ...AssessmentEvidenceEventKind[]]);

const actorTypeSchema = z.enum([
  'candidate',
  'recruiter',
  'ai_developer',
  'clippy',
  'devin',
  'dev_container',
  'system',
] satisfies [AssessmentActorType, ...AssessmentActorType[]]);

const reportStatusSchema = z.enum([
  'EVALUATED',
  'NEEDS_MORE_EVIDENCE',
  'NO_ROLE_SAFE_CHALLENGE',
  'PROVENANCE_INCOMPLETE',
  'AI_DEVELOPER_UNAVAILABLE',
  'NEEDS_HUMAN_REVIEW',
] satisfies [EvaluationReportStatus, ...EvaluationReportStatus[]]);

const claimPolaritySchema = z.enum([
  'positive',
  'negative',
  'diagnostic',
] satisfies [AssessmentEvaluationClaimPolarity, ...AssessmentEvaluationClaimPolarity[]]);

const diagnosticSeveritySchema = z.enum([
  'info',
  'warning',
  'blocking',
] satisfies [AssessmentDiagnosticSeverity, ...AssessmentDiagnosticSeverity[]]);

const sourceRefSchema = z.object({
  sourceRefType: z.string().trim().min(1),
  sourceRefId: z.string().trim().min(1),
  sourceSpanId: z.string().trim().min(1).nullable().optional(),
  evidenceRole: z.string().trim().min(1).optional(),
  locator: jsonObjectSchema.optional(),
  exactText: z.string().min(1),
  contentHash: z.string().trim().min(1),
  metadata: jsonObjectSchema.optional(),
});

const createSessionSchema = z.object({
  ingestionKey: z.string().trim().min(1),
  interviewId: z.string().trim().min(1).nullable().optional(),
  candidateId: z.string().trim().min(1).nullable().optional(),
  workspaceId: z.string().trim().min(1).nullable().optional(),
  workspacePersonId: z.string().trim().min(1).nullable().optional(),
  applicationId: z.string().trim().min(1).nullable().optional(),
  mode: modeSchema,
  createdBy: z.string().trim().min(1).nullable().optional(),
  metadata: jsonObjectSchema.optional(),
});

const recordEventSchema = z.object({
  ingestionKey: z.string().trim().min(1),
  kind: eventKindSchema,
  actorType: actorTypeSchema,
  actorId: z.string().trim().min(1).nullable().optional(),
  narrative: z.string().trim().min(1),
  payload: jsonObjectSchema.optional(),
  occurredAt: z.string().trim().min(1).nullable().optional(),
  sourceRefs: z.array(sourceRefSchema).min(1),
});

const transitionStateSchema = z.object({
  toState: stateSchema,
  reason: z.string().trim().min(1),
  eventId: z.string().trim().min(1).nullable().optional(),
  createdBy: z.string().trim().min(1).nullable().optional(),
});

const claimSchema = z.object({
  id: z.string().trim().min(1),
  polarity: claimPolaritySchema,
  dimension: z.string().trim().min(1),
  narrative: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
  sourceRefs: z.array(sourceRefSchema).optional(),
});

const diagnosticSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1),
  severity: diagnosticSeveritySchema,
  message: z.string().trim().min(1),
  provider: z.string().trim().min(1).nullable().optional(),
  retryable: z.boolean().optional(),
  details: jsonObjectSchema.optional(),
  sourceRefs: z.array(sourceRefSchema).optional(),
});

const createEvaluationReportSchema = z.object({
  ingestionKey: z.string().trim().min(1),
  status: reportStatusSchema,
  summary: z.string().trim().min(1),
  output: jsonObjectSchema.optional(),
  claims: z.array(claimSchema),
  diagnostics: z.array(diagnosticSchema),
});

const aiProviderUnavailableSchema = z.object({
  provider: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  retryable: z.boolean().optional(),
  details: jsonObjectSchema.optional(),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function storeErrorResponse(c: Parameters<typeof apiError>[0], error: unknown): Response {
  const message = errorMessage(error);
  if (message.includes('does not exist')) return apiError(c, 'NOT_FOUND', message);
  if (
    message.includes('requires')
    || message.includes('cannot transition')
    || message.includes('positive evaluation claim')
    || message.includes('must be')
    || message.includes('is required')
  ) {
    return apiError(c, 'BAD_REQUEST', message);
  }
  console.error('[repoTaskSessions] request failed:', message);
  return apiError(c, 'SERVER_ERROR', message);
}

repoTaskSessions.post('/sessions', async (c) => {
  const body = createSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid assessment session body.');
  }
  try {
    const store = new RepoTaskInterviewSessionStore(c.env.DB);
    const session = await store.createSession(body.data);
    return c.json({ session }, 201);
  } catch (error) {
    return storeErrorResponse(c, error);
  }
});

repoTaskSessions.post('/sessions/:sessionId/events', async (c) => {
  const body = recordEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid assessment event body.');
  }
  try {
    const store = new RepoTaskInterviewSessionStore(c.env.DB);
    const event = await store.recordEvent({
      sessionId: c.req.param('sessionId'),
      ...body.data,
    });
    return c.json({ event }, 201);
  } catch (error) {
    return storeErrorResponse(c, error);
  }
});

repoTaskSessions.post('/sessions/:sessionId/state', async (c) => {
  const body = transitionStateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid state transition body.');
  }
  try {
    const store = new RepoTaskInterviewSessionStore(c.env.DB);
    const transition = await store.transitionState({
      sessionId: c.req.param('sessionId'),
      ...body.data,
    });
    return c.json({ transition });
  } catch (error) {
    return storeErrorResponse(c, error);
  }
});

repoTaskSessions.post('/sessions/:sessionId/evaluation-reports', async (c) => {
  const body = createEvaluationReportSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid evaluation report body.');
  }
  try {
    const store = new RepoTaskInterviewSessionStore(c.env.DB);
    const report = await store.createEvaluationReport({
      sessionId: c.req.param('sessionId'),
      ...body.data,
    });
    return c.json({ report }, 201);
  } catch (error) {
    return storeErrorResponse(c, error);
  }
});

repoTaskSessions.post('/sessions/:sessionId/diagnostics/ai-provider-unavailable', async (c) => {
  const body = aiProviderUnavailableSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return apiError(c, 'BAD_REQUEST', body.error.issues[0]?.message ?? 'Invalid AI diagnostic body.');
  }
  try {
    const store = new RepoTaskInterviewSessionStore(c.env.DB);
    const diagnostic = await store.recordAiProviderUnavailable({
      sessionId: c.req.param('sessionId'),
      ...body.data,
    });
    return c.json({ diagnostic }, 201);
  } catch (error) {
    return storeErrorResponse(c, error);
  }
});

export { repoTaskSessions };
