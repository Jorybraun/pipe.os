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
  | 'AI_DEVIN_INTERACTION';

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
  | 'match_decision'
  | 'recruiter_note'
  | 'human_assessment_decision'
  | 'dev_container_event'
  | 'system_diagnostic';

export type RepoTaskAssessmentActorType =
  | CanonicalAssessmentActorType
  | 'ai_developer'
  | 'agent'
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

export type HumanAssessmentDecisionValue =
  | 'advance'
  | 'hold'
  | 'reject'
  | 'needs_more_evidence';

export interface RecordHumanAssessmentDecisionInput {
  sessionId: string;
  ingestionKey: string;
  decision: HumanAssessmentDecisionValue;
  reviewerId?: string | null;
  summary: string;
  notes?: string | null;
  occurredAt?: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}

export interface PersistedHumanAssessmentDecision {
  eventId: string;
  decision: HumanAssessmentDecisionValue;
  reviewerId: string | null;
  summary: string;
  notes: string | null;
  occurredAt: string;
  sourceRefCount: number;
  sourceRefTypes: string[];
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

export interface AssessmentProgressChallengePacketContract {
  schemaVersion: 'challenge-packet-contract-v1';
  isComplete: boolean;
  missingFields: string[];
  hasRepositoryUrl: boolean;
  hasBaseCommitSha: boolean;
  hasTask: boolean;
  hasSuccessCriteria: boolean;
  hasExpectedEvidence: boolean;
}

export type AssessmentProgressChallengePacketContractInput = Pick<
  AssessmentProgressSourceRef,
  'exactText' | 'locator'
>;

export interface AssessmentProgressLatestEvent {
  id: string;
  kind: string;
  sequence: number;
  occurredAt: string;
}

export type AssessmentProgressCommitIntegrityStatus =
  | 'workspace_captured'
  | 'manual_needs_verification'
  | 'mixed_needs_review'
  | 'unknown_needs_review';

export type AssessmentProgressCommitChallengeBindingStatus =
  | 'bound_to_assigned_challenge'
  | 'missing_challenge_packet'
  | 'challenge_packet_missing_anchor'
  | 'commit_missing_anchor'
  | 'challenge_binding_mismatch';

export interface AssessmentProgressCommitIntegrity {
  status: AssessmentProgressCommitIntegrityStatus;
  label: string;
  detail: string;
  tone: 'verified' | 'warning' | 'neutral';
}

export interface AssessmentProgressCommitChallengeBinding {
  status: AssessmentProgressCommitChallengeBindingStatus;
  label: string;
  detail: string;
  tone: 'verified' | 'warning' | 'neutral';
}

export interface AssessmentProgressCommit {
  eventId: string;
  repositoryUrl: string | null;
  forkRepositoryUrl: string | null;
  branchName: string | null;
  baseCommitSha: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  submissionSource: 'live_workspace' | 'manual_fallback' | 'mixed' | 'unknown';
  submissionSourceLabel: string;
  integrity: AssessmentProgressCommitIntegrity;
  challengeBinding: AssessmentProgressCommitChallengeBinding;
  changedFiles: JsonValue[];
  occurredAt: string;
}

type CommitSubmissionSource = AssessmentProgressCommit['submissionSource'];

function commitSubmissionSourceLabel(source: CommitSubmissionSource): string {
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

function commitSubmissionIntegrity(source: CommitSubmissionSource): AssessmentProgressCommitIntegrity {
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

export interface AssessmentProgressEvidenceSnippet {
  eventKind: string;
  sourceRefType: string;
  evidenceRole: string;
  exactText: string;
  occurredAt: string;
}

export interface AssessmentEvidenceCoverageItem {
  label: string;
  required: boolean;
  sourceRefTypes: string[];
  satisfied: boolean;
  sourceRefKeys: string[];
  missingImpact: string;
}

export interface AssessmentEvidenceCoverageSnapshot {
  schemaVersion: string;
  sourceRefCount: number;
  sourceRefTypeCounts: Record<string, number>;
  requiredForEvaluation: AssessmentEvidenceCoverageItem[];
  expectedForHighConfidence: AssessmentEvidenceCoverageItem[];
}

export interface AssessmentProgressEvaluation {
  id: string;
  status: EvaluationReportStatus;
  summary: string;
  recommendation: string | null;
  createdAt: string;
  evidenceCoverage: AssessmentEvidenceCoverageSnapshot | null;
  claims: AssessmentProgressEvaluationClaim[];
  diagnostics: AssessmentProgressEvaluationDiagnostic[];
}

export interface AssessmentProgressEvaluationClaim {
  id: string;
  polarity: AssessmentEvaluationClaimPolarity;
  dimension: string;
  narrative: string;
  confidence: number | null;
  sourceRefCount: number;
  sourceRefTypes: string[];
}

export interface AssessmentProgressEvaluationDiagnostic {
  id: string;
  code: string;
  severity: string;
  message: string;
  sourceRefCount: number;
  sourceRefTypes: string[];
}

export interface AssessmentProgressHumanDecision extends PersistedHumanAssessmentDecision {}

export type AssessmentProgressAssignmentTrustState =
  | 'matched_challenge'
  | 'manual_challenge'
  | 'source_backed_challenge'
  | 'waiting_for_challenge';

export interface AssessmentProgressAssignmentTrust {
  state: AssessmentProgressAssignmentTrustState;
  label: string;
  detail: string;
  tone: 'matched' | 'manual' | 'waiting' | 'blocked' | 'neutral';
}

export type AssessmentProgressReadinessStatus =
  | 'WAITING_FOR_CHALLENGE'
  | 'READY_TO_START'
  | 'WORK_IN_PROGRESS'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATED'
  | 'NEEDS_ATTENTION'
  | 'CANCELLED';

export interface AssessmentProgressReadinessItem {
  id: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  sourceRefTypes: string[];
  missingImpact: string;
}

export interface AssessmentProgressReadinessSnapshot {
  status: AssessmentProgressReadinessStatus;
  label: string;
  detail: string;
  isReadyForEvaluation: boolean;
  isUsableHiringSignal: boolean;
  missingRequiredCount: number;
  required: AssessmentProgressReadinessItem[];
  confidence: AssessmentProgressReadinessItem[];
}

export interface AssessmentProgressSnapshot {
  session: PersistedRepoTaskInterviewSession;
  stage: AssessmentProgressStage;
  nextAction: AssessmentProgressNextAction;
  nextActionLabel: string;
  assignmentTrust: AssessmentProgressAssignmentTrust;
  readiness: AssessmentProgressReadinessSnapshot;
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
  evidenceCounts: AssessmentEvidenceKindCount[];
  sourceRefCounts: AssessmentEvidenceKindCount[];
  evidenceSnippets: AssessmentProgressEvidenceSnippet[];
  challenge: AssessmentProgressSourceRef | null;
  challengePacketContract: AssessmentProgressChallengePacketContract;
  latestEvent: AssessmentProgressLatestEvent | null;
  commit: AssessmentProgressCommit | null;
  evaluation: AssessmentProgressEvaluation | null;
  humanDecision: AssessmentProgressHumanDecision | null;
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
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const ASSESSMENT_PROGRESS_SNIPPET_TYPES = [
  'review_challenge_packet',
  'open_source_challenge_packet',
  'repo_task_challenge_packet',
  'challenge_packet',
  'git_commit',
  'code_diff',
  'test_run',
  'terminal_command',
  'terminal_output',
  'ai_usage_event',
  'room_chat_message',
  'meeting_transcript_segment',
] as const;
const MAX_ASSESSMENT_PROGRESS_SNIPPETS = 6;
const MAX_ASSESSMENT_PROGRESS_SNIPPET_CHARS = 1_200;
const HUMAN_ASSESSMENT_DECISIONS = new Set<HumanAssessmentDecisionValue>([
  'advance',
  'hold',
  'reject',
  'needs_more_evidence',
]);

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
const ASSESSMENT_BRANCH_NAME = 'pipe-assessment';

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

function assertAssessmentBranchName(branchName: string): void {
  if (
    branchName !== ASSESSMENT_BRANCH_NAME
    && !branchName.startsWith(`${ASSESSMENT_BRANCH_NAME}/`)
  ) {
    throw new Error('branchName must be pipe-assessment or a pipe-assessment/* branch');
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

function normalizedRepositoryUrlFromCommitUrl(value: string): string {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[2] !== 'commit') {
    throw new Error('commitUrl must be a GitHub HTTPS commit URL for commitSha');
  }
  const [owner, repoWithSuffix] = segments;
  if (!owner || !repoWithSuffix) {
    throw new Error('commitUrl must identify a GitHub owner and repository');
  }
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!repo) {
    throw new Error('commitUrl must identify a GitHub owner and repository');
  }
  return `https://github.com/${owner}/${repo}`;
}

function assertCommitUrlBelongsToSubmittedRepository(input: {
  commitUrl: string | null;
  repositoryUrl: string;
  forkRepositoryUrl: string | null;
}): void {
  if (!input.commitUrl) return;
  const commitRepositoryUrl = normalizedRepositoryUrlFromCommitUrl(input.commitUrl);
  const allowedRepositoryUrls = new Set<string>([input.repositoryUrl]);
  if (input.forkRepositoryUrl) {
    allowedRepositoryUrls.add(input.forkRepositoryUrl);
  }
  if (!allowedRepositoryUrls.has(commitRepositoryUrl)) {
    throw new Error('commitUrl must belong to repositoryUrl or forkRepositoryUrl');
  }
}

function normalizedRepositoryUrlFromPullRequestUrl(value: string): string {
  const url = new URL(value);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[2] !== 'pull') {
    throw new Error('upstreamPullRequestUrl must be a GitHub HTTPS pull request URL');
  }
  const [owner, repoWithSuffix] = segments;
  if (!owner || !repoWithSuffix) {
    throw new Error('upstreamPullRequestUrl must identify a GitHub owner and repository');
  }
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!repo) {
    throw new Error('upstreamPullRequestUrl must identify a GitHub owner and repository');
  }
  return `https://github.com/${owner}/${repo}`;
}

function normalizePullRequestUrl(
  value: string | null | undefined,
  consent: boolean | undefined,
  repositoryUrl: string,
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
  url.search = '';
  url.hash = '';
  const normalizedPullRequestUrl = url.toString();
  const pullRequestRepositoryUrl = normalizedRepositoryUrlFromPullRequestUrl(normalizedPullRequestUrl);
  if (pullRequestRepositoryUrl !== repositoryUrl) {
    throw new Error('upstreamPullRequestUrl must belong to repositoryUrl');
  }
  return normalizedPullRequestUrl;
}

function assertUpstreamPullRequestSourceRef(input: {
  upstreamPullRequestUrl: string | null;
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[];
}): void {
  if (!input.upstreamPullRequestUrl) return;
  const normalizedPullRequestUrl = input.upstreamPullRequestUrl.toLowerCase();
  const upstreamPullRequestRef = input.sourceRefs.find((ref) =>
    ref.sourceRefType === 'upstream_pull_request'
    && ref.sourceRefId.toLowerCase() === normalizedPullRequestUrl
    && typeof ref.exactText === 'string'
    && ref.exactText.toLowerCase().includes(normalizedPullRequestUrl));
  if (!upstreamPullRequestRef) {
    throw new Error('upstreamPullRequestUrl requires an upstream_pull_request source ref');
  }
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
    return diffSourceRefMatchesSubmittedRange(ref, input)
      && (exactText.includes('diff --git') || changedPaths.some((path) => exactText.includes(path)));
  });
  if (!diffRef) {
    throw new Error('commit submission requires a code_diff source ref for the submitted baseCommitSha..commitSha changes');
  }
}

function diffSourceRefMatchesSubmittedRange(
  ref: AssessmentEvidenceSourceRefInput,
  input: SubmitCommitAssessmentInput,
): boolean {
  const expectedRange = `${input.baseCommitSha.toLowerCase()}..${input.commitSha.toLowerCase()}`;
  if (ref.sourceRefId.toLowerCase() === expectedRange) {
    return true;
  }

  const locator = ref.locator ?? {};
  const locatorBaseCommitSha = stringLocatorValue(locator, 'baseCommitSha')?.toLowerCase();
  const locatorCommitSha = stringLocatorValue(locator, 'commitSha')?.toLowerCase();
  return locatorBaseCommitSha === input.baseCommitSha.toLowerCase()
    && locatorCommitSha === input.commitSha.toLowerCase();
}

function stringLocatorValue(locator: JsonObject, key: string): string | null {
  const value = locator[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function assertCommitSubmissionMatchesChallenge(
  input: SubmitCommitAssessmentInput,
  normalizedRepositoryUrl: string,
  challengeRef: AssessmentProgressSourceRef | null,
): void {
  if (!challengeRef) return;

  const assignedRepositoryUrl = challengeRepositoryUrl(challengeRef);
  if (assignedRepositoryUrl) {
    const normalizedAssignedRepositoryUrl = normalizeGitHubRepositoryUrl(
      assignedRepositoryUrl,
      'assigned challenge repositoryUrl',
    );
    if (normalizedAssignedRepositoryUrl !== normalizedRepositoryUrl) {
      throw new Error('repositoryUrl must be the assigned challenge repositoryUrl');
    }
  }

  const assignedBaseCommitSha = challengeBaseCommitSha(challengeRef);
  if (assignedBaseCommitSha) {
    assertCommitSha(assignedBaseCommitSha, 'assigned challenge baseCommitSha');
    if (assignedBaseCommitSha.toLowerCase() !== input.baseCommitSha.toLowerCase()) {
      throw new Error('baseCommitSha must be the assigned challenge baseCommitSha');
    }
  }
}

function assertCompleteCommitChallengePacket(challengeRef: AssessmentProgressSourceRef | null): void {
  const contract = challengePacketContract(challengeRef);
  if (contract.isComplete) return;
  throw new Error(
    `commit submission requires a complete source-backed challenge packet before candidate work can be accepted; `
    + `missing ${contract.missingFields.join(', ')}`,
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedSha256ContentHash(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const maybeHex = trimmed.startsWith('sha256:') ? trimmed.slice('sha256:'.length) : trimmed;
  return SHA256_HEX_PATTERN.test(maybeHex) ? maybeHex : null;
}

async function assertSourceRefContentHashes(
  sourceRefs: readonly AssessmentEvidenceSourceRefInput[],
): Promise<void> {
  for (const ref of sourceRefs) {
    if (typeof ref.exactText !== 'string' || ref.exactText.length === 0) {
      throw new Error('source ref exactText is required before hashing');
    }
    if (typeof ref.contentHash !== 'string' || ref.contentHash.length === 0) {
      throw new Error('source ref contentHash must be a SHA-256 hash of exactText');
    }
    const expectedHash = normalizedSha256ContentHash(ref.contentHash);
    if (!expectedHash) {
      throw new Error('source ref contentHash must be a SHA-256 hash of exactText');
    }
    const actualHash = await sha256Hex(ref.exactText);
    if (actualHash !== expectedHash) {
      throw new Error(`${ref.sourceRefType} source ref contentHash must match exactText`);
    }
  }
}

function assertHumanAssessmentDecision(value: HumanAssessmentDecisionValue): void {
  if (!HUMAN_ASSESSMENT_DECISIONS.has(value)) {
    throw new Error(`unsupported human assessment decision ${value}`);
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

function compactAssessmentSnippetText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_ASSESSMENT_PROGRESS_SNIPPET_CHARS) return normalized;
  return `${normalized.slice(0, MAX_ASSESSMENT_PROGRESS_SNIPPET_CHARS - 15).trimEnd()} [truncated]`;
}

function jsonStringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function jsonArrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function jsonStringArrayValue(value: JsonValue | undefined): string[] {
  return jsonArrayValue(value)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function jsonNumberValue(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonBooleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | null {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return null;
  return value;
}

function parseCoverageTypeCounts(value: JsonValue | undefined): Record<string, number> {
  const object = jsonObjectValue(value);
  if (!object) return {};
  const counts: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(object)) {
    const count = jsonNumberValue(rawCount);
    if (count !== null && count >= 0) counts[key] = count;
  }
  return counts;
}

function parseCoverageItem(value: JsonValue): AssessmentEvidenceCoverageItem | null {
  const object = jsonObjectValue(value);
  if (!object) return null;
  const label = jsonStringValue(object.label);
  const required = jsonBooleanValue(object.required);
  const satisfied = jsonBooleanValue(object.satisfied);
  if (!label || required === null || satisfied === null) return null;
  return {
    label,
    required,
    sourceRefTypes: jsonStringArrayValue(object.sourceRefTypes),
    satisfied,
    sourceRefKeys: jsonStringArrayValue(object.sourceRefKeys),
    missingImpact: jsonStringValue(object.missingImpact) ?? '',
  };
}

function parseCoverageItems(value: JsonValue | undefined): AssessmentEvidenceCoverageItem[] {
  return jsonArrayValue(value)
    .map(parseCoverageItem)
    .filter((item): item is AssessmentEvidenceCoverageItem => Boolean(item));
}

function parseEvidenceCoverage(output: JsonObject): AssessmentEvidenceCoverageSnapshot | null {
  const coverage = jsonObjectValue(output.evidenceCoverage);
  if (!coverage) return null;
  const schemaVersion = jsonStringValue(coverage.schemaVersion);
  if (schemaVersion !== 'assessment-evidence-coverage-v1') return null;

  return {
    schemaVersion,
    sourceRefCount: jsonNumberValue(coverage.sourceRefCount) ?? 0,
    sourceRefTypeCounts: parseCoverageTypeCounts(coverage.sourceRefTypeCounts),
    requiredForEvaluation: parseCoverageItems(coverage.requiredForEvaluation),
    expectedForHighConfidence: parseCoverageItems(coverage.expectedForHighConfidence),
  };
}

function hasEventKind(
  counts: readonly AssessmentEvidenceKindCount[],
  kinds: readonly string[],
): boolean {
  return counts.some((count) => kinds.includes(count.kind) && count.count > 0);
}

function challengePacketLineValue(exactText: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = exactText.match(new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || null;
}

function normalizeChallengePacketListItem(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function challengePacketSectionItems(exactText: string, labels: readonly string[]): string[] {
  const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()));
  const lines = exactText.split(/\r?\n/);
  const items: string[] = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^([A-Za-z][A-Za-z\s-]{2,})\s*:\s*$/);
    if (heading?.[1]) {
      const normalizedHeading = heading[1].trim().toLowerCase();
      inSection = normalizedLabels.has(normalizedHeading);
      continue;
    }
    if (!inSection) continue;
    if (/^[A-Za-z][A-Za-z\s-]{2,}\s*:/.test(line) && !/^[-*]|\d+[.)]/.test(line)) {
      inSection = false;
      continue;
    }
    const item = normalizeChallengePacketListItem(line);
    if (item) items.push(item);
  }

  return items;
}

function hasValidGitHubRepositoryUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    normalizeGitHubRepositoryUrl(value, 'challenge repositoryUrl');
    return true;
  } catch {
    return false;
  }
}

export function challengePacketContract(
  challenge: AssessmentProgressChallengePacketContractInput | null,
): AssessmentProgressChallengePacketContract {
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

  const repositoryUrl = challengeRepositoryUrl(challenge);
  const baseCommitSha = challengeBaseCommitSha(challenge);
  const task = challengePacketLineValue(challenge.exactText, ['Task', 'Title']);
  const successCriteria = [
    ...challengePacketSectionItems(challenge.exactText, ['Success criteria']),
    ...(challengePacketLineValue(challenge.exactText, ['Success'])
      ? [challengePacketLineValue(challenge.exactText, ['Success']) as string]
      : []),
  ];
  const expectedEvidence = challengePacketSectionItems(challenge.exactText, ['Expected evidence']);

  const contract = {
    schemaVersion: 'challenge-packet-contract-v1' as const,
    isComplete: false,
    missingFields: [] as string[],
    hasRepositoryUrl: hasValidGitHubRepositoryUrl(repositoryUrl),
    hasBaseCommitSha: Boolean(baseCommitSha && COMMIT_SHA_PATTERN.test(baseCommitSha)),
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

function challengeRepositoryUrl(challenge: AssessmentProgressChallengePacketContractInput): string | null {
  return stringLocatorValue(challenge.locator, 'repositoryUrl')
    ?? stringLocatorValue(challenge.locator, 'githubRepoUrl')
    ?? stringLocatorValue(challenge.locator, 'repoUrl')
    ?? challengePacketLineValue(challenge.exactText, ['Repo', 'Repository']);
}

function challengeBaseCommitSha(challenge: AssessmentProgressChallengePacketContractInput): string | null {
  return stringLocatorValue(challenge.locator, 'baseCommitSha')
    ?? stringLocatorValue(challenge.locator, 'baseCommit')
    ?? challengePacketLineValue(challenge.exactText, ['Base commit', 'Base commit SHA', 'Base']);
}

function commitChallengeBinding(input: {
  commitRepositoryUrl: string | null;
  commitBaseCommitSha: string | null;
  challenge: AssessmentProgressSourceRef | null;
}): AssessmentProgressCommitChallengeBinding {
  if (!input.challenge) {
    return {
      status: 'missing_challenge_packet',
      label: 'No assigned challenge binding',
      detail: 'The commit exists, but no assigned challenge packet is attached to prove what task it answers.',
      tone: 'warning',
    };
  }

  const assignedRepositoryUrl = challengeRepositoryUrl(input.challenge);
  const assignedBaseCommitSha = challengeBaseCommitSha(input.challenge);
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

  let normalizedAssignedRepositoryUrl: string;
  let normalizedCommitRepositoryUrl: string;
  try {
    normalizedAssignedRepositoryUrl = normalizeGitHubRepositoryUrl(
      assignedRepositoryUrl,
      'assigned challenge repositoryUrl',
    );
    normalizedCommitRepositoryUrl = normalizeGitHubRepositoryUrl(input.commitRepositoryUrl, 'commit repositoryUrl');
  } catch {
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

function progressAssignmentTrust(input: {
  session: PersistedRepoTaskInterviewSession;
  challenge: AssessmentProgressSourceRef | null;
}): AssessmentProgressAssignmentTrust {
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
      detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
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

function modeRequiresCommit(mode: RepoTaskInterviewMode): boolean {
  return mode === 'OPEN_SOURCE_BUG_FIX'
    || mode === 'DEV_CONTAINER_REPO_TASK'
    || mode === 'DEV_CONTAINER_CHALLENGE';
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
  hasCompleteChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasBoundCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  evaluation: AssessmentProgressEvaluation | null;
  humanDecision: AssessmentProgressHumanDecision | null;
}): { stage: AssessmentProgressStage; nextAction: AssessmentProgressNextAction } {
  if (input.session.state === 'CANCELLED') {
    return { stage: 'CANCELLED', nextAction: 'NONE' };
  }
  if (input.humanDecision) {
    return { stage: 'EVALUATED', nextAction: 'NONE' };
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
  if (!input.hasCompleteChallengePacket) {
    return { stage: 'WAITING_FOR_CHALLENGE', nextAction: 'ASSIGN_CHALLENGE' };
  }
  if (modeRequiresCommit(input.session.mode) && !input.hasBoundCommitSubmission) {
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

function assessmentReadinessStatusLabel(status: AssessmentProgressReadinessStatus): string {
  switch (status) {
    case 'WAITING_FOR_CHALLENGE':
      return 'Waiting for challenge';
    case 'READY_TO_START':
      return 'Ready to start';
    case 'WORK_IN_PROGRESS':
      return 'Work evidence in progress';
    case 'READY_FOR_EVALUATION':
      return 'Ready for evaluation';
    case 'EVALUATED':
      return 'Evaluated';
    case 'NEEDS_ATTENTION':
      return 'Needs attention';
    case 'CANCELLED':
      return 'Cancelled';
  }
}

function assessmentReadinessStatusDetail(input: {
  status: AssessmentProgressReadinessStatus;
  missingRequiredCount: number;
  requiresCommit: boolean;
  commit: AssessmentProgressCommit | null;
  evaluation: AssessmentProgressEvaluation | null;
  humanDecision: AssessmentProgressHumanDecision | null;
}): string {
  if (input.status === 'CANCELLED') return 'This assessment session was cancelled.';
  if (input.status === 'NEEDS_ATTENTION') return 'Resolve the diagnostic before relying on this assessment.';
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
  if (input.requiresCommit && input.commit?.integrity.status !== 'workspace_captured') {
    return 'Required evidence is captured, but commit provenance needs repository or workspace verification before final reliance.';
  }
  return 'Challenge, work evidence, and required source refs are captured; start source-backed AI or human evaluation.';
}

function buildAssessmentReadiness(input: {
  session: PersistedRepoTaskInterviewSession;
  hasChallengePacket: boolean;
  challengePacketContract: AssessmentProgressChallengePacketContract;
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
  sourceRefCounts: readonly AssessmentEvidenceKindCount[];
  commit: AssessmentProgressCommit | null;
  evaluation: AssessmentProgressEvaluation | null;
  humanDecision: AssessmentProgressHumanDecision | null;
}): AssessmentProgressReadinessSnapshot {
  const requiresCommit = modeRequiresCommit(input.session.mode);
  const hasCodeDiff = hasEventKind(input.sourceRefCounts, ['code_diff']);
  const hasGitCommit = hasEventKind(input.sourceRefCounts, ['git_commit']);
  const challengeMissingImpact = input.hasChallengePacket
    ? `Challenge packet is missing ${input.challengePacketContract.missingFields.join(', ')}.`
      + ' PIPE cannot prove the assigned task contract yet.'
    : 'Without a source-backed task packet, PIPE cannot prove what work was assigned.';
  const required: AssessmentProgressReadinessItem[] = [
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
      missingImpact: challengeMissingImpact,
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

  const confidence: AssessmentProgressReadinessItem[] = [
    {
      id: 'workspace_captured_commit',
      label: 'Workspace-captured commit',
      required: false,
      satisfied: !requiresCommit || input.commit?.integrity.status === 'workspace_captured',
      sourceRefTypes: ['git_commit', 'dev_container_workspace_state'],
      missingImpact: 'Manual commit evidence can start review, but workspace capture is needed for highest trust.',
    },
    {
      id: 'test_run',
      label: 'Test or verification evidence',
      required: false,
      satisfied: input.hasTestEvidence || input.hasVerificationGap,
      sourceRefTypes: ['test_run', 'verification_gap'],
      missingImpact: 'Missing test evidence lowers confidence; an explicit verification gap is better than silence.',
    },
    {
      id: 'ai_usage_transparency',
      label: 'AI-use transparency',
      required: false,
      satisfied: input.hasAiInteraction,
      sourceRefTypes: ['ai_usage_event'],
      missingImpact: 'If the candidate used AI, prompts and responses should be captured honestly.',
    },
    {
      id: 'transcript_context',
      label: 'Conversation transcript context',
      required: false,
      satisfied: input.hasTranscriptEvidence,
      sourceRefTypes: ['meeting_transcript_segment'],
      missingImpact: 'Transcript context helps explain reasoning, tradeoffs, and communication quality.',
    },
    {
      id: 'room_chat_context',
      label: 'Room chat context',
      required: false,
      satisfied: input.hasMessageEvidence,
      sourceRefTypes: ['room_chat_message'],
      missingImpact: 'Chat messages can preserve clarifications and collaboration evidence.',
    },
    {
      id: 'workspace_activity',
      label: 'Workspace and tool activity',
      required: false,
      satisfied: input.hasDevContainerEvidence || input.hasToolUsageEvidence,
      sourceRefTypes: [
        'dev_container_workspace_state',
        'code_server_file_observation',
        'terminal_command',
        'room_media_control',
      ],
      missingImpact: 'Workspace telemetry helps distinguish real implementation work from a pasted final answer.',
    },
  ];

  const missingRequiredCount = required.filter((item) => !item.satisfied).length;
  const isReadyForEvaluation = missingRequiredCount === 0
    && input.session.state !== 'CANCELLED'
    && input.session.state !== 'DIAGNOSTIC'
    && input.evaluation?.status !== 'PROVENANCE_INCOMPLETE'
    && input.evaluation?.status !== 'AI_DEVELOPER_UNAVAILABLE'
    && input.evaluation?.status !== 'BLOCKED';
  const hasReviewedOutcome = Boolean(input.humanDecision || input.evaluation?.status === 'EVALUATED');
  const commitHighTrust = !requiresCommit || input.commit?.integrity.status === 'workspace_captured';
  const isUsableHiringSignal = isReadyForEvaluation && hasReviewedOutcome && commitHighTrust;

  let status: AssessmentProgressReadinessStatus;
  if (input.session.state === 'CANCELLED') {
    status = 'CANCELLED';
  } else if (
    input.session.state === 'DIAGNOSTIC'
    || input.evaluation?.status === 'PROVENANCE_INCOMPLETE'
    || input.evaluation?.status === 'AI_DEVELOPER_UNAVAILABLE'
    || input.evaluation?.status === 'BLOCKED'
    || input.evaluation?.status === 'NEEDS_MORE_EVIDENCE'
    || input.evaluation?.status === 'NO_ROLE_SAFE_CHALLENGE'
    || input.evaluation?.status === 'NEEDS_HUMAN_REVIEW'
  ) {
    status = 'NEEDS_ATTENTION';
  } else if (input.humanDecision || input.evaluation?.status === 'EVALUATED') {
    status = 'EVALUATED';
  } else if (!input.challengePacketContract.isComplete) {
    status = 'WAITING_FOR_CHALLENGE';
  } else if (isReadyForEvaluation) {
    status = 'READY_FOR_EVALUATION';
  } else if (input.hasWorkEvidence || input.hasCommitSubmission || input.hasFinalSubmission) {
    status = 'WORK_IN_PROGRESS';
  } else {
    status = 'READY_TO_START';
  }

  return {
    status,
    label: assessmentReadinessStatusLabel(status),
    detail: assessmentReadinessStatusDetail({
      status,
      missingRequiredCount,
      requiresCommit,
      commit: input.commit,
      evaluation: input.evaluation,
      humanDecision: input.humanDecision,
    }),
    isReadyForEvaluation,
    isUsableHiringSignal,
    missingRequiredCount,
    required,
    confidence,
  };
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
    const isEvaluationFinalization = session.state === 'FINAL_SUBMITTED'
      && input.toState === 'EVALUATED'
      && await this.hasPersistedEvaluatedReport(session.id);
    if (!isEvaluationFinalization && !ALLOWED_TRANSITIONS[session.state].includes(input.toState)) {
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

  private async hasPersistedEvaluatedReport(sessionId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT id
         FROM assessment_evaluation_reports
        WHERE session_id = ?1
          AND status = 'EVALUATED'
        LIMIT 1`,
    ).bind(sessionId).first<{ id: string }>();
    return row !== null;
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
    assertAssessmentBranchName(input.branchName);
    assertChangedFiles(input.changedFiles);
    assertCommitSubmissionSourceRefs(input);
    await assertSourceRefContentHashes(input.sourceRefs);

    const repositoryUrl = normalizeGitHubRepositoryUrl(input.repositoryUrl, 'repositoryUrl');
    const forkRepositoryUrl = input.forkRepositoryUrl
      ? normalizeGitHubRepositoryUrl(input.forkRepositoryUrl, 'forkRepositoryUrl')
      : null;
    const commitUrl = normalizeCommitUrl(input.commitUrl, input.commitSha);
    assertCommitUrlBelongsToSubmittedRepository({
      commitUrl,
      repositoryUrl,
      forkRepositoryUrl,
    });
    const upstreamPullRequestUrl = normalizePullRequestUrl(
      input.upstreamPullRequestUrl,
      input.upstreamPrConsent,
      repositoryUrl,
    );
    assertUpstreamPullRequestSourceRef({
      upstreamPullRequestUrl,
      sourceRefs: input.sourceRefs,
    });
    const challengeRef = await this.loadChallengeSourceRef(input.sessionId);
    assertCompleteCommitChallengePacket(challengeRef);
    assertCommitSubmissionMatchesChallenge(input, repositoryUrl, challengeRef);

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

  async recordHumanDecision(
    input: RecordHumanAssessmentDecisionInput,
  ): Promise<PersistedHumanAssessmentDecision> {
    assertHumanAssessmentDecision(input.decision);
    const summary = input.summary.trim();
    if (!summary) {
      throw new Error('human assessment decision summary is required');
    }
    const session = await this.loadSession(input.sessionId);
    if (session.state === 'CANCELLED') {
      throw new Error('cannot record a human assessment decision for a cancelled assessment session');
    }
    await assertSourceRefContentHashes(input.sourceRefs);
    await this.assertHumanDecisionSourceRefsBacked(session.id, input.sourceRefs);

    const sourceRefTypes = Array.from(new Set(input.sourceRefs.map((sourceRef) => sourceRef.sourceRefType))).sort();
    const event = await this.recordEvent({
      sessionId: session.id,
      ingestionKey: input.ingestionKey,
      kind: 'human_assessment_decision',
      actorType: 'recruiter',
      actorId: input.reviewerId,
      narrative: summary,
      payload: {
        schemaVersion: 'human-assessment-decision-v1',
        decision: input.decision,
        notes: input.notes?.trim() || null,
        sourceRefCount: input.sourceRefs.length,
        sourceRefTypes,
      },
      occurredAt: input.occurredAt,
      sourceRefs: input.sourceRefs,
    });

    const decision = await this.loadHumanDecisionEvent(event.id);
    if (!decision) {
      throw new Error(`human assessment decision ${event.id} was not persisted`);
    }
    return decision;
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
    const evidenceSnippets = await this.loadEvidenceSnippets(session.id);
    const challenge = await this.loadChallengeSourceRef(session.id);
    const contract = challengePacketContract(challenge);
    const latestEvent = await this.loadLatestEvent(session.id);
    const commit = await this.loadLatestCommitSubmission(session.id, challenge);
    const evaluation = await this.loadLatestEvaluation(session.id);
    const humanDecision = await this.loadLatestHumanDecision(session.id);

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
    const hasMessageEvidence = hasEventKind(evidenceCounts, ['message'])
      || hasEventKind(sourceRefCounts, ['room_chat_message']);
    const hasDevContainerEvidence = hasEventKind(evidenceCounts, ['dev_container_event'])
      || hasEventKind(sourceRefCounts, [
        'dev_container_workspace_launch',
        'dev_container_workspace_stop',
        'dev_container_workspace_state',
        'code_server_file_observation',
        'code_server_editor_open',
      ]);
    const hasToolUsageEvidence = hasEventKind(evidenceCounts, ['tool_usage'])
      || hasEventKind(sourceRefCounts, [
        'room_media_control',
      ]);
    const hasTranscriptEvidence = hasEventKind(evidenceCounts, ['transcript_span']);
    const hasTestEvidence = hasEventKind(evidenceCounts, ['test_run'])
      || hasEventKind(sourceRefCounts, ['test_run']);
    const hasVerificationGap = hasEventKind(sourceRefCounts, ['verification_gap']);
    const hasChallengePacket = challenge !== null;
    const readiness = buildAssessmentReadiness({
      session,
      hasChallengePacket,
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
      sourceRefCounts,
      commit,
      evaluation,
      humanDecision,
    });
    const { stage, nextAction } = progressStageAndAction({
      session,
      hasCompleteChallengePacket: contract.isComplete,
      hasWorkEvidence,
      hasCommitSubmission,
      hasBoundCommitSubmission: !modeRequiresCommit(session.mode)
        || commit?.challengeBinding.status === 'bound_to_assigned_challenge',
      hasFinalSubmission,
      evaluation,
      humanDecision,
    });

    return {
      session,
      stage,
      nextAction,
      nextActionLabel: progressNextActionLabel(nextAction),
      assignmentTrust: progressAssignmentTrust({ session, challenge }),
      readiness,
      hasChallengePacket,
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
      evidenceCounts,
      sourceRefCounts,
      evidenceSnippets,
      challenge,
      challengePacketContract: contract,
      latestEvent,
      commit,
      evaluation,
      humanDecision,
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

  private async loadEvidenceSnippets(sessionId: string): Promise<AssessmentProgressEvidenceSnippet[]> {
    const result = await this.db.prepare(
      `SELECT e.kind AS event_kind,
              e.occurred_at,
              sr.source_ref_type,
              sr.evidence_role,
              sr.exact_text
         FROM assessment_event_source_refs sr
         JOIN assessment_evidence_events e ON e.id = sr.event_id
        WHERE e.session_id = ?1
          AND sr.source_ref_type IN (
            'review_challenge_packet',
            'open_source_challenge_packet',
            'repo_task_challenge_packet',
            'challenge_packet',
            'git_commit',
            'code_diff',
            'test_run',
            'terminal_command',
            'terminal_output',
            'ai_usage_event',
            'room_chat_message',
            'meeting_transcript_segment'
          )
          AND sr.exact_text IS NOT NULL
          AND trim(sr.exact_text) <> ''
        ORDER BY
          CASE sr.source_ref_type
            WHEN 'review_challenge_packet' THEN 0
            WHEN 'open_source_challenge_packet' THEN 0
            WHEN 'repo_task_challenge_packet' THEN 0
            WHEN 'challenge_packet' THEN 0
            WHEN 'git_commit' THEN 1
            WHEN 'code_diff' THEN 2
            WHEN 'test_run' THEN 3
            WHEN 'terminal_command' THEN 4
            WHEN 'terminal_output' THEN 4
            WHEN 'ai_usage_event' THEN 5
            WHEN 'room_chat_message' THEN 6
            WHEN 'meeting_transcript_segment' THEN 7
            ELSE 8
          END,
          e.sequence DESC,
          sr.created_at DESC
        LIMIT ${MAX_ASSESSMENT_PROGRESS_SNIPPETS}`,
    ).bind(sessionId).all<{
      event_kind: string;
      occurred_at: string;
      source_ref_type: string;
      evidence_role: string;
      exact_text: string;
    }>();

    const allowedTypes = new Set<string>(ASSESSMENT_PROGRESS_SNIPPET_TYPES);
    return (result.results ?? [])
      .filter((row) => allowedTypes.has(row.source_ref_type))
      .map((row) => ({
        eventKind: row.event_kind,
        sourceRefType: row.source_ref_type,
        evidenceRole: row.evidence_role,
        exactText: compactAssessmentSnippetText(row.exact_text),
        occurredAt: row.occurred_at,
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

  private async assertHumanDecisionSourceRefsBacked(
    sessionId: string,
    sourceRefs: readonly AssessmentEvidenceSourceRefInput[],
  ): Promise<void> {
    if (sourceRefs.length === 0) {
      throw new Error('human assessment decision requires at least one source ref');
    }
    for (const sourceRef of sourceRefs) {
      const isBacked = await this.isHumanDecisionSourceRefBacked(sessionId, sourceRef);
      if (!isBacked) {
        throw new Error(
          `human assessment decision source ref ${sourceRef.sourceRefType}:${sourceRef.sourceRefId} `
          + 'is not backed by assessment session evidence or evaluation output',
        );
      }
    }
  }

  private async isHumanDecisionSourceRefBacked(
    sessionId: string,
    sourceRef: AssessmentEvidenceSourceRefInput,
  ): Promise<boolean> {
    if (await this.isSourceRefBackedBySessionEvent(sessionId, sourceRef)) return true;
    if (sourceRef.sourceRefType === 'assessment_evaluation_report') {
      const report = await this.db.prepare(
        `SELECT id
           FROM assessment_evaluation_reports
          WHERE session_id = ?1
            AND id = ?2
            AND summary = ?3
          LIMIT 1`,
      ).bind(sessionId, sourceRef.sourceRefId, sourceRef.exactText).first<{ id: string }>();
      return report !== null;
    }
    if (sourceRef.sourceRefType === 'assessment_evaluation_claim') {
      const claim = await this.db.prepare(
        `SELECT c.id
           FROM assessment_evaluation_claims c
           JOIN assessment_evaluation_reports r ON r.id = c.report_id
          WHERE r.session_id = ?1
            AND c.id = ?2
            AND c.narrative = ?3
          LIMIT 1`,
      ).bind(sessionId, sourceRef.sourceRefId, sourceRef.exactText).first<{ id: string }>();
      return claim !== null;
    }
    if (sourceRef.sourceRefType === 'assessment_diagnostic') {
      const diagnostic = await this.db.prepare(
        `SELECT id
           FROM assessment_diagnostics
          WHERE session_id = ?1
            AND id = ?2
            AND message = ?3
          LIMIT 1`,
      ).bind(sessionId, sourceRef.sourceRefId, sourceRef.exactText).first<{ id: string }>();
      return diagnostic !== null;
    }
    return false;
  }

  private async isSourceRefBackedBySessionEvent(
    sessionId: string,
    sourceRef: AssessmentEvidenceSourceRefInput,
  ): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT r.event_id
         FROM assessment_event_source_refs r
         JOIN assessment_evidence_events e ON e.id = r.event_id
        WHERE e.session_id = ?1
          AND r.source_ref_type = ?2
          AND r.source_ref_id = ?3
          AND r.evidence_role = ?4
          AND COALESCE(r.source_span_id, '') = ?5
          AND r.exact_text = ?6
          AND r.content_hash = ?7
        LIMIT 1`,
    ).bind(
      sessionId,
      sourceRef.sourceRefType,
      sourceRef.sourceRefId,
      sourceRef.evidenceRole ?? 'support',
      sourceRef.sourceSpanId ?? '',
      sourceRef.exactText,
      sourceRef.contentHash,
    ).first<{ event_id: string }>();
    return row !== null;
  }

  private async loadLatestCommitSubmission(
    sessionId: string,
    challenge: AssessmentProgressSourceRef | null,
  ): Promise<AssessmentProgressCommit | null> {
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
    const submissionSource = await this.loadCommitSubmissionSource(row.id);
    const repositoryUrl = jsonStringValue(payload.repositoryUrl);
    const baseCommitSha = jsonStringValue(payload.baseCommitSha);
    return {
      eventId: row.id,
      repositoryUrl,
      forkRepositoryUrl: jsonStringValue(payload.forkRepositoryUrl),
      branchName: jsonStringValue(payload.branchName),
      baseCommitSha,
      commitSha: jsonStringValue(payload.commitSha),
      commitUrl: jsonStringValue(payload.commitUrl),
      submissionSource,
      submissionSourceLabel: commitSubmissionSourceLabel(submissionSource),
      integrity: commitSubmissionIntegrity(submissionSource),
      challengeBinding: commitChallengeBinding({
        commitRepositoryUrl: repositoryUrl,
        commitBaseCommitSha: baseCommitSha,
        challenge,
      }),
      changedFiles: jsonArrayValue(payload.changedFiles),
      occurredAt: row.occurred_at,
    };
  }

  private async loadCommitSubmissionSource(eventId: string): Promise<CommitSubmissionSource> {
    const result = await this.db.prepare(
      `SELECT metadata_json
         FROM assessment_event_source_refs
        WHERE event_id = ?1`,
    ).bind(eventId).all<{ metadata_json: string }>();
    const sourceValues = new Set<string>();
    for (const row of result.results ?? []) {
      const metadata = parseJsonObject(row.metadata_json);
      const source = jsonStringValue(metadata.source);
      if (source) sourceValues.add(source);
    }
    const hasWorkspaceFinalizer = sourceValues.has('agent_bridge_workspace_finalize');
    const hasManualPanel = sourceValues.has('assessment_commit_submission_panel');
    if (hasWorkspaceFinalizer && hasManualPanel) return 'mixed';
    if (hasWorkspaceFinalizer) return 'live_workspace';
    if (hasManualPanel) return 'manual_fallback';
    return 'unknown';
  }

  private async loadLatestHumanDecision(sessionId: string): Promise<AssessmentProgressHumanDecision | null> {
    const row = await this.db.prepare(
      `SELECT id
         FROM assessment_evidence_events
        WHERE session_id = ?1
          AND kind = 'human_assessment_decision'
        ORDER BY sequence DESC
        LIMIT 1`,
    ).bind(sessionId).first<{ id: string }>();
    if (!row) return null;
    return this.loadHumanDecisionEvent(row.id);
  }

  private async loadHumanDecisionEvent(eventId: string): Promise<AssessmentProgressHumanDecision | null> {
    const row = await this.db.prepare(
      `SELECT e.id,
              e.actor_id,
              e.narrative,
              e.payload_json,
              e.occurred_at,
              COUNT(sr.id) AS source_ref_count,
              GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types
         FROM assessment_evidence_events e
         LEFT JOIN assessment_event_source_refs sr ON sr.event_id = e.id
        WHERE e.id = ?1
          AND e.kind = 'human_assessment_decision'
        GROUP BY e.id, e.actor_id, e.narrative, e.payload_json, e.occurred_at
        LIMIT 1`,
    ).bind(eventId).first<{
      id: string;
      actor_id: string | null;
      narrative: string;
      payload_json: string;
      occurred_at: string;
      source_ref_count: number;
      source_ref_types: string | null;
    }>();
    if (!row) return null;
    const payload = parseJsonObject(row.payload_json);
    const decisionValue = jsonStringValue(payload.decision);
    if (!decisionValue || !HUMAN_ASSESSMENT_DECISIONS.has(decisionValue as HumanAssessmentDecisionValue)) {
      return null;
    }
    return {
      eventId: row.id,
      decision: decisionValue as HumanAssessmentDecisionValue,
      reviewerId: row.actor_id,
      summary: row.narrative,
      notes: jsonStringValue(payload.notes),
      occurredAt: row.occurred_at,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean).sort()
        : [],
    };
  }

  private async loadLatestEvaluation(sessionId: string): Promise<AssessmentProgressEvaluation | null> {
    const row = await this.db.prepare(
      `SELECT id, status, summary, output_json, created_at
         FROM assessment_evaluation_reports
        WHERE session_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    ).bind(sessionId).first<{
      id: string;
      status: EvaluationReportStatus;
      summary: string;
      output_json: string | null;
      created_at: string;
    }>();
    if (!row) return null;
    const output = parseJsonObject(row.output_json);
    const claims = await this.loadEvaluationClaimPreviews(row.id);
    const diagnostics = await this.loadEvaluationDiagnosticPreviews(row.id);
    return {
      id: row.id,
      status: row.status,
      summary: row.summary,
      recommendation: typeof output.recommendation === 'string' ? output.recommendation : null,
      createdAt: row.created_at,
      evidenceCoverage: parseEvidenceCoverage(output),
      claims,
      diagnostics,
    };
  }

  private async loadEvaluationClaimPreviews(reportId: string): Promise<AssessmentProgressEvaluationClaim[]> {
    const rows = await this.db.prepare(
      `SELECT c.id,
              c.polarity,
              c.dimension,
              c.narrative,
              c.confidence,
              COUNT(sr.id) AS source_ref_count,
              GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types
         FROM assessment_evaluation_claims c
         LEFT JOIN assessment_claim_source_refs sr ON sr.claim_id = c.id
        WHERE c.report_id = ?1
        GROUP BY c.id, c.polarity, c.dimension, c.narrative, c.confidence
       HAVING COUNT(sr.id) > 0
        ORDER BY
          CASE c.polarity
            WHEN 'positive' THEN 0
            WHEN 'negative' THEN 1
            WHEN 'neutral' THEN 2
            ELSE 3
          END,
          c.created_at,
          c.id
        LIMIT 3`,
    ).bind(reportId).all<{
      id: string;
      polarity: AssessmentEvaluationClaimPolarity;
      dimension: string;
      narrative: string;
      confidence: number | null;
      source_ref_count: number;
      source_ref_types: string | null;
    }>();
    return rows.results.map((row) => ({
      id: row.id,
      polarity: row.polarity,
      dimension: row.dimension,
      narrative: row.narrative,
      confidence: row.confidence,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean)
        : [],
    }));
  }

  private async loadEvaluationDiagnosticPreviews(reportId: string): Promise<AssessmentProgressEvaluationDiagnostic[]> {
    const rows = await this.db.prepare(
      `SELECT d.id,
              d.code,
              d.severity,
              d.message,
              COUNT(sr.id) AS source_ref_count,
              GROUP_CONCAT(DISTINCT sr.source_ref_type) AS source_ref_types
         FROM assessment_diagnostics d
         LEFT JOIN assessment_diagnostic_source_refs sr ON sr.diagnostic_id = d.id
        WHERE d.report_id = ?1
        GROUP BY d.id, d.code, d.severity, d.message
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
        LIMIT 4`,
    ).bind(reportId).all<{
      id: string;
      code: string;
      severity: string;
      message: string;
      source_ref_count: number;
      source_ref_types: string | null;
    }>();
    return rows.results.map((row) => ({
      id: row.id,
      code: row.code,
      severity: row.severity,
      message: row.message,
      sourceRefCount: row.source_ref_count,
      sourceRefTypes: row.source_ref_types
        ? row.source_ref_types.split(',').map((value) => value.trim()).filter(Boolean)
        : [],
    }));
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
