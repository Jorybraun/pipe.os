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
  | 'commit_submission'
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

export interface FinalSubmissionEvidenceArtifactInput {
  ingestionKey: string;
  kind: Exclude<AssessmentEvidenceEventKind, 'final_submission' | 'system_diagnostic'>;
  actorType: RepoTaskAssessmentActorType;
  actorId?: string | null;
  narrative: string;
  payload?: JsonObject;
  occurredAt?: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}

export interface SubmitFinalAssessmentBundleInput {
  sessionId: string;
  ingestionKey: string;
  actorType: RepoTaskAssessmentActorType;
  actorId?: string | null;
  narrative: string;
  payload?: JsonObject;
  occurredAt?: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
  artifacts: readonly FinalSubmissionEvidenceArtifactInput[];
}

export interface PersistedFinalAssessmentBundle {
  event: PersistedAssessmentEvent;
  artifactEvents: PersistedAssessmentEvent[];
  transition: PersistedAssessmentStateTransition | null;
}

export type CommitSubmissionChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied';

export interface CommitSubmissionChangedFileInput {
  path: string;
  status: CommitSubmissionChangedFileStatus;
  previousPath?: string | null;
  additions?: number | null;
  deletions?: number | null;
}

export interface SubmitCommitAssessmentInput {
  sessionId: string;
  ingestionKey: string;
  actorType: RepoTaskAssessmentActorType;
  actorId?: string | null;
  narrative: string;
  repositoryUrl: string;
  forkRepositoryUrl?: string | null;
  branchName: string;
  baseCommitSha: string;
  commitSha: string;
  commitUrl?: string | null;
  upstreamPullRequestUrl?: string | null;
  upstreamPrConsent?: boolean;
  changedFiles: readonly CommitSubmissionChangedFileInput[];
  occurredAt?: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}

export interface PersistedCommitAssessmentSubmission {
  event: PersistedAssessmentEvent;
  transition: PersistedAssessmentStateTransition | null;
}

export type AssessmentProgressStage =
  | 'WAITING_FOR_CHALLENGE'
  | 'CHALLENGE_READY'
  | 'WORK_IN_PROGRESS'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATED'
  | 'NEEDS_ATTENTION'
  | 'CANCELLED';

export type AssessmentProgressNextAction =
  | 'ASSIGN_CHALLENGE'
  | 'OPEN_ROOM_OR_WORKSPACE'
  | 'CAPTURE_WORK_EVIDENCE'
  | 'SUBMIT_COMMIT'
  | 'START_EVALUATION'
  | 'REVIEW_EVALUATION'
  | 'RESOLVE_DIAGNOSTIC'
  | 'NONE';

export interface AssessmentEvidenceKindCount {
  kind: string;
  count: number;
}

export interface AssessmentProgressSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole: string;
  exactText: string;
  contentHash: string;
  locator: JsonObject;
}

export interface AssessmentProgressLatestEvent {
  id: string;
  kind: string;
  sequence: number;
  occurredAt: string;
}

export interface AssessmentProgressCommit {
  eventId: string;
  repositoryUrl: string | null;
  forkRepositoryUrl: string | null;
  branchName: string | null;
  baseCommitSha: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  changedFiles: JsonValue[];
  occurredAt: string;
}

export interface AssessmentProgressEvaluation {
  id: string;
  status: EvaluationReportStatus;
  summary: string;
  createdAt: string;
}

export interface AssessmentProgressSnapshot {
  session: PersistedRepoTaskInterviewSession;
  stage: AssessmentProgressStage;
  nextAction: AssessmentProgressNextAction;
  nextActionLabel: string;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  hasTestEvidence: boolean;
  evidenceCounts: AssessmentEvidenceKindCount[];
  sourceRefCounts: AssessmentEvidenceKindCount[];
  challenge: AssessmentProgressSourceRef | null;
  latestEvent: AssessmentProgressLatestEvent | null;
  commit: AssessmentProgressCommit | null;
  evaluation: AssessmentProgressEvaluation | null;
}

const ALLOWED_TRANSITIONS: Record<RepoTaskInterviewState, readonly RepoTaskInterviewState[]> = {
  INTAKE: ['IN_PROGRESS', 'DIAGNOSTIC', 'CANCELLED'],
  IN_PROGRESS: ['FINAL_SUBMITTED', 'DIAGNOSTIC', 'CANCELLED'],
  FINAL_SUBMITTED: ['EVALUATING', 'DIAGNOSTIC', 'CANCELLED'],
  EVALUATING: ['EVALUATED', 'DIAGNOSTIC', 'CANCELLED'],
  DIAGNOSTIC: ['IN_PROGRESS', 'EVALUATING', 'CANCELLED'],
  EVALUATED: [],
  CANCELLED: [],
};

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
    confidence: claim.confidence,
    sourceRefs: claim.sourceRefs ?? [],
  }));
}

function normalizeDiagnostics(
  diagnostics: readonly AssessmentDiagnosticInput[],
): AssessmentEvaluationDiagnosticInput[] {
  return diagnostics.map((diagnostic) => ({
    ...(diagnostic.id ? { id: diagnostic.id } : {}),
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    sourceRefs: diagnostic.sourceRefs ?? [],
    metadata: {
      ...(diagnostic.provider ? { provider: diagnostic.provider } : {}),
      ...(diagnostic.retryable !== undefined ? { retryable: diagnostic.retryable } : {}),
      ...(diagnostic.details ?? {}),
    },
  }));
}

function hasNonDiagnosticEvaluationClaim(
  claims: readonly AssessmentEvaluationClaimInputCompat[],
): boolean {
  return claims.some((claim) => claim.polarity !== 'diagnostic');
}

function assertEvaluationReportStatusMatchesEvidence(input: CreateEvaluationReportInput): void {
  if (input.status !== 'EVALUATED') return;
  if (hasNonDiagnosticEvaluationClaim(input.claims)) return;

  throw new Error(
    'EVALUATED assessment report requires at least one non-diagnostic evaluation claim; '
    + 'diagnostic-only reports must use a diagnostic status.',
  );
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

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

function normalizeGitHubRepositoryUrl(value: string, fieldName: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a valid GitHub HTTPS repository URL`);
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`${fieldName} must be a GitHub HTTPS repository URL`);
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`${fieldName} must identify a GitHub owner and repository`);
  }
  const [owner, repoWithSuffix] = segments;
  if (!owner || !repoWithSuffix) {
    throw new Error(`${fieldName} must identify a GitHub owner and repository`);
  }
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!repo) {
    throw new Error(`${fieldName} must identify a GitHub owner and repository`);
  }
  return `https://github.com/${owner}/${repo}`;
}

function assertCommitSha(value: string, fieldName: string): void {
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a 40-character Git commit SHA`);
  }
}

function assertSafeBranchName(branchName: string): void {
  if (
    branchName.length === 0
    || branchName.length > 255
    || !SAFE_BRANCH_PATTERN.test(branchName)
    || branchName.startsWith('/')
    || branchName.endsWith('/')
    || branchName.includes('..')
    || branchName.includes('//')
    || branchName.includes('@{')
    || branchName.endsWith('.')
    || branchName.endsWith('.lock')
    || branchName.split('/').some((segment) => segment.startsWith('.'))
  ) {
    throw new Error('branchName must be a safe Git branch name');
  }
}

function normalizeCommitUrl(value: string | null | undefined, commitSha: string): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('commitUrl must be a valid GitHub commit URL');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || !url.pathname.includes('/commit/')
    || !url.pathname.toLowerCase().endsWith(commitSha.toLowerCase())
  ) {
    throw new Error('commitUrl must be a GitHub HTTPS commit URL for commitSha');
  }
  return url.toString();
}

function normalizePullRequestUrl(
  value: string | null | undefined,
  consent: boolean | undefined,
): string | null {
  if (!value) return null;
  if (consent !== true) {
    throw new Error('upstreamPrConsent is required before storing an upstreamPullRequestUrl');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('upstreamPullRequestUrl must be a valid GitHub pull request URL');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'github.com'
    || !/\/pull\/\d+$/.test(url.pathname)
  ) {
    throw new Error('upstreamPullRequestUrl must be a GitHub HTTPS pull request URL');
  }
  return url.toString();
}

function assertChangedFiles(files: readonly CommitSubmissionChangedFileInput[]): void {
  if (files.length === 0) {
    throw new Error('commit submission requires at least one changed file');
  }
  for (const file of files) {
    if (file.path.trim().length === 0 || file.path.startsWith('/') || file.path.includes('..')) {
      throw new Error('commit submission changed file path must be repository-relative');
    }
    if (file.previousPath && (file.previousPath.startsWith('/') || file.previousPath.includes('..'))) {
      throw new Error('commit submission previous file path must be repository-relative');
    }
  }
}

function assertCommitSubmissionSourceRefs(input: SubmitCommitAssessmentInput): void {
  const commitRef = input.sourceRefs.find((ref) =>
    ref.sourceRefType === 'git_commit'
    && ref.sourceRefId.toLowerCase() === input.commitSha.toLowerCase()
    && typeof ref.exactText === 'string'
    && ref.exactText.toLowerCase().includes(input.commitSha.toLowerCase()));
  if (!commitRef) {
    throw new Error('commit submission requires a git_commit source ref whose exact text contains commitSha');
  }

  const changedPaths = input.changedFiles.map((file) => file.path);
  const diffRef = input.sourceRefs.find((ref) => {
    if (ref.sourceRefType !== 'code_diff' || typeof ref.exactText !== 'string') return false;
    const exactText = ref.exactText;
    return exactText.includes('diff --git') || changedPaths.some((path) => exactText.includes(path));
  });
  if (!diffRef) {
    throw new Error('commit submission requires a code_diff source ref for the submitted changes');
  }
}

function changedFilesToJson(
  files: readonly CommitSubmissionChangedFileInput[],
): JsonValue[] {
  return files.map((file) => {
    const changedFile: JsonObject = {
      path: file.path,
      status: file.status,
    };
    if (file.previousPath) changedFile.previousPath = file.previousPath;
    if (file.additions !== undefined && file.additions !== null) changedFile.additions = file.additions;
    if (file.deletions !== undefined && file.deletions !== null) changedFile.deletions = file.deletions;
    return changedFile;
  });
}

function parseJsonObject(value: string | null): JsonObject {
  if (!value) return {};
  const parsed = JSON.parse(value) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return {};
  return parsed;
}

function jsonStringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function jsonArrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function hasEventKind(
  counts: readonly AssessmentEvidenceKindCount[],
  kinds: readonly string[],
): boolean {
  return counts.some((count) => kinds.includes(count.kind) && count.count > 0);
}

function modeRequiresCommit(mode: RepoTaskInterviewMode): boolean {
  return mode === 'OPEN_SOURCE_BUG_FIX' || mode === 'DEV_CONTAINER_REPO_TASK';
}

function progressNextActionLabel(action: AssessmentProgressNextAction): string {
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
    case 'REVIEW_EVALUATION':
      return 'Review the assessment report and evidence.';
    case 'RESOLVE_DIAGNOSTIC':
      return 'Resolve the blocking diagnostic before continuing.';
    case 'NONE':
      return 'No further assessment action is required.';
  }
}

function progressStageAndAction(input: {
  session: PersistedRepoTaskInterviewSession;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  evaluation: AssessmentProgressEvaluation | null;
}): { stage: AssessmentProgressStage; nextAction: AssessmentProgressNextAction } {
  if (input.session.state === 'CANCELLED') {
    return { stage: 'CANCELLED', nextAction: 'NONE' };
  }
  if (input.session.state === 'DIAGNOSTIC') {
    return { stage: 'NEEDS_ATTENTION', nextAction: 'RESOLVE_DIAGNOSTIC' };
  }
  if (input.evaluation) {
    if (input.evaluation.status === 'EVALUATED') {
      return { stage: 'EVALUATED', nextAction: 'REVIEW_EVALUATION' };
    }
    return { stage: 'NEEDS_ATTENTION', nextAction: 'RESOLVE_DIAGNOSTIC' };
  }
  if (!input.hasChallengePacket) {
    return { stage: 'WAITING_FOR_CHALLENGE', nextAction: 'ASSIGN_CHALLENGE' };
  }
  if (modeRequiresCommit(input.session.mode) && !input.hasCommitSubmission) {
    if (input.hasWorkEvidence || input.hasFinalSubmission) {
      return { stage: 'WORK_IN_PROGRESS', nextAction: 'SUBMIT_COMMIT' };
    }
    return { stage: 'CHALLENGE_READY', nextAction: 'OPEN_ROOM_OR_WORKSPACE' };
  }
  if (input.hasCommitSubmission || input.hasFinalSubmission || input.session.state === 'FINAL_SUBMITTED') {
    return { stage: 'READY_FOR_EVALUATION', nextAction: 'START_EVALUATION' };
  }
  if (input.hasWorkEvidence) {
    return { stage: 'WORK_IN_PROGRESS', nextAction: 'CAPTURE_WORK_EVIDENCE' };
  }
  return { stage: 'CHALLENGE_READY', nextAction: 'OPEN_ROOM_OR_WORKSPACE' };
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
    const session = await this.loadSession(input.sessionId);
    if (session.state === input.toState) {
      return {
        id: `assessment_state_transition_noop_${session.id}_${input.toState}`,
        sessionId: session.id,
        fromState: session.state,
        toState: input.toState,
        reason: input.reason,
      };
    }
    if (!ALLOWED_TRANSITIONS[session.state].includes(input.toState)) {
      throw new Error(`cannot transition assessment session from ${session.state} to ${input.toState}`);
    }
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

  async submitFinalBundle(
    input: SubmitFinalAssessmentBundleInput,
  ): Promise<PersistedFinalAssessmentBundle> {
    const initialSession = await this.loadSession(input.sessionId);
    if (initialSession.state === 'INTAKE') {
      await this.transitionState({
        sessionId: input.sessionId,
        toState: 'IN_PROGRESS',
        reason: 'Final submission bundle received.',
        createdBy: input.actorId,
      });
    }

    const artifactEvents: PersistedAssessmentEvent[] = [];
    for (const artifact of input.artifacts) {
      artifactEvents.push(await this.recordEvent({
        sessionId: input.sessionId,
        ingestionKey: artifact.ingestionKey,
        kind: artifact.kind,
        actorType: artifact.actorType,
        actorId: artifact.actorId,
        narrative: artifact.narrative,
        payload: artifact.payload,
        occurredAt: artifact.occurredAt,
        sourceRefs: artifact.sourceRefs,
      }));
    }

    const event = await this.recordEvent({
      sessionId: input.sessionId,
      ingestionKey: input.ingestionKey,
      kind: 'final_submission',
      actorType: input.actorType,
      actorId: input.actorId,
      narrative: input.narrative,
      payload: {
        ...(input.payload ?? {}),
        artifactEventIds: artifactEvents.map((artifactEvent) => artifactEvent.id),
        artifactKinds: artifactEvents.map((artifactEvent) => artifactEvent.kind),
      },
      occurredAt: input.occurredAt,
      sourceRefs: input.sourceRefs,
    });

    const latestSession = await this.loadSession(input.sessionId);
    const transition = latestSession.state === 'FINAL_SUBMITTED'
      ? null
      : await this.transitionState({
        sessionId: input.sessionId,
        toState: 'FINAL_SUBMITTED',
        reason: input.narrative,
        eventId: event.id,
        createdBy: input.actorId,
      });

    return {
      event,
      artifactEvents,
      transition,
    };
  }

  async submitCommit(
    input: SubmitCommitAssessmentInput,
  ): Promise<PersistedCommitAssessmentSubmission> {
    assertCommitSha(input.baseCommitSha, 'baseCommitSha');
    assertCommitSha(input.commitSha, 'commitSha');
    if (input.baseCommitSha.toLowerCase() === input.commitSha.toLowerCase()) {
      throw new Error('commitSha must differ from baseCommitSha');
    }
    assertSafeBranchName(input.branchName);
    assertChangedFiles(input.changedFiles);
    assertCommitSubmissionSourceRefs(input);

    const repositoryUrl = normalizeGitHubRepositoryUrl(input.repositoryUrl, 'repositoryUrl');
    const forkRepositoryUrl = input.forkRepositoryUrl
      ? normalizeGitHubRepositoryUrl(input.forkRepositoryUrl, 'forkRepositoryUrl')
      : null;
    const commitUrl = normalizeCommitUrl(input.commitUrl, input.commitSha);
    const upstreamPullRequestUrl = normalizePullRequestUrl(
      input.upstreamPullRequestUrl,
      input.upstreamPrConsent,
    );

    const initialSession = await this.loadSession(input.sessionId);
    if (!['INTAKE', 'IN_PROGRESS', 'FINAL_SUBMITTED'].includes(initialSession.state)) {
      throw new Error(
        `assessment session must be INTAKE, IN_PROGRESS, or FINAL_SUBMITTED before commit submission; `
        + `current state is ${initialSession.state}`,
      );
    }
    if (initialSession.state === 'INTAKE') {
      await this.transitionState({
        sessionId: input.sessionId,
        toState: 'IN_PROGRESS',
        reason: 'Commit submission received.',
        createdBy: input.actorId,
      });
    }

    const payload: JsonObject = {
      repositoryUrl,
      branchName: input.branchName,
      baseCommitSha: input.baseCommitSha.toLowerCase(),
      commitSha: input.commitSha.toLowerCase(),
      changedFiles: changedFilesToJson(input.changedFiles),
      upstreamPrConsent: input.upstreamPrConsent === true,
    };
    if (forkRepositoryUrl) payload.forkRepositoryUrl = forkRepositoryUrl;
    if (commitUrl) payload.commitUrl = commitUrl;
    if (upstreamPullRequestUrl) payload.upstreamPullRequestUrl = upstreamPullRequestUrl;

    const event = await this.recordEvent({
      sessionId: input.sessionId,
      ingestionKey: input.ingestionKey,
      kind: 'commit_submission',
      actorType: input.actorType,
      actorId: input.actorId,
      narrative: input.narrative,
      payload,
      occurredAt: input.occurredAt,
      sourceRefs: input.sourceRefs,
    });

    const latestSession = await this.loadSession(input.sessionId);
    const transition = latestSession.state === 'FINAL_SUBMITTED'
      ? null
      : await this.transitionState({
        sessionId: input.sessionId,
        toState: 'FINAL_SUBMITTED',
        reason: input.narrative,
        eventId: event.id,
        createdBy: input.actorId,
      });

    return {
      event,
      transition,
    };
  }

  async createEvaluationReport(
    input: CreateEvaluationReportInput,
  ): Promise<PersistedEvaluationReport> {
    assertEvaluationReportStatusMatchesEvidence(input);
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
    const row = await this.db.prepare(
      `SELECT id, session_id, report_id, code, severity
         FROM assessment_diagnostics
        WHERE report_id = ?1
          AND code = ?2
          AND severity = ?3
          AND message = ?4
        LIMIT 1`,
    ).bind(report.id, diagnostic.code, diagnostic.severity, diagnostic.message).first<{
      id: string;
      session_id: string;
      report_id: string | null;
      code: string;
      severity: AssessmentDiagnosticSeverity;
    }>();
    if (!row) throw new Error(`assessment diagnostic ${diagnostic.code} was not persisted`);
    return {
      id: row.id,
      sessionId: row.session_id,
      reportId: row.report_id,
      code: row.code,
      severity: row.severity,
    };
  }

  async loadProgress(sessionId: string): Promise<AssessmentProgressSnapshot> {
    const session = await this.loadSession(sessionId);
    const evidenceCounts = await this.loadEvidenceCounts(session.id);
    const sourceRefCounts = await this.loadSourceRefCounts(session.id);
    const challenge = await this.loadChallengeSourceRef(session.id);
    const latestEvent = await this.loadLatestEvent(session.id);
    const commit = await this.loadLatestCommitSubmission(session.id);
    const evaluation = await this.loadLatestEvaluation(session.id);

    const hasWorkEvidence = hasEventKind(evidenceCounts, [
      'terminal_output',
      'test_run',
      'code_diff',
      'ai_interaction',
      'tool_usage',
      'transcript_span',
      'dev_container_event',
      'message',
      'commit_submission',
    ]);
    const hasCommitSubmission = commit !== null;
    const hasFinalSubmission = hasEventKind(evidenceCounts, ['final_submission']);
    const hasAiInteraction = hasEventKind(evidenceCounts, ['ai_interaction']);
    const hasTranscriptEvidence = hasEventKind(evidenceCounts, ['transcript_span']);
    const hasTestEvidence = hasEventKind(evidenceCounts, ['test_run'])
      || hasEventKind(sourceRefCounts, ['test_run']);
    const hasChallengePacket = challenge !== null;
    const { stage, nextAction } = progressStageAndAction({
      session,
      hasChallengePacket,
      hasWorkEvidence,
      hasCommitSubmission,
      hasFinalSubmission,
      evaluation,
    });

    return {
      session,
      stage,
      nextAction,
      nextActionLabel: progressNextActionLabel(nextAction),
      hasChallengePacket,
      hasWorkEvidence,
      hasCommitSubmission,
      hasFinalSubmission,
      hasAiInteraction,
      hasTranscriptEvidence,
      hasTestEvidence,
      evidenceCounts,
      sourceRefCounts,
      challenge,
      latestEvent,
      commit,
      evaluation,
    };
  }

  private async loadEvidenceCounts(sessionId: string): Promise<AssessmentEvidenceKindCount[]> {
    const result = await this.db.prepare(
      `SELECT kind, COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?1
        GROUP BY kind
        ORDER BY kind`,
    ).bind(sessionId).all<{ kind: string; count: number }>();
    return (result.results ?? []).map((row) => ({
      kind: row.kind,
      count: row.count,
    }));
  }

  private async loadSourceRefCounts(sessionId: string): Promise<AssessmentEvidenceKindCount[]> {
    const result = await this.db.prepare(
      `SELECT sr.source_ref_type AS kind, COUNT(*) AS count
         FROM assessment_event_source_refs sr
         JOIN assessment_evidence_events e ON e.id = sr.event_id
        WHERE e.session_id = ?1
        GROUP BY sr.source_ref_type
        ORDER BY sr.source_ref_type`,
    ).bind(sessionId).all<{ kind: string; count: number }>();
    return (result.results ?? []).map((row) => ({
      kind: row.kind,
      count: row.count,
    }));
  }

  private async loadChallengeSourceRef(sessionId: string): Promise<AssessmentProgressSourceRef | null> {
    const row = await this.db.prepare(
      `SELECT sr.source_ref_type, sr.source_ref_id, sr.evidence_role, sr.exact_text, sr.content_hash, sr.locator_json
         FROM assessment_event_source_refs sr
         JOIN assessment_evidence_events e ON e.id = sr.event_id
        WHERE e.session_id = ?1
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
        ORDER BY e.sequence DESC, sr.created_at DESC
        LIMIT 1`,
    ).bind(sessionId).first<{
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
      locator_json: string | null;
    }>();
    if (!row) return null;
    return {
      sourceRefType: row.source_ref_type,
      sourceRefId: row.source_ref_id,
      evidenceRole: row.evidence_role,
      exactText: row.exact_text,
      contentHash: row.content_hash,
      locator: parseJsonObject(row.locator_json),
    };
  }

  private async loadLatestEvent(sessionId: string): Promise<AssessmentProgressLatestEvent | null> {
    const row = await this.db.prepare(
      `SELECT id, kind, sequence, occurred_at
         FROM assessment_evidence_events
        WHERE session_id = ?1
        ORDER BY sequence DESC
        LIMIT 1`,
    ).bind(sessionId).first<{
      id: string;
      kind: string;
      sequence: number;
      occurred_at: string;
    }>();
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
    };
  }

  private async loadLatestCommitSubmission(sessionId: string): Promise<AssessmentProgressCommit | null> {
    const row = await this.db.prepare(
      `SELECT id, payload_json, occurred_at
         FROM assessment_evidence_events
        WHERE session_id = ?1
          AND kind = 'commit_submission'
        ORDER BY sequence DESC
        LIMIT 1`,
    ).bind(sessionId).first<{
      id: string;
      payload_json: string;
      occurred_at: string;
    }>();
    if (!row) return null;
    const payload = parseJsonObject(row.payload_json);
    return {
      eventId: row.id,
      repositoryUrl: jsonStringValue(payload.repositoryUrl),
      forkRepositoryUrl: jsonStringValue(payload.forkRepositoryUrl),
      branchName: jsonStringValue(payload.branchName),
      baseCommitSha: jsonStringValue(payload.baseCommitSha),
      commitSha: jsonStringValue(payload.commitSha),
      commitUrl: jsonStringValue(payload.commitUrl),
      changedFiles: jsonArrayValue(payload.changedFiles),
      occurredAt: row.occurred_at,
    };
  }

  private async loadLatestEvaluation(sessionId: string): Promise<AssessmentProgressEvaluation | null> {
    const row = await this.db.prepare(
      `SELECT id, status, summary, created_at
         FROM assessment_evaluation_reports
        WHERE session_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    ).bind(sessionId).first<{
      id: string;
      status: EvaluationReportStatus;
      summary: string;
      created_at: string;
    }>();
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
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
