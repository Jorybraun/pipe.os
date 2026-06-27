import type {
  AssessmentActorType as CanonicalAssessmentActorType,
  AssessmentEvidenceSourceRefInput,
  AssessmentEvaluationClaimInput,
  AssessmentEvaluationDiagnosticInput,
  AssessmentEvaluationReport,
  AssessmentEvaluationStatus,
  AssessmentSession,
  AssessmentSessionMode,
  AssessmentSessionState,
} from './assessmentLayer/persistence';
import { AssessmentLayerStore } from './assessmentLayer/persistence';
import type { FinalRepoTaskAssessmentOutput } from './assessmentEvidence';
import { aiDeveloperUnavailableDiagnostic } from './assessmentEvidence';
import type { JsonObject, JsonValue } from './livingContext/types';

type Clock = () => string;

export type RepoTaskInterviewMode =
  | AssessmentSessionMode
  | 'STANDARD_VIDEO_INTERVIEW'
  | 'CLIPPY_DEVIN_INTERACTION';

export type RepoTaskInterviewState =
  | 'INTAKE'
  | 'IN_PROGRESS'
  | 'FINAL_SUBMITTED'
  | 'EVALUATING'
  | 'EVALUATED'
  | 'DIAGNOSTIC'
  | 'CANCELLED';

export type AssessmentEvidenceEventKind =
  | 'candidate_plan'
  | 'diagram'
  | 'message'
  | 'terminal_output'
  | 'test_run'
  | 'code_diff'
  | 'ai_interaction'
  | 'tool_usage'
  | 'transcript_span'
  | 'final_submission'
  | 'recruiter_note'
  | 'dev_container_event'
  | 'system_diagnostic';

export type RepoTaskAssessmentActorType =
  | CanonicalAssessmentActorType
  | 'ai_developer'
  | 'clippy'
  | 'devin';

export type EvaluationReportStatus = AssessmentEvaluationStatus;
export type AssessmentActorType = RepoTaskAssessmentActorType;
export type AssessmentEvaluationClaimPolarity = AssessmentEvaluationClaimInput['polarity'];
export type AssessmentDiagnosticSeverity = AssessmentEvaluationDiagnosticInput['severity'];
export type { AssessmentEvidenceSourceRefInput };

export interface CreateRepoTaskInterviewSessionInput {
  ingestionKey: string;
  interviewId?: string | null;
  candidateId?: string | null;
  workspaceId?: string | null;
  workspacePersonId?: string | null;
  applicationId?: string | null;
  mode: RepoTaskInterviewMode;
  createdBy?: string | null;
  metadata?: JsonObject;
}

export interface PersistedRepoTaskInterviewSession {
  id: string;
  ingestionKey: string;
  interviewId: string | null;
  candidateId: string | null;
  workspaceId: string | null;
  workspacePersonId: string | null;
  applicationId: string | null;
  mode: RepoTaskInterviewMode;
  state: RepoTaskInterviewState;
  createdAt: string;
  updatedAt: string;
}

export interface RecordAssessmentEventInput {
  sessionId: string;
  ingestionKey: string;
  kind: AssessmentEvidenceEventKind;
  actorType: RepoTaskAssessmentActorType;
  actorId?: string | null;
  narrative: string;
  payload?: JsonObject;
  occurredAt?: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}

export interface PersistedAssessmentEvent {
  id: string;
  sessionId: string;
  ingestionKey: string;
  sequence: number;
  kind: AssessmentEvidenceEventKind;
  contextRecordId: string | null;
}

export interface TransitionAssessmentStateInput {
  sessionId: string;
  toState: RepoTaskInterviewState;
  reason: string;
  eventId?: string | null;
  createdBy?: string | null;
}

export interface PersistedAssessmentStateTransition {
  id: string;
  sessionId: string;
  fromState: RepoTaskInterviewState;
  toState: RepoTaskInterviewState;
  reason: string;
}

export interface AssessmentEvaluationClaimInputCompat {
  id: string;
  polarity: AssessmentEvaluationClaimPolarity;
  dimension: string;
  narrative: string;
  confidence?: number | null;
  sourceRefs?: readonly AssessmentEvidenceSourceRefInput[];
}

export interface AssessmentDiagnosticInput {
  id?: string;
  code: string;
  severity: AssessmentDiagnosticSeverity;
  message: string;
  provider?: string | null;
  retryable?: boolean;
  details?: JsonObject;
  sourceRefs?: readonly AssessmentEvidenceSourceRefInput[];
}

export interface CreateEvaluationReportInput {
  sessionId: string;
  ingestionKey: string;
  status: EvaluationReportStatus;
  summary: string;
  output?: FinalRepoTaskAssessmentOutput | JsonObject;
  claims: readonly AssessmentEvaluationClaimInputCompat[];
  diagnostics: readonly AssessmentDiagnosticInput[];
}

export interface PersistedEvaluationReport {
  id: string;
  sessionId: string;
  status: EvaluationReportStatus;
  contextRecordId: string | null;
}

export interface PersistedAssessmentDiagnostic {
  id: string;
  sessionId: string;
  reportId: string | null;
  code: string;
  severity: AssessmentDiagnosticSeverity;
}

function toCanonicalState(state: RepoTaskInterviewState): AssessmentSessionState {
  if (state === 'EVALUATING') return 'EVALUATING';
  if (state === 'DIAGNOSTIC') return 'DIAGNOSTIC';
  return state;
}

function fromCanonicalState(state: AssessmentSessionState): RepoTaskInterviewState {
  if (state === 'EVALUATION_PENDING') return 'EVALUATING';
  if (state === 'BLOCKED') return 'DIAGNOSTIC';
  if (state === 'DIAGNOSTIC') return 'DIAGNOSTIC';
  if (state === 'EVALUATING') return 'EVALUATING';
  return state;
}

function toPersistedSession(
  session: AssessmentSession,
  input?: Pick<CreateRepoTaskInterviewSessionInput, 'workspacePersonId' | 'applicationId'>,
): PersistedRepoTaskInterviewSession {
  return {
    id: session.id,
    ingestionKey: session.ingestionKey,
    interviewId: session.interviewId,
    candidateId: session.candidateId,
    workspaceId: session.workspaceId,
    workspacePersonId: input?.workspacePersonId ?? null,
    applicationId: input?.applicationId ?? null,
    mode: session.mode,
    state: fromCanonicalState(session.state),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toReport(report: AssessmentEvaluationReport): PersistedEvaluationReport {
  return {
    id: report.id,
    sessionId: report.sessionId,
    status: report.status,
    contextRecordId: report.contextRecordId,
  };
}

function normalizeClaims(
  claims: readonly AssessmentEvaluationClaimInputCompat[],
): AssessmentEvaluationClaimInput[] {
  return claims.map((claim) => ({
    id: claim.id,
    polarity: claim.polarity,
    dimension: claim.dimension,
    narrative: claim.narrative,
    sourceRefs: claim.sourceRefs ?? [],
  }));
}

function normalizeDiagnostics(
  diagnostics: readonly AssessmentDiagnosticInput[],
): AssessmentEvaluationDiagnosticInput[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    metadata: {
      ...(diagnostic.provider ? { provider: diagnostic.provider } : {}),
      ...(diagnostic.retryable !== undefined ? { retryable: diagnostic.retryable } : {}),
      ...(diagnostic.details ?? {}),
    },
  }));
}

function outputToJsonValue(
  output: FinalRepoTaskAssessmentOutput | JsonObject | undefined,
): JsonValue | undefined {
  if (output === undefined) return undefined;
  return JSON.parse(JSON.stringify(output)) as JsonValue;
}

function primitiveDiagnosticDetails(
  details: JsonObject | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined;
  const primitives: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      primitives[key] = value;
    }
  }
  return Object.keys(primitives).length > 0 ? primitives : undefined;
}

export class RepoTaskInterviewSessionStore {
  readonly #store: AssessmentLayerStore;

  constructor(
    private readonly db: D1Database,
    clock: Clock = () => new Date().toISOString(),
  ) {
    this.#store = new AssessmentLayerStore(db, clock);
  }

  async createSession(
    input: CreateRepoTaskInterviewSessionInput,
  ): Promise<PersistedRepoTaskInterviewSession> {
    const metadata: JsonObject = { ...(input.metadata ?? {}) };
    if (input.workspacePersonId) metadata.workspacePersonId = input.workspacePersonId;
    if (input.applicationId) metadata.applicationId = input.applicationId;
    const session = await this.#store.createAssessmentSession({
      ingestionKey: input.ingestionKey,
      interviewId: input.interviewId,
      mode: input.mode,
      candidateId: input.candidateId,
      workspaceId: input.workspaceId,
      createdBy: input.createdBy,
      metadata,
    });
    return toPersistedSession(session, input);
  }

  async recordEvent(input: RecordAssessmentEventInput): Promise<PersistedAssessmentEvent> {
    const event = await this.#store.recordAssessmentEvent({
      sessionId: input.sessionId,
      ingestionKey: input.ingestionKey,
      kind: input.kind,
      actorType: input.actorType,
      actorId: input.actorId,
      narrative: input.narrative,
      payload: input.payload,
      occurredAt: input.occurredAt ?? undefined,
      sourceRefs: input.sourceRefs,
    });
    return {
      id: event.id,
      sessionId: event.sessionId,
      ingestionKey: event.ingestionKey,
      sequence: event.sequence,
      kind: event.kind as AssessmentEvidenceEventKind,
      contextRecordId: event.contextRecordId,
    };
  }

  async transitionState(
    input: TransitionAssessmentStateInput,
  ): Promise<PersistedAssessmentStateTransition> {
    const transition = await this.#store.transitionAssessmentState({
      sessionId: input.sessionId,
      toState: toCanonicalState(input.toState),
      reason: input.reason,
      actorId: input.createdBy,
    });
    return {
      id: transition.id,
      sessionId: transition.sessionId,
      fromState: fromCanonicalState(transition.fromState),
      toState: fromCanonicalState(transition.toState),
      reason: transition.reason,
    };
  }

  async createEvaluationReport(
    input: CreateEvaluationReportInput,
  ): Promise<PersistedEvaluationReport> {
    const report = await this.#store.createEvaluationReport({
      sessionId: input.sessionId,
      ingestionKey: input.ingestionKey,
      status: input.status,
      summary: input.summary,
      output: outputToJsonValue(input.output),
      claims: normalizeClaims(input.claims),
      diagnostics: normalizeDiagnostics(input.diagnostics),
    });
    return toReport(report);
  }

  async recordAiProviderUnavailable(input: {
    sessionId: string;
    provider: string;
    reason: string;
    retryable?: boolean;
    details?: JsonObject;
  }): Promise<PersistedAssessmentDiagnostic> {
    const diagnostic = aiDeveloperUnavailableDiagnostic({
      provider: input.provider,
      reason: input.reason,
      retryable: input.retryable,
      details: primitiveDiagnosticDetails(input.details),
    });
    return this.recordDiagnostic({
      code: diagnostic.code ?? 'AI_DEVELOPER_UNAVAILABLE',
      severity: 'blocking',
      message: diagnostic.reason,
      provider: diagnostic.provider,
      retryable: diagnostic.retryable,
      details: input.details,
    }, {
      sessionId: input.sessionId,
      reportId: null,
    });
  }

  async recordDiagnostic(
    diagnostic: AssessmentDiagnosticInput,
    context: { sessionId: string; reportId: string | null; createdAt?: string },
  ): Promise<PersistedAssessmentDiagnostic> {
    const report = await this.#store.createEvaluationReport({
      sessionId: context.sessionId,
      ingestionKey: diagnostic.id ?? `assessment-diagnostic:${context.sessionId}:${diagnostic.code}`,
      status: diagnostic.code === 'AI_DEVELOPER_UNAVAILABLE'
        ? 'AI_DEVELOPER_UNAVAILABLE'
        : 'NEEDS_HUMAN_REVIEW',
      summary: diagnostic.message,
      claims: [],
      diagnostics: normalizeDiagnostics([diagnostic]),
    });
    await this.#store.transitionAssessmentState({
      sessionId: context.sessionId,
      toState: 'DIAGNOSTIC',
      reason: diagnostic.message,
    });
    return {
      id: report.id,
      sessionId: context.sessionId,
      reportId: context.reportId,
      code: diagnostic.code,
      severity: diagnostic.severity,
    };
  }

  async loadSession(sessionId: string): Promise<PersistedRepoTaskInterviewSession> {
    const row = await this.db.prepare(
      `SELECT id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
              created_by, metadata_json, created_at, updated_at
         FROM assessment_sessions
        WHERE id = ?1`,
    ).bind(sessionId).first<{
      id: string;
      ingestion_key: string;
      interview_id: string | null;
      mode: AssessmentSessionMode;
      state: AssessmentSessionState;
      candidate_id: string | null;
      workspace_id: string | null;
      created_by: string | null;
      metadata_json: string;
      created_at: string;
      updated_at: string;
    }>();
    if (!row) throw new Error(`repo task interview session ${sessionId} does not exist`);
    const metadata = JSON.parse(row.metadata_json) as {
      workspacePersonId?: string | null;
      applicationId?: string | null;
    };
    return {
      id: row.id,
      ingestionKey: row.ingestion_key,
      interviewId: row.interview_id,
      candidateId: row.candidate_id,
      workspaceId: row.workspace_id,
      workspacePersonId: metadata.workspacePersonId ?? null,
      applicationId: metadata.applicationId ?? null,
      mode: row.mode,
      state: fromCanonicalState(row.state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
