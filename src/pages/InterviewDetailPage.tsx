import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  CheckCircle,
  Clock,
  Copy,
  FileText,
  GitPullRequest,
  Loader2,
  Mail,
  Network,
  User,
  Video,
} from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import { asCodeReviewReviewProfile, ReviewProfileCard } from '../components/Assessment/CodeReviewChallenge';
import { summarizeAssessmentAssignment } from '../lib/scheduling/assessmentChallenge';
import type {
  AssessmentEvidenceCoverageItem,
  AssessmentProgressSnapshot,
  CodeReviewEvidencePlanItem,
  CodeReviewMatchAlignment,
  CodeReviewMatchDetail,
  CodeReviewMatchHyperedge,
  CodeReviewMatchHyperedgeNode,
  CodeReviewScoreSummary,
  CodeReviewMatchSourceRef,
  AssessmentSetupProjection,
  ScheduledInterviewDetail,
  TranscriptArtifact,
  TranscriptEntry,
} from '../lib/scheduling/types';
import {
  RECRUITER_FONT as FONT,
  recruiterBackButtonStyle,
  recruiterEmptyTextStyle,
  recruiterEyebrowStyle,
  recruiterFieldLabelStyle,
  recruiterFieldValueStyle,
  recruiterHeaderStyle,
  recruiterInlineLinkStyle,
  recruiterPageStyle,
  recruiterPrimaryButtonStyle,
  recruiterSectionStyle,
  recruiterSectionTitleStyle,
  recruiterSubtitleStyle,
  recruiterTagStyle,
  recruiterTextButtonStyle,
  recruiterTitleStyle,
} from '../styles/recruiterSurface';

const STATUS_COLORS: Record<string, string> = {
  READY: '#9ca3af',
  INVITED: '#fbbf24',
  SCHEDULED: '#60a5fa',
  ACTIVE: '#34d399',
  COMPLETED: '#4ade80',
  CANCELLED: '#f87171',
  NO_SHOW: '#9ca3af',
};

const LIVE_RECORDING_STALE_AFTER_MS = 4 * 60 * 60 * 1000;
const CLIPBOARD_WRITE_TIMEOUT_MS = 800;

interface PreparedRoomLinks {
  id: string;
  sessionId: string | null;
  hostUrl: string;
  guestUrl: string;
  expiresAt: string;
}

interface InviteResponse {
  success: boolean;
  emailSent: boolean;
  meetingUrl: string;
  deliveredUrl?: string;
  schedulingUrl?: string | null;
  provider?: string;
  emailError?: string;
  room?: PreparedRoomLinks;
}

interface ContextCallResponse {
  contextCall: {
    id: string;
    originalInterviewId: string;
    evidenceAssessmentSessionId?: string | null;
    questions: string[];
    reused?: boolean;
  };
}

interface CodeReviewMatchRefreshResponse {
  refreshed: boolean;
  status: string;
  matchRunId: string;
  repoId?: number;
  repoUrl?: string;
  prNumber?: number;
  codeReviewMatch: CodeReviewMatchDetail | null;
}

interface StartAssessmentEvaluationResponse {
  progress: AssessmentProgressSnapshot;
  report?: {
    id: string;
    sessionId: string;
    status: string;
    contextRecordId: string | null;
  } | null;
  diagnostic?: {
    id: string;
    sessionId: string;
    reportId: string | null;
    code: string;
    severity: string;
  } | null;
}

type HumanAssessmentDecisionValue = NonNullable<NonNullable<AssessmentProgressSnapshot['humanDecision']>>['decision'];

interface RecordHumanAssessmentDecisionResponse {
  decision: NonNullable<NonNullable<AssessmentProgressSnapshot['humanDecision']>>;
  progress: AssessmentProgressSnapshot;
}

interface CodeReviewAnnotationDetail {
  file: string;
  line: number | null;
  severity: string | null;
  comment: string;
}

interface CodeReviewDefenseExchange {
  actor: 'candidate' | 'ai_developer';
  round: number | null;
  move: string | null;
  content: string;
  updatedCode: string | null;
}

interface CodeReviewDefenseThread {
  commentId: string;
  file: string;
  line: number | null;
  severity: string | null;
  comment: string;
  exchanges: CodeReviewDefenseExchange[];
}

interface CodeReviewSubmissionDetail {
  verdict: string | null;
  summary: string | null;
  annotations: CodeReviewAnnotationDetail[];
  defenseThreads: CodeReviewDefenseThread[];
}

type CodeReviewNextStepTone = 'positive' | 'watch' | 'blocked' | 'neutral';

interface CodeReviewNextStep {
  value: string;
  detail: string;
  tone: CodeReviewNextStepTone;
}

interface CodeReviewDecisionRisk {
  uncertainty: {
    value: string;
    detail: string;
  };
  missingContext: string[];
}

interface CodeReviewAssessmentValidity {
  value: string;
  detail: string;
  tone: CodeReviewNextStepTone;
}

interface CodeReviewSignalBasisItem {
  label: string;
  value: string;
  satisfied: boolean;
}

interface WorkspaceAssessmentReadoutItem {
  label: string;
  value: string;
  detail: string;
  tone: CodeReviewNextStepTone;
}

interface AssessmentChangedFileSummary {
  path: string;
  status: string | null;
}

interface CodeReviewAssignmentTrust {
  value: string;
  detail: string;
  tone: CodeReviewNextStepTone;
}

interface CodeReviewMatchExplanation {
  selectedChallenge: string;
  whyThisChallenge: string;
  proofSummary: string;
  riskSummary: string;
  remainingQuestion: string;
  tone: CodeReviewNextStepTone;
}

interface EvidenceFollowUpPlan {
  originalInterviewId: string | null;
  matchStatus: string | null;
  matchSummary: string | null;
  gaps: string[];
  questions: string[];
}

type RelatedEvidenceInterview = NonNullable<ScheduledInterviewDetail['relatedEvidenceInterviews']>[number];

interface RelatedEvidenceDecisionSummary {
  headline: string;
  detail: string;
  nextAction: string;
  metrics: Array<{ label: string; value: number }>;
}

type CopyTextResult = 'copied' | 'selected' | 'failed';

function formatDate(value: string | null | undefined, fallback = 'Not scheduled'): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDurationMs(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sentenceCaseToken(value: string): string {
  const words = value
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean);
  return words
    .map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

function assessmentEvaluationStatusLabel(status: string): string {
  switch (status) {
    case 'AI_DEVELOPER_UNAVAILABLE':
      return 'Evaluator unavailable';
    case 'PROVENANCE_INCOMPLETE':
      return 'Provenance incomplete';
    case 'EVALUATION_NEEDS_HUMAN_REVIEW':
    case 'NEEDS_HUMAN_REVIEW':
      return 'Needs human review';
    case 'EVALUATED':
      return 'Evaluated';
    default:
      return sentenceCaseToken(status);
  }
}

function assessmentAssignmentToneStyle(
  tone: NonNullable<ReturnType<typeof summarizeAssessmentAssignment>>['tone'],
): CSSProperties {
  switch (tone) {
    case 'matched':
      return { color: '#4ade80' };
    case 'manual':
      return { color: '#fbbf24' };
    case 'blocked':
      return { color: '#f87171' };
    case 'waiting':
      return { color: '#93c5fd' };
    default:
      return { color: 'var(--pipe-text)' };
  }
}

function assessmentEvaluationRecommendationLabel(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  return sentenceCaseToken(recommendation);
}

function assessmentHumanDecisionLabel(decision: string): string {
  switch (decision) {
    case 'advance':
      return 'Human: advance';
    case 'hold':
      return 'Human: hold';
    case 'reject':
      return 'Human: reject';
    case 'needs_more_evidence':
      return 'Human: needs more evidence';
    default:
      return `Human: ${sentenceCaseToken(decision)}`;
  }
}

const HUMAN_ASSESSMENT_DECISION_OPTIONS = [
  { value: 'advance', label: 'Advance' },
  { value: 'hold', label: 'Hold' },
  { value: 'reject', label: 'Reject' },
  { value: 'needs_more_evidence', label: 'Needs more evidence' },
] as const satisfies ReadonlyArray<{ value: HumanAssessmentDecisionValue; label: string }>;

function assessmentClaimPolarityLabel(polarity: string): string {
  switch (polarity) {
    case 'positive':
      return 'Strength';
    case 'negative':
      return 'Risk';
    case 'diagnostic':
      return 'Diagnostic';
    default:
      return sentenceCaseToken(polarity);
  }
}

function assessmentClaimConfidenceLabel(confidence: number | null | undefined): string | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

function assessmentClaimSourceSummary(claim: { sourceRefCount: number; sourceRefTypes: string[] }): string {
  const count = `${claim.sourceRefCount} source ${claim.sourceRefCount === 1 ? 'ref' : 'refs'}`;
  const types = claim.sourceRefTypes.map(sentenceCaseToken).join(', ');
  return types ? `${count}: ${types}` : count;
}

function assessmentEvaluationNoticeForResult(result: StartAssessmentEvaluationResponse): string {
  if (result.report || result.progress.evaluation?.status === 'EVALUATED') {
    return 'Source-backed assessment report is ready to review.';
  }
  if (result.diagnostic) {
    return `Evaluation needs attention: ${result.progress.evaluation?.summary ?? result.diagnostic.code}.`;
  }
  return 'Source-backed assessment evaluation started.';
}

function formatMatchScore(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function shortCommitSha(value: string | null | undefined): string {
  if (!value) return 'No commit';
  return value.length > 10 ? value.slice(0, 10) : value;
}

function repoLabelFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  } catch {
    // Fall through to compact raw text for non-URL repository labels.
  }
  return compactEvidenceText(value, 56);
}

function firstLocatorString(locator: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function workspaceSessionSummary(interview: ScheduledInterviewDetail): string | null {
  const workspace = interview.workspaceSession ?? null;
  if (!workspace) return null;
  const status = sentenceCaseToken(workspace.status);
  if (workspace.errorMessage) return `${status}: ${compactEvidenceText(workspace.errorMessage, 140) ?? workspace.errorMessage}`;
  const repo = repoLabelFromUrl(workspace.repoGitUrl);
  const base = workspace.baseCommitSha ? `base ${shortCommitSha(workspace.baseCommitSha)}` : null;
  const details = [repo, base].filter((value): value is string => Boolean(value));
  return details.length > 0 ? `${status} · ${details.join(' · ')}` : status;
}

function compactEvidenceText(value: string, maxLength = 160): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

interface AssessmentChallengeContract {
  repositoryUrl: string | null;
  baseCommitSha: string | null;
  task: string | null;
  successCriteria: string[];
  expectedEvidence: string[];
}

function normalizePacketListItem(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function parseAssessmentChallengeContract(challenge: {
  exactText: string;
  locator: Record<string, unknown>;
} | null | undefined): AssessmentChallengeContract | null {
  if (!challenge) return null;
  const lines = challenge.exactText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let section: 'successCriteria' | 'expectedEvidence' | null = null;
  const contract: AssessmentChallengeContract = {
    repositoryUrl: firstLocatorString(challenge.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']),
    baseCommitSha: firstLocatorString(challenge.locator, ['baseCommitSha', 'baseCommit']),
    task: null,
    successCriteria: [],
    expectedEvidence: [],
  };

  for (const line of lines) {
    const repoMatch = line.match(/^repo(?:sitory)?\s*:\s*(.+)$/i);
    if (repoMatch?.[1] && !contract.repositoryUrl) {
      contract.repositoryUrl = repoMatch[1].trim();
      section = null;
      continue;
    }
    const baseCommitMatch = line.match(/^base commit\s*:\s*([a-f0-9]{7,40})$/i);
    if (baseCommitMatch?.[1] && !contract.baseCommitSha) {
      contract.baseCommitSha = baseCommitMatch[1].trim();
      section = null;
      continue;
    }
    const taskMatch = line.match(/^task\s*:\s*(.+)$/i);
    if (taskMatch?.[1]) {
      contract.task = taskMatch[1].trim();
      section = null;
      continue;
    }
    const successLineMatch = line.match(/^success\s*:\s*(.+)$/i);
    if (successLineMatch?.[1]) {
      contract.successCriteria.push(successLineMatch[1].trim());
      section = null;
      continue;
    }
    if (/^success criteria\s*:?\s*$/i.test(line)) {
      section = 'successCriteria';
      continue;
    }
    if (/^expected evidence\s*:?\s*$/i.test(line)) {
      section = 'expectedEvidence';
      continue;
    }
    if (/^[A-Za-z][A-Za-z\s-]{2,}:\s*$/.test(line)) {
      section = null;
      continue;
    }
    if (!section) continue;
    const item = normalizePacketListItem(line);
    if (item.length > 0) contract[section].push(item);
  }

  return contract.repositoryUrl
    || contract.baseCommitSha
    || contract.task
    || contract.successCriteria.length > 0
    || contract.expectedEvidence.length > 0
    ? contract
    : null;
}

function assessmentChallengeSummary(challenge: {
  exactText: string;
  sourceRefType: string;
} | null | undefined): string | null {
  if (!challenge) return null;
  const lines = challenge.exactText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const taskLine = lines.find((line) => /^task:/i.test(line));
  const successLine = lines.find((line) => /^success:/i.test(line));
  const contextLine = lines.find((line) => !/^base commit:/i.test(line));
  const bestLine = taskLine ?? successLine ?? contextLine ?? null;
  const readable = bestLine?.replace(/^(task|success):\s*/i, '') ?? null;
  return readable ? compactEvidenceText(readable) : sentenceCaseToken(challenge.sourceRefType);
}

function assessmentProgressStageLabel(stage: string): string {
  return sentenceCaseToken(stage);
}

function assessmentEvidenceSummary(input: {
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasMessageEvidence?: boolean;
  hasDevContainerEvidence?: boolean;
  hasToolUsageEvidence?: boolean;
  hasCommitSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  hasTestEvidence: boolean;
  hasVerificationGap?: boolean;
}): string {
  const hasGranularWorkEvidence = Boolean(
    input.hasMessageEvidence
    || input.hasDevContainerEvidence
    || input.hasToolUsageEvidence
    || input.hasAiInteraction
    || input.hasTranscriptEvidence
    || input.hasTestEvidence,
  );
  const ready = [
    input.hasChallengePacket ? 'challenge' : null,
    input.hasMessageEvidence ? 'chat' : null,
    input.hasDevContainerEvidence ? 'workspace telemetry' : null,
    input.hasToolUsageEvidence ? 'room actions' : null,
    input.hasWorkEvidence && !hasGranularWorkEvidence ? 'work evidence' : null,
    input.hasCommitSubmission ? 'commit' : null,
    input.hasAiInteraction ? 'AI use' : null,
    input.hasTranscriptEvidence ? 'transcript' : null,
    input.hasTestEvidence ? 'tests' : null,
    input.hasVerificationGap ? 'verification gap' : null,
  ].filter((value): value is string => Boolean(value));
  return ready.length > 0 ? ready.join(', ') : 'No evidence yet';
}

function assessmentChangedFiles(progress: AssessmentProgressSnapshot | null): AssessmentChangedFileSummary[] {
  const rawFiles = progress?.commit?.changedFiles ?? [];
  return rawFiles.flatMap((file): AssessmentChangedFileSummary[] => {
    if (typeof file === 'string' && file.trim().length > 0) {
      return [{ path: file.trim(), status: null }];
    }
    if (!file || typeof file !== 'object') return [];

    const record = file as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    if (!path) return [];
    const status = typeof record.status === 'string' && record.status.trim().length > 0
      ? record.status.trim()
      : null;
    return [{ path, status }];
  });
}

function assessmentCoverageLabel(label: string): string {
  switch (label) {
    case 'test_run':
      return 'Tests';
    case 'terminal_activity':
      return 'Terminal';
    case 'code_editor_activity':
      return 'Editor';
    case 'ai_assistance':
      return 'AI use';
    case 'challenge_packet':
      return 'Challenge';
    case 'git_commit':
      return 'Commit';
    case 'code_diff':
      return 'Diff';
    default:
      return sentenceCaseToken(label);
  }
}

function assessmentEvidenceSnippetLabel(sourceRefType: string): string {
  switch (sourceRefType) {
    case 'review_challenge_packet':
    case 'open_source_challenge_packet':
    case 'repo_task_challenge_packet':
    case 'challenge_packet':
      return 'Challenge evidence';
    case 'git_commit':
      return 'Commit evidence';
    case 'code_diff':
      return 'Diff evidence';
    case 'test_run':
      return 'Test evidence';
    case 'terminal_command':
    case 'terminal_output':
      return 'Terminal evidence';
    case 'ai_usage_event':
      return 'AI evaluator trace';
    case 'room_chat_message':
      return 'Chat evidence';
    case 'meeting_transcript_segment':
      return 'Transcript evidence';
    default:
      return sentenceCaseToken(sourceRefType);
  }
}

function assessmentRequiredProofItems(progress: AssessmentProgressSnapshot | null): AssessmentEvidenceCoverageItem[] {
  const coverage = progress?.evaluation?.evidenceCoverage ?? null;
  if (!coverage) return [];
  return coverage.requiredForEvaluation.filter((item) => [
    'challenge_packet',
    'git_commit',
    'code_diff',
  ].includes(item.label));
}

function assessmentConfidenceSignalItems(progress: AssessmentProgressSnapshot | null): AssessmentEvidenceCoverageItem[] {
  const coverage = progress?.evaluation?.evidenceCoverage ?? null;
  if (!coverage) return [];
  return coverage.expectedForHighConfidence.filter((item) => [
    'test_run',
    'terminal_activity',
    'code_editor_activity',
    'ai_assistance',
  ].includes(item.label));
}

function assessmentSourceRefCount(progress: AssessmentProgressSnapshot | null, kind: string): number {
  return progress?.sourceRefCounts.find((item) => item.kind === kind)?.count ?? 0;
}

function assessmentHasSatisfiedCoverage(
  progress: AssessmentProgressSnapshot | null,
  label: string,
  fallback: boolean,
): boolean {
  const coverageItem = progress?.evaluation?.evidenceCoverage?.requiredForEvaluation
    .find((item) => item.label === label);
  return coverageItem ? coverageItem.satisfied : fallback;
}

function workspaceAssessmentNextActionTitle(progress: AssessmentProgressSnapshot | null): string {
  switch (progress?.nextAction) {
    case 'ASSIGN_CHALLENGE':
      return 'Assign challenge';
    case 'OPEN_ROOM_OR_WORKSPACE':
      return 'Open workspace';
    case 'CAPTURE_WORK_EVIDENCE':
      return 'Capture work evidence';
    case 'SUBMIT_COMMIT':
      return 'Submit commit';
    case 'START_EVALUATION':
      return 'Start evaluation';
    case 'REVIEW_EVALUATION':
      return 'Review evaluation';
    case 'RESOLVE_DIAGNOSTIC':
      return 'Resolve diagnostic';
    case 'NONE':
      return 'No action';
    default:
      return 'Create assessment evidence';
  }
}

function workspaceAssessmentDecisionItem(progress: AssessmentProgressSnapshot | null): WorkspaceAssessmentReadoutItem {
  if (!progress) {
    return {
      label: 'Decision',
      value: 'Not started',
      detail: 'No source-backed assessment session is attached yet.',
      tone: 'blocked',
    };
  }

  if (progress.humanDecision) {
    return {
      label: 'Decision',
      value: assessmentHumanDecisionLabel(progress.humanDecision.decision),
      detail: progress.humanDecision.summary,
      tone: progress.humanDecision.decision === 'advance' ? 'positive' : 'watch',
    };
  }

  const evaluation = progress.evaluation;
  if (evaluation?.status === 'EVALUATED') {
    return {
      label: 'Decision',
      value: assessmentEvaluationRecommendationLabel(evaluation.recommendation) ?? 'Assessment report ready',
      detail: evaluation.summary,
      tone: 'positive',
    };
  }

  if (evaluation && evaluation.status !== 'EVALUATED') {
    return {
      label: 'Decision',
      value: assessmentEvaluationStatusLabel(evaluation.status),
      detail: evaluation.summary,
      tone: evaluation.status === 'NEEDS_HUMAN_REVIEW' ? 'watch' : 'blocked',
    };
  }

  if (progress.nextAction === 'START_EVALUATION') {
    return {
      label: 'Decision',
      value: 'Ready for evaluation',
      detail: 'Challenge and commit evidence are captured; run source-backed AI or human evaluation before making a hiring decision.',
      tone: 'neutral',
    };
  }

  if (progress.hasCommitSubmission) {
    return {
      label: 'Decision',
      value: 'Commit submitted',
      detail: 'Candidate work exists, but the assessment report has not been produced yet.',
      tone: 'neutral',
    };
  }

  if (progress.hasChallengePacket) {
    return {
      label: 'Decision',
      value: 'Challenge assigned',
      detail: 'A source-backed task is ready. Wait for candidate work before using this assessment as signal.',
      tone: 'neutral',
    };
  }

  return {
    label: 'Decision',
    value: 'Waiting for challenge',
    detail: 'No concrete source-backed repo task is assigned yet.',
    tone: 'blocked',
  };
}

function workspaceAssessmentFitItem(input: {
  progress: AssessmentProgressSnapshot | null;
  setup: AssessmentSetupProjection | null | undefined;
  challengeText: string | null;
}): WorkspaceAssessmentReadoutItem {
  if (input.setup?.blocksPositiveAssessment) {
    return {
      label: 'Challenge fit',
      value: 'Do not rely yet',
      detail: input.setup.message ?? 'The current assignment is not safe for positive assessment.',
      tone: 'blocked',
    };
  }

  if (input.setup?.source === 'matched_repo_id' || input.setup?.kind === 'auto_match') {
    return {
      label: 'Challenge fit',
      value: 'Matched task',
      detail: input.setup.message ?? 'PIPE selected this repo task from source-backed candidate and repository evidence.',
      tone: 'positive',
    };
  }

  if (input.setup?.kind === 'manual_open_source_task' || input.setup?.source === 'recruiter_manual_override') {
    return {
      label: 'Challenge fit',
      value: 'Manual task',
      detail: 'A recruiter supplied the task packet. Treat candidate work as real evidence, but do not read the assignment itself as automatic match proof.',
      tone: 'watch',
    };
  }

  if (input.progress?.hasChallengePacket) {
    return {
      label: 'Challenge fit',
      value: 'Source-backed task',
      detail: input.challengeText ?? 'The assigned task packet is captured as immutable source evidence.',
      tone: 'positive',
    };
  }

  return {
    label: 'Challenge fit',
    value: 'No task packet',
    detail: input.setup?.message ?? 'Assign a concrete repo URL, base commit, task, success criteria, and expected evidence.',
    tone: 'blocked',
  };
}

function workspaceAssessmentProofItem(progress: AssessmentProgressSnapshot | null): WorkspaceAssessmentReadoutItem {
  const challengeCaptured = assessmentHasSatisfiedCoverage(
    progress,
    'challenge_packet',
    Boolean(progress?.hasChallengePacket || assessmentSourceRefCount(progress, 'review_challenge_packet') > 0),
  );
  const commitCaptured = assessmentHasSatisfiedCoverage(
    progress,
    'git_commit',
    Boolean(progress?.hasCommitSubmission || assessmentSourceRefCount(progress, 'git_commit') > 0),
  );
  const diffCaptured = assessmentHasSatisfiedCoverage(
    progress,
    'code_diff',
    assessmentSourceRefCount(progress, 'code_diff') > 0,
  );
  const missing = [
    challengeCaptured ? null : 'challenge',
    commitCaptured ? null : 'commit',
    diffCaptured ? null : 'diff',
  ].filter((item): item is string => Boolean(item));

  if (missing.length === 0) {
    return {
      label: 'Required proof',
      value: 'Required proof captured',
      detail: 'Challenge, commit, and diff are source-backed. Tests and process evidence still affect confidence.',
      tone: 'positive',
    };
  }

  return {
    label: 'Required proof',
    value: `${titleCaseToken(missing.join(', '))} missing`,
    detail: 'PIPE cannot produce a trustworthy positive assessment until the required source refs exist.',
    tone: progress?.hasChallengePacket ? 'watch' : 'blocked',
  };
}

function workspaceAssessmentRiskItem(progress: AssessmentProgressSnapshot | null): WorkspaceAssessmentReadoutItem {
  const negativeClaim = progress?.evaluation?.claims?.find((claim) => claim.polarity === 'negative') ?? null;
  const testCoverageItem = progress?.evaluation?.evidenceCoverage?.expectedForHighConfidence
    .find((item) => item.label === 'test_run');
  const hasTestEvidence = testCoverageItem ? testCoverageItem.satisfied : Boolean(progress?.hasTestEvidence);
  if (negativeClaim) {
    return {
      label: 'Risk',
      value: 'Evaluator risk raised',
      detail: negativeClaim.narrative,
      tone: 'watch',
    };
  }

  if (progress?.evaluation && progress.evaluation.status !== 'EVALUATED') {
    return {
      label: 'Risk',
      value: assessmentEvaluationStatusLabel(progress.evaluation.status),
      detail: progress.evaluation.summary,
      tone: 'blocked',
    };
  }

  if (progress?.hasVerificationGap || (progress && !hasTestEvidence)) {
    return {
      label: 'Risk',
      value: 'Verification gap',
      detail: 'Test evidence is missing. Treat implementation quality as lower-confidence until tests or a source-backed missing-test explanation are reviewed.',
      tone: 'watch',
    };
  }

  if (!progress?.hasCommitSubmission) {
    return {
      label: 'Risk',
      value: 'No candidate commit',
      detail: 'The task is not assessable until the candidate submits a real commit or final evidence bundle.',
      tone: progress?.hasChallengePacket ? 'neutral' : 'blocked',
    };
  }

  return {
    label: 'Risk',
    value: 'No blocking evidence gap',
    detail: 'Required source evidence is present. Use evaluator claims and human review before making a final decision.',
    tone: 'positive',
  };
}

function workspaceAssessmentNextActionItem(progress: AssessmentProgressSnapshot | null): WorkspaceAssessmentReadoutItem {
  return {
    label: 'Next action',
    value: workspaceAssessmentNextActionTitle(progress),
    detail: progress?.nextActionLabel ?? 'Create or configure the source-backed assessment before relying on this interview.',
    tone: progress?.nextAction === 'RESOLVE_DIAGNOSTIC' ? 'blocked' : 'neutral',
  };
}

function workspaceAssessmentWorkPacket(progress: AssessmentProgressSnapshot | null): WorkspaceAssessmentReadoutItem[] {
  if (!progress?.commit) return [];

  const changedFiles = assessmentChangedFiles(progress);
  const filePreview = changedFiles
    .slice(0, 4)
    .map((file) => file.status ? `${file.path} · ${sentenceCaseToken(file.status)}` : file.path)
    .join(', ');
  const hiddenFileCount = Math.max(0, changedFiles.length - 4);
  const changedFileDetail = changedFiles.length > 0
    ? `${changedFiles.length} changed ${changedFiles.length === 1 ? 'file' : 'files'}${filePreview ? `: ${filePreview}` : ''}${hiddenFileCount > 0 ? `, +${hiddenFileCount} more` : ''}`
    : 'Changed file list was not captured in the commit payload.';

  const commitDetail = [
    progress.commit.branchName ? `Branch ${progress.commit.branchName}` : null,
    changedFileDetail,
  ].filter((item): item is string => Boolean(item)).join(' · ');

  const reviewItem: WorkspaceAssessmentReadoutItem = progress.humanDecision
    ? {
        label: 'Human review',
        value: assessmentHumanDecisionLabel(progress.humanDecision.decision),
        detail: `${progress.humanDecision.summary} ${progress.humanDecision.sourceRefCount} source ${progress.humanDecision.sourceRefCount === 1 ? 'ref' : 'refs'}.`.trim(),
        tone: progress.humanDecision.decision === 'advance' ? 'positive' : 'watch',
      }
    : progress.evaluation?.status === 'EVALUATED'
    ? {
        label: 'Human review',
        value: assessmentEvaluationRecommendationLabel(progress.evaluation.recommendation) ?? 'Report ready',
        detail: 'Review the evaluator claims, exact diff, tests, and cautions before making a hiring decision.',
        tone: 'positive',
      }
    : progress.evaluation
      ? {
          label: 'Human review',
          value: assessmentEvaluationStatusLabel(progress.evaluation.status),
          detail: progress.evaluation.summary,
          tone: 'blocked',
        }
      : progress.nextAction === 'START_EVALUATION'
        ? {
            label: 'Human review',
            value: 'Run evaluation',
            detail: 'Commit evidence is in. Start source-backed AI or human evaluation before using the work as hiring signal.',
            tone: 'neutral',
          }
        : {
            label: 'Human review',
            value: workspaceAssessmentNextActionTitle(progress),
            detail: progress.nextActionLabel,
            tone: progress.nextAction === 'RESOLVE_DIAGNOSTIC' ? 'blocked' : 'neutral',
          };

  return [
    {
      label: 'Commit artifact',
      value: shortCommitSha(progress.commit.commitSha),
      detail: commitDetail,
      tone: changedFiles.length > 0 ? 'positive' : 'watch',
    },
    {
      label: 'Verification',
      value: progress.hasTestEvidence
        ? 'Tests captured'
        : progress.hasVerificationGap
          ? 'Verification gap declared'
          : 'Tests not captured',
      detail: progress.hasTestEvidence
        ? 'Test output is present as source-backed evidence for the submitted work.'
        : 'Treat implementation quality as lower-confidence until test output or a source-backed explanation is reviewed.',
      tone: progress.hasTestEvidence ? 'positive' : 'watch',
    },
    {
      label: 'AI transparency',
      value: progress.hasAiInteraction ? 'AI use observed' : 'No AI evidence captured',
      detail: progress.hasAiInteraction
        ? 'AI prompts or agent traces are part of the source-backed evidence trail.'
        : 'No candidate AI-assistance evidence is attached to this assessment yet.',
      tone: progress.hasAiInteraction ? 'neutral' : 'watch',
    },
    reviewItem,
  ];
}

function workspaceAssessmentHiringReadout(input: {
  progress: AssessmentProgressSnapshot | null;
  setup: AssessmentSetupProjection | null | undefined;
  challengeText: string | null;
}): WorkspaceAssessmentReadoutItem[] {
  return [
    workspaceAssessmentDecisionItem(input.progress),
    workspaceAssessmentFitItem(input),
    workspaceAssessmentProofItem(input.progress),
    workspaceAssessmentRiskItem(input.progress),
    workspaceAssessmentNextActionItem(input.progress),
  ];
}

function sourceRefText(ref: CodeReviewMatchSourceRef | null | undefined): string | null {
  if (!ref) return null;
  return compactEvidenceText(ref.exactText ?? '')
    ?? compactEvidenceText(ref.locator ?? '')
    ?? null;
}

function firstSourceRefText(refs: CodeReviewMatchSourceRef[]): string | null {
  for (const ref of refs) {
    const text = sourceRefText(ref);
    if (text) return text;
  }
  return null;
}

function alignmentLabel(alignment: CodeReviewMatchAlignment): string {
  if (alignment.sharedConcepts.length > 0) {
    return alignment.sharedConcepts.slice(0, 3).join(', ');
  }
  return 'Source-backed match alignment';
}

function hyperedgeNodeTitle(node: CodeReviewMatchHyperedgeNode): string {
  return node.label || titleCaseToken(node.kind);
}

function sourceEvidenceFallback(kind: string): string {
  switch (kind) {
    case 'person_evidence':
      return 'Candidate source evidence';
    case 'role_source':
      return 'Role requirement evidence';
    case 'repo_challenge':
      return 'Repo challenge evidence';
    default:
      return `${titleCaseToken(kind)} evidence`;
  }
}

function hyperedgeHasRoleSource(edge: CodeReviewMatchHyperedge): boolean {
  return edge.relation === 'candidate_role_repo_alignment'
    || edge.nodes.some((node) => node.kind === 'role_source');
}

function hyperedgePathLabel(edges: CodeReviewMatchHyperedge[]): string {
  return edges.some(hyperedgeHasRoleSource)
    ? 'person evidence -> role context -> repo challenge'
    : 'candidate evidence -> repo challenge';
}

function hyperedgeRelationBadge(edge: CodeReviewMatchHyperedge): string {
  return hyperedgeHasRoleSource(edge) ? 'PERSON_ROLE_REPO' : 'CANDIDATE_REPO';
}

function providerEventLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function reviewCommentContent(record: Record<string, unknown>): string | null {
  return optionalText(record.what)
    ?? optionalText(record.comment)
    ?? optionalText(record.content)
    ?? null;
}

function parseCodeReviewDefenseThreads(record: Record<string, unknown>): CodeReviewDefenseThread[] {
  const transcript = isRecord(record.transcript) ? record.transcript : null;
  const rounds = transcript && Array.isArray(transcript.rounds) ? transcript.rounds : [];
  const threads = new Map<string, CodeReviewDefenseThread>();

  rounds.forEach((roundValue, roundIndex) => {
    if (!isRecord(roundValue)) return;
    const roundNumber = optionalNumber(roundValue.round) ?? roundIndex + 1;
    const reviewerComments = Array.isArray(roundValue.reviewer_comments) ? roundValue.reviewer_comments : [];

    reviewerComments.forEach((commentValue, commentIndex) => {
      if (!isRecord(commentValue)) return;
      const content = reviewCommentContent(commentValue);
      if (!content) return;
      const rawId = typeof commentValue.id === 'number' || typeof commentValue.id === 'string'
        ? commentValue.id
        : `${roundNumber}:${commentIndex}`;
      const commentId = String(rawId);
      const existing = threads.get(commentId);

      if (!existing) {
        threads.set(commentId, {
          commentId,
          file: optionalText(commentValue.file) ?? 'Unknown file',
          line: optionalNumber(commentValue.line),
          severity: optionalText(commentValue.severity),
          comment: content,
          exchanges: [],
        });
        return;
      }

      existing.exchanges.push({
        actor: 'candidate',
        round: roundNumber,
        move: null,
        content,
        updatedCode: null,
      });
    });

    const implementerResponses = Array.isArray(roundValue.implementer_responses)
      ? roundValue.implementer_responses
      : [];
    implementerResponses.forEach((responseValue) => {
      if (!isRecord(responseValue)) return;
      const content = optionalText(responseValue.content);
      if (!content) return;
      const rawTarget = typeof responseValue.to_comment_id === 'number' || typeof responseValue.to_comment_id === 'string'
        ? responseValue.to_comment_id
        : null;
      if (rawTarget === null) return;
      const commentId = String(rawTarget);
      const thread = threads.get(commentId);
      if (!thread) return;
      thread.exchanges.push({
        actor: 'ai_developer',
        round: roundNumber,
        move: optionalText(responseValue.move),
        content,
        updatedCode: optionalText(responseValue.updated_code),
      });
    });
  });

  return [...threads.values()].filter((thread) => thread.exchanges.length > 0);
}

function parseCodeReviewSubmission(raw: string | null | undefined): CodeReviewSubmissionDetail | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const record = parsed;
    const type = typeof record.type === 'string' ? record.type : null;
    const verdict = typeof record.verdict === 'string' && record.verdict.trim().length > 0
      ? record.verdict.trim()
      : null;
    const summary = typeof record.summary === 'string' && record.summary.trim().length > 0
      ? record.summary.trim()
      : null;
    const annotations = Array.isArray(record.annotations)
      ? record.annotations.flatMap((entry): CodeReviewAnnotationDetail[] => {
          if (!entry || typeof entry !== 'object') return [];
          const annotation = entry as Record<string, unknown>;
          const comment = typeof annotation.comment === 'string' ? annotation.comment.trim() : '';
          if (!comment) return [];
          return [{
            file: typeof annotation.file === 'string' && annotation.file.trim().length > 0
              ? annotation.file.trim()
              : 'Unknown file',
            line: typeof annotation.line === 'number' && Number.isFinite(annotation.line)
              ? annotation.line
              : null,
            severity: typeof annotation.severity === 'string' && annotation.severity.trim().length > 0
              ? annotation.severity.trim()
              : null,
            comment,
          }];
        })
      : [];
    const defenseThreads = parseCodeReviewDefenseThreads(record);
    if (type !== 'CODE_REVIEW' && !verdict && !summary && annotations.length === 0 && defenseThreads.length === 0) return null;
    return { verdict, summary, annotations, defenseThreads };
  } catch {
    return null;
  }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function codeReviewVerdictLabel(
  verdict: string | null | undefined,
  match: CodeReviewMatchDetail | null,
): string {
  switch ((verdict ?? '').toLowerCase()) {
    case 'request_changes':
    case 'changes_requested':
      return 'Candidate requested changes';
    case 'approve':
    case 'approved':
      return 'Candidate approved the PR';
    case 'comment':
    case 'commented':
      return 'Candidate left review comments';
    default:
      if (!verdict && match && match.status !== 'MATCHED') {
        return 'No confident repo match yet';
      }
      return verdict ? `Candidate submitted ${titleCaseToken(verdict)}` : 'Waiting for candidate review';
  }
}

function codeReviewActionText(
  submission: CodeReviewSubmissionDetail | null,
  match: CodeReviewMatchDetail | null,
): string {
  const verdict = submission?.verdict?.toLowerCase() ?? null;
  if (verdict === 'request_changes' || verdict === 'changes_requested') {
    return 'Use the annotated lines and developer pushback to judge whether the requested changes are concrete, source-backed, and worth blocking the PR.';
  }
  if (verdict === 'approve' || verdict === 'approved') {
    return 'Check whether the candidate found enough risk before treating the approval as a positive signal.';
  }
  if (submission) {
    return 'Read the candidate comments and developer replies before deciding whether this review shows the judgment you need.';
  }
  if (match?.status === 'MATCHED') {
    return 'The PR assignment is ready. Wait for the candidate review before making a hiring decision.';
  }
  if (match && match.status !== 'MATCHED') {
    return 'Resolve the missing source-backed evidence before relying on this code-review assignment.';
  }
  return 'Resolve the assignment issue before relying on this assessment.';
}

function codeReviewFitLabel(match: CodeReviewMatchDetail | null): string {
  if (match?.assessmentQuality) {
    return `${titleCaseToken(match.assessmentQuality.verdict.toLowerCase())} assessment fit`;
  }
  if (match?.status && match.status !== 'MATCHED') return titleCaseToken(match.status);
  if (match?.status) return `${titleCaseToken(match.status)} assignment`;
  return 'No assignment yet';
}

function codeReviewFitDetail(match: CodeReviewMatchDetail | null): string {
  if (match?.assessmentQuality) {
    return `${match.assessmentQuality.score}/${match.assessmentQuality.maxScore}`;
  }
  if (match?.status && match.status !== 'MATCHED') {
    return 'resolve missing evidence';
  }
  const score = formatMatchScore(match?.score);
  return score ? `confidence ${score}` : 'waiting for source-backed match';
}

function codeReviewScoreHeadline(score: CodeReviewScoreSummary | null): string | null {
  if (!score) return null;
  if (typeof score.score === 'number' && Number.isFinite(score.score)) {
    const band = score.band ? ` ${titleCaseToken(score.band)}` : '';
    return `${Math.round(score.score)}/100${band}`;
  }
  return `Scoring ${titleCaseToken(score.status)}`;
}

function codeReviewScoreNarrative(score: CodeReviewScoreSummary | null): string | null {
  if (!score) return null;
  return score.narrative
    ?? (score.status === 'scored'
      ? 'Score report is available, but no narrative was returned.'
      : 'The score report will appear after scoring completes.');
}

function codeReviewSignalBasisItems(input: {
  score: CodeReviewScoreSummary | null;
  submission: CodeReviewSubmissionDetail | null;
  match: CodeReviewMatchDetail | null;
  proofCount: number;
}): CodeReviewSignalBasisItem[] {
  const scoreReady = Boolean(input.score && input.score.status === 'scored');
  const annotationCount = input.submission?.annotations.length ?? 0;
  const pushbackCount = input.submission?.defenseThreads.length ?? 0;
  const qualityScore = input.match?.assessmentQuality
    ? `${input.match.assessmentQuality.score}/${input.match.assessmentQuality.maxScore} ${titleCaseToken(input.match.assessmentQuality.verdict.toLowerCase())}`
    : null;
  return [
    {
      label: 'Score report',
      value: scoreReady ? 'Scored' : input.score ? titleCaseToken(input.score.status) : 'Missing',
      satisfied: scoreReady,
    },
    {
      label: 'Review evidence',
      value: countLabel(annotationCount, 'annotation'),
      satisfied: annotationCount > 0,
    },
    {
      label: 'Pushback',
      value: countLabel(pushbackCount, 'thread'),
      satisfied: pushbackCount > 0,
    },
    {
      label: 'Match proof',
      value: input.proofCount > 0
        ? countLabel(input.proofCount, 'bridge')
        : qualityScore ?? 'Missing',
      satisfied: input.proofCount > 0 || Boolean(input.match?.assessmentQuality),
    },
  ];
}

function codeReviewAssessmentValiditySummary(input: {
  score: CodeReviewScoreSummary | null;
  submission: CodeReviewSubmissionDetail | null;
  match: CodeReviewMatchDetail | null;
  proofCount: number;
}): CodeReviewAssessmentValidity {
  const matchReady = input.match?.status === 'MATCHED';
  const scoreReady = input.score?.status === 'scored' && typeof input.score.score === 'number' && Number.isFinite(input.score.score);
  const annotationCount = input.submission?.annotations.length ?? 0;
  const pushbackCount = input.submission?.defenseThreads.length ?? 0;
  const hasMatchProof = input.proofCount > 0 || Boolean(input.match?.assessmentQuality);

  if (!matchReady) {
    return {
      value: 'Do not rely on score yet',
      detail: 'Repo fit is not source-backed, so this interview can only guide evidence collection until a quality-gated PR challenge exists.',
      tone: 'blocked',
    };
  }

  if (scoreReady && annotationCount > 0 && pushbackCount > 0 && hasMatchProof) {
    return {
      value: 'Usable with calibration',
      detail: 'Score, review comments, developer pushback, and match proof are present; use this as a source-backed signal, not an automatic hiring decision.',
      tone: 'positive',
    };
  }

  if (scoreReady && annotationCount > 0 && hasMatchProof) {
    return {
      value: 'Usable but incomplete',
      detail: 'Score and review evidence are present, but developer pushback is missing, so validate the judgment in the next conversation.',
      tone: 'neutral',
    };
  }

  if (scoreReady) {
    return {
      value: 'Score needs human calibration',
      detail: 'A score report exists, but the review evidence or match proof is incomplete; read the source trail before relying on it.',
      tone: 'watch',
    };
  }

  if (input.submission) {
    return {
      value: 'Submitted, scoring pending',
      detail: 'Candidate review evidence exists; wait for the durable score report before treating this as a scored assessment.',
      tone: 'neutral',
    };
  }

  return {
    value: 'No score signal yet',
    detail: 'The PR assignment is ready, but the candidate still needs to complete the code-review assessment.',
    tone: 'neutral',
  };
}

function codeReviewAssignmentTrustSummary(input: {
  setup: AssessmentSetupProjection | null | undefined;
  match: CodeReviewMatchDetail | null;
}): CodeReviewAssignmentTrust {
  const status = input.setup?.status ?? null;
  const kind = input.setup?.kind ?? null;
  const source = input.setup?.source ?? null;

  if (kind === 'manual_open_source_task') {
    return {
      value: 'Manual task',
      detail: 'A recruiter supplied a source-backed repo task packet. Treat it as a real assignment, but not as proof that PIPE automatically matched the candidate to this repo.',
      tone: 'watch',
    };
  }

  if (source === 'recruiter_manual_override') {
    return {
      value: 'Manual PR',
      detail: 'This PR was selected manually. Use the candidate review as evidence, but do not read the assignment itself as candidate-fit proof.',
      tone: 'watch',
    };
  }

  if (status === 'missing_reviewable_task') {
    return {
      value: 'No safe challenge',
      detail: 'No reviewable, source-backed repo challenge is attached yet. Resolve the assignment before relying on the assessment.',
      tone: 'blocked',
    };
  }

  if (status === 'waiting_for_candidate_evidence' || status === 'waiting_for_source_backed_match') {
    return {
      value: 'Needs evidence',
      detail: 'PIPE needs more source-backed candidate or role evidence before selecting a fair challenge.',
      tone: 'blocked',
    };
  }

  if (input.setup?.blocksPositiveAssessment || (input.match && input.match.status !== 'MATCHED')) {
    return {
      value: 'Needs evidence',
      detail: 'The current repo assignment is not quality-gated enough to support a positive code-review signal.',
      tone: 'blocked',
    };
  }

  if (source === 'matched_repo_id' || kind === 'auto_match' || input.match?.status === 'MATCHED') {
    return {
      value: 'Matched',
      detail: 'PIPE selected this challenge from source-backed candidate evidence, role context, and repo demand. Use it as assignment-fit evidence alongside the candidate review.',
      tone: 'positive',
    };
  }

  if (status === 'reviewable_task_assigned' || kind === 'github_pr') {
    return {
      value: 'Reviewable task',
      detail: 'A reviewable task is attached, but the source of candidate-fit proof is not explicit. Confirm the match proof before relying on it.',
      tone: 'neutral',
    };
  }

  return {
    value: 'Assignment unknown',
    detail: 'PIPE has not exposed enough assignment provenance to treat this as a trusted code-review signal.',
    tone: 'neutral',
  };
}

function countMatchRefs(refs: CodeReviewMatchSourceRef[]): number {
  return refs.filter((ref) => Boolean(ref.exactText || ref.sourceRefId || ref.sourceSpanId || ref.locator)).length;
}

function codeReviewSelectedChallengeLabel(input: {
  repoUrl: string | null | undefined;
  prNumber: number | null | undefined;
  match: CodeReviewMatchDetail | null;
}): string {
  const repo = githubRepoLabel(input.repoUrl);
  const pr = typeof input.prNumber === 'number'
    ? ` PR #${input.prNumber}`
    : '';
  if (repo || pr) return `${repo ?? 'Selected repo'}${pr}`;
  if (input.match?.status === 'MATCHED') return 'Matched PR challenge';
  if (input.match) return titleCaseToken(input.match.status);
  return 'No reviewable challenge yet';
}

function codeReviewMatchExplanation(input: {
  repoUrl: string | null | undefined;
  prNumber: number | null | undefined;
  match: CodeReviewMatchDetail | null;
  score: CodeReviewScoreSummary | null;
  submission: CodeReviewSubmissionDetail | null;
  assignmentTrust: CodeReviewAssignmentTrust;
  validity: CodeReviewAssessmentValidity;
  risk: CodeReviewDecisionRisk;
  matchPathLabel: string;
}): CodeReviewMatchExplanation {
  const selectedChallenge = codeReviewSelectedChallengeLabel({
    repoUrl: input.repoUrl,
    prNumber: input.prNumber,
    match: input.match,
  });
  const matchStatus = input.match?.status?.toUpperCase() ?? null;

  if (!input.match || matchStatus !== 'MATCHED') {
    return {
      selectedChallenge,
      whyThisChallenge: input.match?.summary
        || 'PIPE has not selected a quality-gated, source-backed repo challenge for this interview.',
      proofSummary: input.risk.missingContext[0]
        ? `Missing: ${input.risk.missingContext[0]}`
        : 'Missing source-backed candidate, role, or repo evidence.',
      riskSummary: input.validity.detail,
      remainingQuestion: input.risk.uncertainty.detail,
      tone: 'blocked',
    };
  }

  const primaryEvidence = input.match.evidence[0] ?? null;
  const candidateRefCount = primaryEvidence ? countMatchRefs(primaryEvidence.candidateSourceRefs) : 0;
  const roleRefCount = primaryEvidence ? countMatchRefs(primaryEvidence.roleSourceRefs) : 0;
  const challengeRefCount = primaryEvidence ? countMatchRefs(primaryEvidence.challengeSourceRefs) : 0;
  const bridge = input.match.validatorAgent?.sourceBridge ?? null;
  const personSources = bridge?.candidateSourceCount ?? candidateRefCount;
  const roleSources = bridge?.roleSourceCount ?? roleRefCount;
  const repoSources = bridge?.repoSourceCount ?? challengeRefCount;
  const hyperedgeCount = input.match.evidenceHyperedges.length;
  const quality = input.match.assessmentQuality
    ? `${input.match.assessmentQuality.score}/${input.match.assessmentQuality.maxScore} ${titleCaseToken(input.match.assessmentQuality.verdict.toLowerCase())}`
    : formatMatchScore(input.match.score);
  const scoreText = input.score?.status === 'scored'
    ? (codeReviewScoreHeadline(input.score) ?? 'Score ready')
    : input.submission
      ? 'Candidate review submitted; scoring pending'
      : 'Candidate review not submitted yet';
  const proofParts = [
    personSources > 0 ? countLabel(personSources, 'person source') : null,
    roleSources > 0 ? countLabel(roleSources, 'role source') : null,
    repoSources > 0 ? countLabel(repoSources, 'repo source') : null,
    hyperedgeCount > 0 ? countLabel(hyperedgeCount, 'evidence bridge') : null,
    quality ? `quality ${quality}` : null,
  ].filter((part): part is string => Boolean(part));

  return {
    selectedChallenge,
    whyThisChallenge: input.match.summary
      || `PIPE aligned ${input.matchPathLabel} for this reviewable PR challenge.`,
    proofSummary: proofParts.length > 0
      ? proofParts.join(' · ')
      : 'Source proof exists in the match packet; open source proof for exact spans.',
    riskSummary: `${input.assignmentTrust.value}: ${input.assignmentTrust.detail}`,
    remainingQuestion: `${input.validity.value}: ${input.validity.detail} ${scoreText}.`,
    tone: input.validity.tone,
  };
}

function codeReviewNextStepRecommendation(
  score: CodeReviewScoreSummary | null,
  submission: CodeReviewSubmissionDetail | null,
  match: CodeReviewMatchDetail | null,
): CodeReviewNextStep {
  if (match && match.status !== 'MATCHED') {
    return {
      value: 'Collect missing evidence',
      detail: 'Create the targeted follow-up assessment before sending or trusting a PR challenge.',
      tone: 'blocked',
    };
  }
  if (!submission && match?.status === 'MATCHED') {
    return {
      value: 'Wait for candidate review',
      detail: 'The PR assignment is ready; do not make a hiring decision until the candidate submits source-backed review comments.',
      tone: 'neutral',
    };
  }
  if (score && score.status !== 'scored') {
    return {
      value: 'Wait for scoring',
      detail: 'The candidate review is submitted; wait for the score report before using this as a hiring signal.',
      tone: 'neutral',
    };
  }
  const scoreValue = score?.score;
  const scoreBand = score?.band?.toLowerCase() ?? null;
  if (typeof scoreValue === 'number' && Number.isFinite(scoreValue)) {
    if (scoreValue < 50 || scoreBand === 'weak') {
      return {
        value: 'Schedule targeted follow-up',
        detail: 'Use the growth area as the next live interview prompt before advancing this candidate.',
        tone: 'watch',
      };
    }
    if (scoreValue < 75 || scoreBand === 'adequate') {
      return {
        value: 'Advance with focused probe',
        detail: 'Verify the growth area in the next live interview before treating this as a clean pass.',
        tone: 'neutral',
      };
    }
    return {
      value: 'Advance to next stage',
      detail: 'Use the source-backed review, annotations, and pushback as evidence to move the candidate forward.',
      tone: 'positive',
    };
  }
  if (submission) {
    return {
      value: 'Review manually',
      detail: 'Candidate review exists, but scoring is unavailable. Read annotations and pushback before deciding.',
      tone: 'neutral',
    };
  }
  return {
    value: 'Collect code-review signal',
    detail: 'Send or wait for the candidate review before making a hiring decision.',
    tone: 'neutral',
  };
}

function readableGapLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Missing source-backed evidence';
  if (/^[A-Z0-9_:-]+$/.test(trimmed)) {
    return titleCaseToken(trimmed).replace(/\bPr\b/g, 'PR');
  }
  return trimmed;
}

function probeContextLabel(value: string): string {
  return /^probe\b/i.test(value.trim()) ? value.trim() : `Probe: ${value.trim()}`;
}

function codeReviewDecisionRiskSummary(
  score: CodeReviewScoreSummary | null,
  submission: CodeReviewSubmissionDetail | null,
  match: CodeReviewMatchDetail | null,
): CodeReviewDecisionRisk {
  const missingContext: string[] = [];
  const matchStatus = match?.status?.toUpperCase() ?? null;
  const hasMatchedChallenge = matchStatus === 'MATCHED';

  if (!match) {
    return {
      uncertainty: {
        value: 'Repo fit unknown',
        detail: 'This meeting has no source-backed repo match yet, so it cannot support a code-review hiring signal.',
      },
      missingContext: ['Source-backed repo challenge selection'],
    };
  }

  if (!hasMatchedChallenge) {
    missingContext.push(
      ...(match.gaps.length > 0
        ? match.gaps.slice(0, 3).map(readableGapLabel)
        : ['Source-backed candidate work evidence']),
    );
    return {
      uncertainty: {
        value: 'Repo fit not proven',
        detail: match.summary || 'PIPE needs more source-backed person evidence before this meeting can assign a fair PR challenge.',
      },
      missingContext,
    };
  }

  if (!submission) missingContext.push('Candidate review comments on the assigned PR');
  if (!score) {
    missingContext.push('Durable score report');
  } else if (score.status !== 'scored') {
    missingContext.push('Completed score report');
  }
  if (submission && submission.defenseThreads.length === 0) {
    missingContext.push('Developer pushback calibration');
  }
  if (match.gaps.length > 0) {
    missingContext.push(...match.gaps.slice(0, 2).map(readableGapLabel));
  }
  for (const area of score?.growthAreas.slice(0, 2) ?? []) {
    missingContext.push(probeContextLabel(area));
  }

  const scoreValue = score?.score;
  const scoreBand = score?.band?.toLowerCase() ?? null;
  if (typeof scoreValue === 'number' && Number.isFinite(scoreValue) && (scoreValue < 50 || scoreBand === 'weak')) {
    return {
      uncertainty: {
        value: 'High calibration risk',
        detail: 'The score is weak enough that the next step should verify whether this reflects candidate ability, assignment fit, or missing context.',
      },
      missingContext: missingContext.slice(0, 4),
    };
  }
  if ((score?.growthAreas.length ?? 0) > 0 || scoreBand === 'adequate' || (typeof scoreValue === 'number' && scoreValue < 75)) {
    return {
      uncertainty: {
        value: 'Focused calibration needed',
        detail: score?.growthAreas[0] ?? 'Use the next conversation to confirm the code-review signal generalizes beyond this PR.',
      },
      missingContext: missingContext.slice(0, 4),
    };
  }
  if (missingContext.length > 0) {
    return {
      uncertainty: {
        value: 'Evidence chain incomplete',
        detail: 'The assigned PR is source-backed, but this meeting still needs the remaining candidate or scoring evidence before it is high-confidence.',
      },
      missingContext: missingContext.slice(0, 4),
    };
  }
  return {
    uncertainty: {
      value: 'Low remaining uncertainty',
      detail: 'The main remaining question is whether this code-review signal transfers beyond the selected PR.',
    },
    missingContext: ['No blocking evidence gap; confirm the signal transfers beyond this PR.'],
  };
}

function githubRepoLabel(repoUrl: string | null | undefined): string | null {
  const value = repoUrl?.trim();
  if (!value) return null;
  return value.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '') || value;
}

function codeReviewRefreshSuccessNotice(
  result: Pick<CodeReviewMatchRefreshResponse, 'repoUrl' | 'prNumber'>,
): string {
  const repo = githubRepoLabel(result.repoUrl);
  const pr = typeof result.prNumber === 'number' ? ` PR #${result.prNumber}` : '';
  return repo || pr
    ? `Repo match refreshed from captured evidence: ${repo ?? 'selected repo'}${pr}.`
    : 'Repo match refreshed from captured evidence.';
}

async function writeClipboardWithTimeout(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  let timeoutId: number | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(false), CLIPBOARD_WRITE_TIMEOUT_MS);
  });
  const write = navigator.clipboard.writeText(value)
    .then(() => true)
    .catch(() => false);
  const copied = await Promise.race([write, timeout]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  return copied;
}

function copySelectedInputToClipboard(value: string, fallbackInput: HTMLInputElement | null): { copied: boolean; selected: boolean } {
  if (!fallbackInput) return { copied: false, selected: false };

  fallbackInput.focus();
  fallbackInput.select();
  fallbackInput.setSelectionRange(0, value.length);
  if (typeof document.execCommand !== 'function') return { copied: false, selected: true };

  try {
    return { copied: document.execCommand('copy'), selected: true };
  } catch {
    return { copied: false, selected: true };
  }
}

async function copyTextToClipboard(value: string, fallbackInput: HTMLInputElement | null): Promise<CopyTextResult> {
  const fallback = copySelectedInputToClipboard(value, fallbackInput);
  if (fallback.copied) return 'copied';
  if (await writeClipboardWithTimeout(value)) return 'copied';
  return fallback.selected ? 'selected' : 'failed';
}

const SOURCE_BACKED_WORK_EVIDENCE_QUESTION =
  'Describe one real PR, bug, or code review you personally handled that best represents the work PIPE should assess. Include the codebase context, your role, trade-offs, verification/tests, and outcome.';

function fallbackEvidencePlanItem(
  match: CodeReviewMatchDetail,
  gap: string,
): CodeReviewEvidencePlanItem {
  const normalizedGap = gap.trim() || (
    match.status === 'NEEDS_MORE_EVIDENCE'
      ? 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'
      : 'NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE'
  );
  const missingSignal = normalizedGap === 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'
    ? 'Source-backed candidate work evidence'
    : normalizedGap.replace(/_/g, ' ').toLowerCase();
  return {
    id: `fallback:${normalizedGap}`,
    missingSignal,
    whyItMatters: 'PIPE cannot fairly select a real PR challenge until this missing evidence is tied to the person graph.',
    recommendedAssessment: match.status === 'NO_ROLE_SAFE_CHALLENGE'
      ? 'manual_review_selection'
      : 'recorded_evidence_question',
    expectedEvidence: 'A concrete project, personal action, technical constraint, and verification detail that can be cited back to the candidate.',
    question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
    source: {
      matchRunId: match.matchRunId,
      matchStatus: match.status,
      gap: normalizedGap,
    },
  };
}

function codeReviewEvidencePlanItems(
  match: CodeReviewMatchDetail | null,
  submission: CodeReviewSubmissionDetail | null,
): CodeReviewEvidencePlanItem[] {
  if (!match || match.status === 'MATCHED' || submission) return [];
  if (match.evidencePlan && match.evidencePlan.length > 0) return match.evidencePlan;
  const gaps = match.gaps.length > 0
    ? match.gaps
    : [match.status === 'NEEDS_MORE_EVIDENCE'
      ? 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'
      : 'NO_SOURCE_BACKED_MATCH_RECORD_AVAILABLE'];
  return gaps.slice(0, 3).map((gap) => fallbackEvidencePlanItem(match, gap));
}

function parseEvidenceFollowUpPlan(raw: string | null | undefined): EvidenceFollowUpPlan | null {
  if (!raw) return null;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines[0] !== 'PIPE context call for blocked code-review matching.') return null;

  const readValue = (prefix: string): string | null => {
    const line = lines.find((item) => item.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() || null : null;
  };

  const gaps = lines
    .flatMap((line): string[] => {
      const match = /^Evidence gap \d+:\s*(.+)$/.exec(line);
      if (!match?.[1]) return [];
      const gap = match[1].trim();
      return gap && gap !== 'none recorded' ? [gap] : [];
    });

  const questionStart = lines.indexOf('Suggested questions:');
  const questions = questionStart >= 0
    ? lines.slice(questionStart + 1).flatMap((line): string[] => {
        const match = /^\d+\.\s*(.+)$/.exec(line);
        return match?.[1]?.trim() ? [match[1].trim()] : [];
      })
    : [];

  if (questions.length === 0) return null;

  return {
    originalInterviewId: readValue('Original CODE_REVIEW interview:'),
    matchStatus: readValue('Match status:'),
    matchSummary: readValue('Match summary:'),
    gaps,
    questions,
  };
}

function evidenceFollowUpInviteMessage(plan: EvidenceFollowUpPlan): string {
  const question = plan.questions[0];
  const gap = plan.gaps[0];
  return [
    'PIPE would like to capture one bit of source-backed context before assigning a code-review challenge.',
    '',
    `Question: ${question}`,
    gap ? `Focus: ${gap}` : null,
    'Please come ready to answer with a concrete project, your actions, the constraints, and how you verified the outcome.',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
    .slice(0, 1000);
}

function parseTranscriptJson(raw: string | null | undefined): TranscriptEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.flatMap((entry): TranscriptEntry[] => {
          if (!entry || typeof entry !== 'object') return [];
          const record = entry as Record<string, unknown>;
          if (typeof record.text !== 'string' || record.text.trim().length === 0) return [];
          const role =
            typeof record.role === 'string' && record.role.length > 0
              ? record.role
              : typeof record.speaker === 'string' && record.speaker.length > 0
                ? record.speaker
                : 'speaker';
          return [{
            role,
            text: record.text,
            timestamp: typeof record.timestamp === 'string' ? record.timestamp : null,
            timestampStartMs: typeof record.timestamp_start_ms === 'number' ? record.timestamp_start_ms : null,
            timestampEndMs: typeof record.timestamp_end_ms === 'number' ? record.timestamp_end_ms : null,
          }];
        })
      : [];
  } catch {
    return [];
  }
}

function parseTranscript(artifact: TranscriptArtifact | null | undefined): TranscriptEntry[] {
  return parseTranscriptJson(artifact?.transcriptJson);
}

function transcriptTimeLabel(entry: TranscriptEntry): string | null {
  if (entry.timestamp) return formatDate(entry.timestamp, '');
  return formatDurationMs(entry.timestampStartMs);
}

function parseAnalysisList(raw: string | null | undefined, key: 'topics' | 'decisions' | 'followUps'): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

function parseAnalysisString(raw: string | null | undefined, key: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function transcriptStatusLabel(status: string): string {
  switch (status) {
    case 'READY':
    case 'COMPLETED':
      return 'Transcript ready';
    case 'PROCESSING':
      return 'Processing transcript';
    case 'FAILED':
      return 'Transcript failed';
    case 'RECORDING':
      return 'Recording';
    case 'NONE':
      return 'Not recorded yet';
    default:
      return status.replace(/[_-]+/g, ' ').toLowerCase();
  }
}

function isLiveRecordingMeeting(meeting: ScheduledInterviewDetail['linkedMeeting']): boolean {
  if (!meeting || meeting.transcriptStatus !== 'RECORDING') return false;
  if (meeting.endedAt || meeting.recordingR2Key) return false;
  const status = meeting.status.toUpperCase();
  if (status !== 'IN_PROGRESS' && status !== 'ACTIVE') return false;
  if (!meeting.startedAt) return true;
  const startedAtMs = new Date(meeting.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return true;
  return Date.now() - startedAtMs < LIVE_RECORDING_STALE_AFTER_MS;
}

function personContextModeText(mode: string | null, reason: string | null): string | null {
  if (mode === 'attributed') {
    return 'Guest statements are attached to this person with speaker-attributed source spans.';
  }
  if (mode === 'summary_only') {
    return reason === 'guest_contact_id_missing'
      ? 'Transcript is stored, but person evidence is summary-only until the guest is linked to a person.'
      : 'Transcript is stored as meeting evidence, but person signals stay summary-only because speaker attribution was not strong enough.';
  }
  return null;
}

function relatedEvidenceRelationshipLabel(
  related: NonNullable<ScheduledInterviewDetail['relatedEvidenceInterviews']>[number],
): string {
  switch (related.relationship) {
    case 'code_review_evidence_follow_up':
      return 'Evidence follow-up';
    case 'originating_code_review':
      return 'Original code review';
    case 'same_person_assessment':
      switch (related.interviewType) {
        case 'CODE_REVIEW':
          return 'Other code review';
        case 'DEV_CONTAINER_CHALLENGE':
          return 'Other dev challenge';
        case 'OPEN_SOURCE_BUG_FIX':
          return 'Other open-source task';
        case 'VIDEO':
        case 'SCREENING':
          return 'Other conversation';
        default:
          return 'Other interaction';
      }
    default:
      return titleCaseToken(related.relationship);
  }
}

function relatedEvidenceDetail(related: NonNullable<ScheduledInterviewDetail['relatedEvidenceInterviews']>[number]): string {
  const parts = [
    related.interviewType ? sentenceCaseToken(related.interviewType) : null,
    related.assessmentSessionState ? `assessment ${sentenceCaseToken(related.assessmentSessionState).toLowerCase()}` : null,
    related.transcriptStatus && related.transcriptStatus !== 'NONE'
      ? `transcript ${sentenceCaseToken(related.transcriptStatus).toLowerCase()}`
      : null,
    related.linkedMeetingId ? 'meeting room attached' : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Evidence interview';
}

function relatedEvidenceDisplayName(related: NonNullable<ScheduledInterviewDetail['relatedEvidenceInterviews']>[number]): string {
  return related.displayName
    ?? related.primaryEmail
    ?? relatedEvidenceRelationshipLabel(related);
}

function summarizeRelatedEvidenceInterviews(
  relatedInterviews: RelatedEvidenceInterview[],
  totalCount: number,
): RelatedEvidenceDecisionSummary {
  const followUpCount = relatedInterviews.filter((related) =>
    related.relationship === 'code_review_evidence_follow_up'
  ).length;
  const technicalAssessmentCount = relatedInterviews.filter((related) =>
    ['CODE_REVIEW', 'DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX'].includes(related.interviewType ?? '')
  ).length;
  const conversationCount = relatedInterviews.filter((related) =>
    ['VIDEO', 'SCREENING'].includes(related.interviewType ?? '')
  ).length;
  const readyTranscriptCount = relatedInterviews.filter((related) =>
    related.transcriptStatus === 'READY' || related.transcriptStatus === 'COMPLETED'
  ).length;
  const activeFollowUp = relatedInterviews.find((related) =>
    related.relationship === 'code_review_evidence_follow_up'
    && ['INVITED', 'SCHEDULED', 'ACTIVE', 'IN_PROGRESS'].includes(related.status)
  );

  if (activeFollowUp) {
    return {
      headline: 'Evidence follow-up is already linked',
      detail: 'Use it to capture the missing person context, then rerun repo matching from source-backed evidence.',
      nextAction: 'Open the linked follow-up before creating another interview.',
      metrics: [
        { label: 'follow-ups', value: followUpCount },
        { label: 'technical assessments', value: technicalAssessmentCount },
        { label: 'ready transcripts', value: readyTranscriptCount },
      ],
    };
  }

  if (followUpCount > 0) {
    return {
      headline: 'Follow-up evidence exists',
      detail: 'Review the follow-up result before deciding whether the current code-review assignment is fair.',
      nextAction: 'Open the person profile for the complete evidence trail.',
      metrics: [
        { label: 'follow-ups', value: followUpCount },
        { label: 'technical assessments', value: technicalAssessmentCount },
        { label: 'ready transcripts', value: readyTranscriptCount },
      ],
    };
  }

  if (readyTranscriptCount > 0) {
    return {
      headline: 'Background conversation evidence is available',
      detail: 'This meeting stays scoped, but the person profile has transcript-backed context you can use for calibration.',
      nextAction: 'Open the person profile before changing the recommendation.',
      metrics: [
        { label: 'conversations', value: conversationCount },
        { label: 'technical assessments', value: technicalAssessmentCount },
        { label: 'ready transcripts', value: readyTranscriptCount },
      ],
    };
  }

  return {
    headline: 'Separate interview history exists',
    detail: 'Treat these as related context, not evidence from this meeting. Use the person profile for the full rollup.',
    nextAction: totalCount > relatedInterviews.length
      ? 'Open the person profile to review the full history.'
      : 'Compare related context only after this meeting evidence is clear.',
    metrics: [
      { label: 'related previews', value: relatedInterviews.length },
      { label: 'technical assessments', value: technicalAssessmentCount },
      { label: 'conversations', value: conversationCount },
    ],
  };
}

type AssessmentInviteLinkState = 'active' | 'claimed' | 'stale' | null;

function assessmentInviteStatusLabel(state: AssessmentInviteLinkState, hasUrl: boolean): string {
  if (!hasUrl) return 'Not sent';
  switch (state) {
    case 'active':
      return 'Active';
    case 'claimed':
      return 'Started';
    case 'stale':
      return 'Stale';
    default:
      return 'Active';
  }
}

function assessmentInviteValidityLabel(state: AssessmentInviteLinkState, hasUrl: boolean): string {
  if (!hasUrl) return 'No candidate link exists yet';
  switch (state) {
    case 'claimed':
      return 'Historical link only';
    case 'stale':
      return 'Older token, do not share';
    case 'active':
    default:
      return 'Copyable one-use link';
  }
}

function assessmentInviteEvidenceLabel(
  state: AssessmentInviteLinkState,
  input: { hasUrl: boolean; hasSubmittedEvidence: boolean },
): string {
  if (input.hasSubmittedEvidence) return 'Assessment evidence attached';
  if (!input.hasUrl) return 'No assessment link sent';
  if (state === 'claimed') return 'Started, no submission';
  if (state === 'stale') return 'No current assessment evidence';
  return 'Awaiting candidate submission';
}

function assessmentInviteNextActionLabel(
  state: AssessmentInviteLinkState,
  input: { hasUrl: boolean; hasEmail: boolean },
): string {
  if (!input.hasEmail) return 'Add a candidate email before sending an assessment invite.';
  if (!input.hasUrl) return 'Send the assessment invite to create a one-use candidate link.';
  switch (state) {
    case 'claimed':
      return 'Resend the invite to issue a fresh one-use assessment link.';
    case 'stale':
      return 'Resend the invite before sharing a candidate assessment link.';
    case 'active':
    default:
      return 'Copy the candidate link, or resend if the candidate needs a new email.';
  }
}

function StatusBadge({ status }: { status: string | null | undefined }): JSX.Element {
  const label = status ?? 'INVITED';
  const color = STATUS_COLORS[label] ?? '#9ca3af';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        width: 'fit-content',
        padding: '5px 9px',
        borderRadius: 4,
        border: `1px solid ${color}33`,
        background: `${color}16`,
        color,
        fontFamily: FONT,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

function Section({
  title,
  icon,
  children,
  style,
}: {
  title: string;
  icon: JSX.Element;
  children: ReactNode;
  style?: CSSProperties | undefined;
}): JSX.Element {
  return (
    <section style={{ ...SECTION, ...style }}>
      <div style={SECTION_TITLE}>
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

export default function InterviewDetailPage(): JSX.Element {
  const { interviewId } = useParams<{ interviewId: string }>();
  const navigate = useNavigate();
  const api = useApiClient();
  const [interview, setInterview] = useState<ScheduledInterviewDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomLinks, setRoomLinks] = useState<PreparedRoomLinks | null>(null);
  const [isPreparingRoom, setIsPreparingRoom] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [contextCallError, setContextCallError] = useState<string | null>(null);
  const [isCreatingContextCall, setIsCreatingContextCall] = useState(false);
  const [matchRefreshError, setMatchRefreshError] = useState<string | null>(null);
  const [matchRefreshNotice, setMatchRefreshNotice] = useState<string | null>(null);
  const [isRefreshingMatch, setIsRefreshingMatch] = useState(false);
  const [assessmentEvaluationError, setAssessmentEvaluationError] = useState<string | null>(null);
  const [assessmentEvaluationNotice, setAssessmentEvaluationNotice] = useState<string | null>(null);
  const [assessmentLinkError, setAssessmentLinkError] = useState<string | null>(null);
  const [assessmentLinkNotice, setAssessmentLinkNotice] = useState<string | null>(null);
  const [isStartingAssessmentEvaluation, setIsStartingAssessmentEvaluation] = useState(false);
  const [humanDecisionValue, setHumanDecisionValue] = useState<HumanAssessmentDecisionValue>('advance');
  const [humanDecisionSummary, setHumanDecisionSummary] = useState('');
  const [humanDecisionNotes, setHumanDecisionNotes] = useState('');
  const [humanDecisionError, setHumanDecisionError] = useState<string | null>(null);
  const [humanDecisionNotice, setHumanDecisionNotice] = useState<string | null>(null);
  const [isRecordingHumanDecision, setIsRecordingHumanDecision] = useState(false);
  const [workspaceRepoUrl, setWorkspaceRepoUrl] = useState('');
  const [workspacePrNumber, setWorkspacePrNumber] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const guestLinkInputRef = useRef<HTMLInputElement | null>(null);
  const assessmentLinkInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!interviewId) return;
    const showLoading = options?.showLoading ?? !hasLoadedOnceRef.current;
    if (showLoading) setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<{ interview: ScheduledInterviewDetail }>(
        `/api/v1/scheduling/interviews/${interviewId}`,
      );
      hasLoadedOnceRef.current = true;
      setInterview(result.interview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load interview');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [api, interviewId]);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setInterview(null);
    void load({ showLoading: true });
  }, [interviewId, load]);

  useEffect(() => {
    if (!interview) return;
    setWorkspaceRepoUrl(interview.githubRepoUrl ?? '');
    setWorkspacePrNumber(interview.githubPrNumber ? String(interview.githubPrNumber) : '');
  }, [interview]);

  useEffect(() => {
    setHumanDecisionSummary('');
    setHumanDecisionNotes('');
    setHumanDecisionError(null);
    setHumanDecisionNotice(null);
    setHumanDecisionValue('advance');
  }, [interviewId]);

  const transcriptEntries = useMemo(() => {
    const meetingEntries = parseTranscriptJson(interview?.linkedMeeting?.transcriptJson);
    return meetingEntries.length > 0
      ? meetingEntries
      : parseTranscript(interview?.transcriptArtifact);
  }, [interview?.linkedMeeting?.transcriptJson, interview?.transcriptArtifact]);

  const transcriptTopics = useMemo(
    () => parseAnalysisList(interview?.linkedMeeting?.transcriptAnalysisJson, 'topics'),
    [interview?.linkedMeeting?.transcriptAnalysisJson],
  );
  const transcriptDecisions = useMemo(
    () => parseAnalysisList(interview?.linkedMeeting?.transcriptAnalysisJson, 'decisions'),
    [interview?.linkedMeeting?.transcriptAnalysisJson],
  );
  const personContextMode = useMemo(
    () => parseAnalysisString(interview?.linkedMeeting?.transcriptAnalysisJson, 'personContextMode'),
    [interview?.linkedMeeting?.transcriptAnalysisJson],
  );
  const personContextReason = useMemo(
    () => parseAnalysisString(interview?.linkedMeeting?.transcriptAnalysisJson, 'personContextReason'),
    [interview?.linkedMeeting?.transcriptAnalysisJson],
  );
  const codeReviewSubmission = useMemo(
    () => parseCodeReviewSubmission(interview?.submissionJson),
    [interview?.submissionJson],
  );
  const evidenceFollowUpPlan = useMemo(
    () => parseEvidenceFollowUpPlan(interview?.recruiterNotes),
    [interview?.recruiterNotes],
  );

  const ensureRoomLinks = useCallback(async (): Promise<PreparedRoomLinks | null> => {
    if (!interview) return null;
    setRoomError(null);
    setRoomNotice(null);
    setIsPreparingRoom(true);
    try {
      let meetingId = interview.linkedMeeting?.id ?? null;
      if (!meetingId) {
        const name =
          interview.candidateName
          ?? interview.recipientName
          ?? interview.candidateEmail
          ?? interview.recipientEmail
          ?? 'Interview guest';
        const email = interview.candidateEmail ?? interview.recipientEmail;
        if (!email) {
          setRoomError('Add an email before creating a video room.');
          return null;
        }
        const role = interview.pipelineTitle ?? 'Talent Pool';
        const stage = interview.stageTitle ?? interview.interviewType ?? 'Interview';
        const created = await api.post<{ meeting: { id: string } }>('/api/v1/meetings', {
          recipientName: name,
          recipientEmail: email,
          title: `${name} interview`,
          description: `${role} · ${stage}`,
          meetingType: 'INTERVIEW',
          scheduledAt: interview.scheduledAt ?? undefined,
          scheduledInterviewId: interview.id,
        });
        meetingId = created.meeting.id;
      }

      const prepared = await api.post<{ room: PreparedRoomLinks }>(
        `/api/v1/meetings/${meetingId}/room`,
        {},
      );
      setRoomLinks(prepared.room);
      await load({ showLoading: false });
      return prepared.room;
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to prepare video room');
      return null;
    } finally {
      setIsPreparingRoom(false);
    }
  }, [api, interview, load]);

  const openHostRoom = useCallback(async () => {
    const links = await ensureRoomLinks();
    if (!links?.hostUrl) return;
    const opened = window.open(links.hostUrl, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(links.hostUrl);
  }, [ensureRoomLinks]);

  const copyGuestLink = useCallback(async () => {
    const existingGuestUrl = roomLinks?.guestUrl ?? interview?.linkedMeeting?.meetingUrl ?? null;
    const links = existingGuestUrl ? null : await ensureRoomLinks();
    const guestUrl = existingGuestUrl ?? links?.guestUrl ?? null;
    if (!guestUrl) return;
    const copyResult = await copyTextToClipboard(guestUrl, guestLinkInputRef.current);
    if (copyResult === 'copied') {
      setRoomNotice('Guest link copied.');
      setRoomError(null);
      return;
    }
    if (copyResult === 'selected') {
      setRoomNotice('Guest link selected. Press Cmd+C to copy.');
      setRoomError(null);
      return;
    }
    setRoomNotice(null);
    setRoomError('Copy failed. Select the guest link below.');
  }, [ensureRoomLinks, interview?.linkedMeeting?.meetingUrl, roomLinks?.guestUrl]);

  const copyAssessmentInviteLink = useCallback(async () => {
    const assessmentUrl = interview?.assessmentSetup?.lastDeliveredUrl ?? null;
    const assessmentUrlState = interview?.assessmentSetup?.lastDeliveredUrlState ?? (assessmentUrl ? 'active' : null);
    if (!assessmentUrl || assessmentUrlState !== 'active') return;
    setAssessmentLinkError(null);
    setAssessmentLinkNotice(null);
    const copyResult = await copyTextToClipboard(assessmentUrl, assessmentLinkInputRef.current);
    if (copyResult === 'copied') {
      setAssessmentLinkNotice('Assessment link copied.');
      return;
    }
    if (copyResult === 'selected') {
      setAssessmentLinkNotice('Assessment link selected. Press Cmd+C to copy.');
      return;
    }
    setAssessmentLinkError('Copy failed. Select the assessment link below.');
  }, [interview?.assessmentSetup?.lastDeliveredUrl, interview?.assessmentSetup?.lastDeliveredUrlState]);

  const resendAssessmentInvite = useCallback(async () => {
    if (!interview) return;
    const email = interview.candidateEmail ?? interview.recipientEmail;
    if (!email) {
      setAssessmentLinkError('Add an email before sending an assessment invite.');
      return;
    }
    setAssessmentLinkError(null);
    setAssessmentLinkNotice(null);
    setIsSendingInvite(true);
    try {
      const result = await api.post<InviteResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/invite`,
        { email },
      );
      if (result.room) {
        setRoomLinks(result.room);
      }
      setAssessmentLinkNotice(result.emailSent
        ? `Assessment invite sent${result.provider ? ` via ${result.provider}` : ''}.`
        : result.emailError
          ? 'Fresh assessment link is ready, but email delivery failed. Copy it manually.'
          : 'Fresh assessment link is ready. Email delivery is not configured locally.');
      await load({ showLoading: false });
    } catch (err) {
      setAssessmentLinkError(err instanceof Error ? err.message : 'Unable to send assessment invite');
    } finally {
      setIsSendingInvite(false);
    }
  }, [api, interview, load]);

  const sendInvite = useCallback(async () => {
    if (!interview) return;
    const email = interview.candidateEmail ?? interview.recipientEmail;
    if (!email) {
      setRoomError('Add an email before sending an invite.');
      return;
    }
    setRoomError(null);
    setRoomNotice(null);
    setIsSendingInvite(true);
    try {
      const invitePayload = evidenceFollowUpPlan
        ? { email, message: evidenceFollowUpInviteMessage(evidenceFollowUpPlan) }
        : { email };
      const result = await api.post<InviteResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/invite`,
        invitePayload,
      );
      if (result.room) {
        setRoomLinks(result.room);
      } else if (result.meetingUrl) {
        setRoomLinks((current) => current
          ? { ...current, guestUrl: result.meetingUrl }
          : current);
      }
      setRoomNotice(result.emailSent
        ? `Invite sent${result.provider ? ` via ${result.provider}` : ''}.`
        : result.emailError
          ? 'Guest link is ready, but email delivery failed. Copy the link manually.'
          : 'Guest link is ready. Email delivery is not configured locally.');
      await load({ showLoading: false });
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to send invite');
    } finally {
      setIsSendingInvite(false);
    }
  }, [api, evidenceFollowUpPlan, interview, load]);

  const createContextCall = useCallback(async () => {
    if (!interview) return;
    setContextCallError(null);
    setIsCreatingContextCall(true);
    try {
      const result = await api.post<ContextCallResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/context-call`,
        {},
      );
      navigate(`/interviews/${result.contextCall.id}`);
    } catch (err) {
      setContextCallError(err instanceof Error ? err.message : 'Unable to create context call');
    } finally {
      setIsCreatingContextCall(false);
    }
  }, [api, interview, navigate]);

  const refreshCodeReviewMatch = useCallback(async () => {
    if (!interview) return;
    setMatchRefreshError(null);
    setMatchRefreshNotice(null);
    setIsRefreshingMatch(true);
    try {
      const result = await api.post<CodeReviewMatchRefreshResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/code-review-match/refresh`,
        {},
      );
      setInterview((current) => current
        ? {
            ...current,
            matchedRepoId: result.repoId ?? current.matchedRepoId ?? null,
            githubRepoUrl: result.repoUrl ?? current.githubRepoUrl ?? null,
            githubPrNumber: result.prNumber ?? current.githubPrNumber ?? null,
            codeReviewMatch: result.codeReviewMatch ?? current.codeReviewMatch ?? null,
          }
        : current);
      if (result.refreshed) {
        setMatchRefreshNotice(codeReviewRefreshSuccessNotice(result));
      } else {
        setMatchRefreshError(`Refresh ran, but matcher returned ${titleCaseToken(result.status)}.`);
      }
    } catch (err) {
      setMatchRefreshError(err instanceof Error ? err.message : 'Unable to refresh repo matching');
    } finally {
      setIsRefreshingMatch(false);
    }
  }, [api, interview]);

  const startAssessmentEvaluation = useCallback(async () => {
    if (!interview) return;
    setAssessmentEvaluationError(null);
    setAssessmentEvaluationNotice(null);
    setIsStartingAssessmentEvaluation(true);
    try {
      const result = await api.post<StartAssessmentEvaluationResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/assessment/start-evaluation`,
        {},
      );
      setInterview((current) => current
        ? { ...current, assessmentProgress: result.progress }
        : current);
      setAssessmentEvaluationNotice(assessmentEvaluationNoticeForResult(result));
    } catch (err) {
      setAssessmentEvaluationError(err instanceof Error ? err.message : 'Unable to start assessment evaluation');
    } finally {
      setIsStartingAssessmentEvaluation(false);
    }
  }, [api, interview]);

  const recordHumanAssessmentDecision = useCallback(async () => {
    if (!interview) return;
    const summary = humanDecisionSummary.trim();
    const notes = humanDecisionNotes.trim();
    setHumanDecisionError(null);
    setHumanDecisionNotice(null);
    if (!summary) {
      setHumanDecisionError('Add a decision summary before recording the human assessment decision.');
      return;
    }
    setIsRecordingHumanDecision(true);
    try {
      const result = await api.post<RecordHumanAssessmentDecisionResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/assessment/human-decision`,
        {
          decision: humanDecisionValue,
          summary,
          notes: notes.length > 0 ? notes : null,
        },
      );
      setInterview((current) => current
        ? { ...current, assessmentProgress: result.progress }
        : current);
      setHumanDecisionSummary('');
      setHumanDecisionNotes('');
      setHumanDecisionNotice('Human decision recorded against the latest source-backed evaluation report.');
    } catch (err) {
      setHumanDecisionError(err instanceof Error ? err.message : 'Unable to record human assessment decision');
    } finally {
      setIsRecordingHumanDecision(false);
    }
  }, [api, humanDecisionNotes, humanDecisionSummary, humanDecisionValue, interview]);

  const saveWorkspaceConfig = useCallback(async () => {
    if (!interview) return;
    const repoUrl = workspaceRepoUrl.trim();
    const prNumber = workspacePrNumber.trim().length > 0
      ? Number.parseInt(workspacePrNumber.trim(), 10)
      : null;
    if (!repoUrl) {
      setRoomNotice(null);
      setRoomError('Add a GitHub repository URL before launching a live workspace.');
      return;
    }
    if (prNumber !== null && (!Number.isFinite(prNumber) || prNumber <= 0)) {
      setRoomNotice(null);
      setRoomError('PR number must be a positive number.');
      return;
    }
    setIsSavingWorkspace(true);
    setRoomError(null);
    setRoomNotice(null);
    try {
      await api.patch(`/api/v1/scheduling/interviews/${interview.id}`, {
        githubRepoUrl: repoUrl,
        githubPrNumber: prNumber,
      });
      setRoomNotice('Workspace repository saved.');
      await load({ showLoading: false });
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to save workspace repository');
    } finally {
      setIsSavingWorkspace(false);
    }
  }, [api, interview, load, workspacePrNumber, workspaceRepoUrl]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void load({ showLoading: false });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [load]);

  useEffect(() => {
    const rawStatus = interview?.linkedMeeting?.transcriptStatus ?? interview?.transcriptArtifact?.status ?? null;
    const shouldPoll = rawStatus === 'PROCESSING' || isLiveRecordingMeeting(interview?.linkedMeeting ?? null);
    if (!shouldPoll) return undefined;
    const timer = window.setInterval(() => {
      void load({ showLoading: false });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [
    interview?.linkedMeeting?.transcriptStatus,
    interview?.linkedMeeting?.status,
    interview?.linkedMeeting?.startedAt,
    interview?.linkedMeeting?.endedAt,
    interview?.linkedMeeting?.recordingR2Key,
    interview?.transcriptArtifact?.status,
    load,
  ]);

  if (isLoading) {
    return (
      <div style={CENTERED}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--pipe-text-dim)' }} />
      </div>
    );
  }

  if (error || !interview) {
    return (
      <div style={CENTERED}>
        <AlertCircle size={24} color="#f87171" />
        <div style={{ color: '#f87171', fontFamily: FONT, fontSize: 13 }}>
          {error ?? 'Interview not found'}
        </div>
        <button onClick={() => navigate('/interviews')} style={TEXT_BUTTON}>
          Back to interviews
        </button>
      </div>
    );
  }

  const personName =
    interview.candidateName
    ?? interview.recipientName
    ?? interview.candidateEmail
    ?? interview.recipientEmail
    ?? 'Unknown person';
  const personEmail = interview.candidateEmail ?? interview.recipientEmail ?? null;
  const roleTitle = interview.pipelineTitle ?? 'Talent Pool';
  const stageTitle = interview.stageTitle ?? interview.interviewType ?? 'Interview';
  const rawTranscriptStatus =
    interview.linkedMeeting?.transcriptStatus
    ?? interview.transcriptArtifact?.status
    ?? 'NONE';
  const isLiveRecording = isLiveRecordingMeeting(interview.linkedMeeting);
  const isStaleRecording = rawTranscriptStatus === 'RECORDING' && !isLiveRecording;
  const transcriptStatus = isStaleRecording ? 'NONE' : rawTranscriptStatus;
  const transcriptError = interview.linkedMeeting?.transcriptError ?? interview.transcriptArtifact?.errorMessage ?? null;
  const transcriptContextText = personContextModeText(personContextMode, personContextReason);
  const guestRoomUrl = roomLinks?.guestUrl ?? interview.linkedMeeting?.meetingUrl ?? null;
  const providerName = interview.linkedMeeting?.schedulingProvider ?? interview.schedulingProvider ?? null;
  const providerEventId = interview.linkedMeeting?.externalEventId ?? interview.externalEventId ?? null;
  const providerEventDisplay = providerEventLabel(providerEventId);
  const hasInviteDelivery = Boolean(interview.inviteLinkSentAt ?? interview.emailSentAt);
  const displayStatus = interview.status === 'INVITED' && !hasInviteDelivery
    ? 'READY'
    : interview.status;
  const contextSummary = interview.livingContext?.summary ?? null;
  const personProfilePath = interview.livingContext?.person?.personId
    ? `/people/${interview.livingContext.person.personId}`
    : interview.contactId
      ? `/people/${interview.contactId}`
      : interview.candidateId
        ? `/candidates/${interview.candidateId}`
        : null;
  const relatedEvidenceTotal = interview.relatedEvidenceInterviews?.length ?? 0;
  const relatedEvidenceInterviews = interview.relatedEvidenceInterviews?.slice(0, 4) ?? [];
  const relatedEvidenceHiddenCount = Math.max(relatedEvidenceTotal - relatedEvidenceInterviews.length, 0);
  const relatedEvidenceDecision = summarizeRelatedEvidenceInterviews(
    relatedEvidenceInterviews,
    relatedEvidenceTotal,
  );
  const hasLivingContextEvidence = Boolean(
    contextSummary && (
      contextSummary.interactionCount > 0
      || contextSummary.artifactCount > 0
      || contextSummary.contextRecordCount > 0
      || contextSummary.sourceSpanCount > 0
      || contextSummary.assertionCount > 0
      || contextSummary.signalCount > 0
    ),
  );
  const codeReviewMatch = interview.codeReviewMatch ?? null;
  const isCodeReviewInterview = interview.interviewType === 'CODE_REVIEW';
  const hasConcreteReviewAssignment = Boolean(interview.githubRepoUrl && interview.githubPrNumber);
  const hasReviewSetupGap = Boolean(
    isCodeReviewInterview
      && !hasConcreteReviewAssignment
      && (interview.githubRepoUrl || interview.githubPrNumber || interview.matchedRepoId),
  );
  const showsReviewAssignmentPanel = hasConcreteReviewAssignment || hasReviewSetupGap;
  const primaryMatchEvidence = codeReviewMatch?.evidence[0] ?? null;
  const primaryMatchHasRoleContext = Boolean(
    primaryMatchEvidence && (
      primaryMatchEvidence.roleSourceRefs.length > 0
      || (codeReviewMatch?.roleSources.length ?? 0) > 0
      || (codeReviewMatch?.validatorAgent?.sourceBridge?.roleSourceCount ?? 0) > 0
    ),
  );
  const matchHyperedges = codeReviewMatch?.evidenceHyperedges ?? [];
  const codeReviewProfile = asCodeReviewReviewProfile(codeReviewMatch?.reviewProfile);
  const assessmentMetrics = codeReviewMatch?.assessmentQuality?.metrics ?? [];
  const recruiterAssessmentMetrics = assessmentMetrics
    .filter((metric) => [
      'skill_stack_overlap',
      'pr_reviewability',
      'match_specificity',
    ].includes(metric.id))
    .slice(0, 3);
  const matchPathLabel = primaryMatchHasRoleContext
    ? 'role context -> person evidence -> repo challenge'
    : 'candidate evidence -> repo challenge';
  const usesWorkspaceInterview = interview.interviewType === 'DEV_CONTAINER_CHALLENGE'
    || interview.interviewType === 'OPEN_SOURCE_BUG_FIX';
  const assessmentProgress = interview.assessmentProgress ?? null;
  const assessmentInviteUrl = interview.assessmentSetup?.lastDeliveredUrl ?? null;
  const assessmentInviteState = interview.assessmentSetup?.lastDeliveredUrlState
    ?? (assessmentInviteUrl ? 'active' : null);
  const hasAssessmentInviteUrl = Boolean(assessmentInviteUrl);
  const hasSubmittedAssessmentEvidence = Boolean(
    interview.completedAt
    || interview.submissionJson
    || assessmentProgress?.hasFinalSubmission
    || assessmentProgress?.evaluation,
  );
  const canCopyAssessmentInvite = Boolean(assessmentInviteUrl && assessmentInviteState === 'active');
  const assessmentInviteStatus = assessmentInviteStatusLabel(assessmentInviteState, hasAssessmentInviteUrl);
  const assessmentInviteValidity = assessmentInviteValidityLabel(assessmentInviteState, hasAssessmentInviteUrl);
  const assessmentInviteEvidenceState = assessmentInviteEvidenceLabel(assessmentInviteState, {
    hasUrl: hasAssessmentInviteUrl,
    hasSubmittedEvidence: hasSubmittedAssessmentEvidence,
  });
  const assessmentInviteRecipient = personEmail
    ? `${personName} · ${personEmail}`
    : personName;
  const assessmentInviteNextAction = assessmentInviteNextActionLabel(assessmentInviteState, {
    hasUrl: hasAssessmentInviteUrl,
    hasEmail: Boolean(personEmail),
  });
  const showsAssessmentInvitePanel = Boolean(
    interview.assessmentSetup
      && interview.assessmentSetup.status !== 'not_applicable'
      && (isCodeReviewInterview || assessmentInviteUrl),
  );
  const assessmentInviteDescription =
    assessmentInviteState === 'claimed'
      ? hasSubmittedAssessmentEvidence
        ? 'The candidate started this one-use assessment link and assessment evidence is attached below. Resend only if they need a fresh attempt.'
        : 'The candidate started this one-use assessment link, but this interview has no submitted assessment evidence yet. Resend the invite to issue a fresh link.'
      : assessmentInviteState === 'stale'
        ? 'This saved assessment link is older than the current candidate token. Resend the invite before sharing it.'
        : assessmentInviteUrl
          ? 'One-use candidate invite. Copy it for the candidate instead of opening it in a recruiter browser.'
          : 'No candidate assessment link has been delivered yet. Send the invite to create a usable one-use link.';
  const assessmentInviteMessage = assessmentInviteState === 'claimed'
    ? assessmentInviteDescription
    : interview.assessmentSetup?.lastDeliveredUrlMessage ?? assessmentInviteDescription;
  const assessmentAssignment = summarizeAssessmentAssignment(interview.assessmentSetup);
  const showsAssessmentProgress = usesWorkspaceInterview || Boolean(assessmentProgress) || Boolean(assessmentAssignment);
  const assessmentProgressStage = assessmentProgress
    ? assessmentProgressStageLabel(assessmentProgress.stage)
    : 'Not started';
  const assessmentProgressNextAction = assessmentProgress?.nextActionLabel
    ?? interview.assessmentSetup?.message
    ?? 'Open or configure the assessment room to start collecting evidence.';
  const assessmentProgressEvidence = assessmentProgress
    ? assessmentEvidenceSummary(assessmentProgress)
    : 'No assessment session';
  const assessmentChallengeText = assessmentProgress
    ? assessmentChallengeSummary(assessmentProgress.challenge)
    : null;
  const assessmentChallengeContract = assessmentProgress
    ? parseAssessmentChallengeContract(assessmentProgress.challenge)
    : null;
  const assessmentWorkspaceSummary = workspaceSessionSummary(interview);
  const assessmentProgressSourceRefCounts = assessmentProgress?.sourceRefCounts ?? [];
  const assessmentEvidenceSnippets = assessmentProgress?.evidenceSnippets?.slice(0, 6) ?? [];
  const assessmentRequiredProof = assessmentRequiredProofItems(assessmentProgress);
  const assessmentConfidenceSignals = assessmentConfidenceSignalItems(assessmentProgress);
  const assessmentEvaluationClaims = assessmentProgress?.evaluation?.claims?.slice(0, 3) ?? [];
  const assessmentEvaluationDiagnostics = assessmentProgress?.evaluation?.diagnostics?.slice(0, 3) ?? [];
  const canStartAssessmentEvaluation = assessmentProgress?.nextAction === 'START_EVALUATION';
  const canRecordHumanAssessmentDecision = Boolean(assessmentProgress?.evaluation && !assessmentProgress.humanDecision);
  const assessmentWorkPacket = workspaceAssessmentWorkPacket(assessmentProgress);
  const workspaceAssessmentReadout = workspaceAssessmentHiringReadout({
    progress: assessmentProgress,
    setup: interview.assessmentSetup,
    challengeText: assessmentChallengeText,
  });
  const showsRoomPanel = !isCodeReviewInterview;
  const hasCallRecordEvidence = Boolean(
    interview.transcriptArtifact
    || transcriptEntries.length > 0
    || interview.linkedMeeting?.transcriptSummary
    || interview.linkedMeeting?.recordingR2Key
    || transcriptError
    || transcriptStatus === 'PROCESSING'
    || transcriptStatus === 'READY'
    || transcriptStatus === 'COMPLETED'
    || transcriptStatus === 'FAILED'
    || isLiveRecording,
  );
  const showsCallRecord = !isCodeReviewInterview || hasCallRecordEvidence;
  const transcriptEmptyText = transcriptStatus === 'PROCESSING'
    ? 'Transcription is processing. Context will update when source-backed transcript spans are ready.'
    : isStaleRecording
      ? 'The call ended or disconnected before a recording was saved. Start a fresh room to collect transcript evidence.'
    : transcriptStatus === 'FAILED'
      ? 'Transcript failed. The original recording/error stays attached for review.'
      : guestRoomUrl
        ? 'Transcript will appear here after the host and guest complete a recorded call.'
        : 'Send an invite or open the host room to start collecting call evidence.';
  const codeReviewOutcome = codeReviewVerdictLabel(codeReviewSubmission?.verdict, codeReviewMatch);
  const codeReviewAction = codeReviewActionText(codeReviewSubmission, codeReviewMatch);
  const codeReviewScore = interview.codeReviewScore ?? null;
  const codeReviewScoreValue = codeReviewScoreHeadline(codeReviewScore);
  const codeReviewScoreDetail = codeReviewScoreNarrative(codeReviewScore);
  const codeReviewNextStep = codeReviewNextStepRecommendation(
    codeReviewScore,
    codeReviewSubmission,
    codeReviewMatch,
  );
  const codeReviewDecisionRisk = codeReviewDecisionRiskSummary(
    codeReviewScore,
    codeReviewSubmission,
    codeReviewMatch,
  );
  const codeReviewEvidencePlan = codeReviewEvidencePlanItems(codeReviewMatch, codeReviewSubmission);
  const codeReviewEvidenceRefresh = codeReviewMatch?.evidenceRefresh ?? null;
  const codeReviewEvidenceFollowUp = codeReviewMatch?.evidenceFollowUp ?? null;
  const codeReviewEvidenceFollowUpBlocked = codeReviewEvidenceFollowUp?.state === 'BLOCKED';
  const codeReviewEvidenceRefreshMatcherContextCount = codeReviewEvidenceRefresh?.matcherContextCount ?? 0;
  const codeReviewEvidenceRefreshMatcherReady = !codeReviewEvidenceRefresh
    || codeReviewEvidenceRefreshMatcherContextCount > 0;
  const codeReviewEvidenceRefreshConsumed = Boolean(codeReviewEvidenceRefresh?.consumedByMatchRunId);
  const codeReviewEvidenceRefreshUsed = Boolean(
    codeReviewEvidenceRefresh
      && (codeReviewEvidenceRefresh.consumedByMatchStatus === 'MATCHED'
        || (!codeReviewEvidenceRefreshConsumed && codeReviewMatch?.status === 'MATCHED')),
  );
  const codeReviewEvidenceRefreshStillMissing = Boolean(
    codeReviewEvidenceRefresh
      && !codeReviewEvidenceRefreshUsed
      && (codeReviewEvidenceRefreshConsumed
        || (codeReviewMatch?.status
          && codeReviewMatch.status !== 'MATCHED'
          && codeReviewMatch.matchRunId
          && codeReviewEvidenceRefresh.matchRunId
          && codeReviewMatch.matchRunId !== codeReviewEvidenceRefresh.matchRunId)),
  );
  const shouldShowEvidencePlan = codeReviewEvidencePlan.length > 0
    && !codeReviewEvidenceRefresh
    && !codeReviewEvidenceFollowUp;
  const codeReviewSignalBasis = codeReviewSignalBasisItems({
    score: codeReviewScore,
    submission: codeReviewSubmission,
    match: codeReviewMatch,
    proofCount: matchHyperedges.length,
  });
  const codeReviewAssessmentValidity = codeReviewAssessmentValiditySummary({
    score: codeReviewScore,
    submission: codeReviewSubmission,
    match: codeReviewMatch,
    proofCount: matchHyperedges.length,
  });
  const codeReviewAssignmentTrust = codeReviewAssignmentTrustSummary({
    setup: interview.assessmentSetup,
    match: codeReviewMatch,
  });
  const codeReviewExplanation = codeReviewMatchExplanation({
    repoUrl: interview.githubRepoUrl,
    prNumber: interview.githubPrNumber,
    match: codeReviewMatch,
    score: codeReviewScore,
    submission: codeReviewSubmission,
    assignmentTrust: codeReviewAssignmentTrust,
    validity: codeReviewAssessmentValidity,
    risk: codeReviewDecisionRisk,
    matchPathLabel,
  });
  const codeReviewDecisionSignals = [
    {
      label: 'Assignment',
      value: codeReviewFitLabel(codeReviewMatch),
      detail: codeReviewFitDetail(codeReviewMatch),
    },
    {
      label: codeReviewScore ? 'Candidate signal' : 'Candidate review',
      value: codeReviewScoreValue ?? countLabel(codeReviewSubmission?.annotations.length ?? 0, 'annotation'),
      detail: codeReviewScoreDetail ?? codeReviewSubmission?.summary ?? 'no submitted review yet',
    },
    {
      label: 'Pushback',
      value: countLabel(codeReviewSubmission?.defenseThreads.length ?? 0, 'pushback thread'),
      detail: (codeReviewSubmission?.defenseThreads.length ?? 0) > 0
        ? 'developer replies are available for judgment calibration'
        : 'no developer pushback captured yet',
    },
    {
      label: 'Proof',
      value: countLabel(matchHyperedges.length, 'evidence bridge'),
      detail: codeReviewMatch?.summary ?? 'source trail appears after a match is selected',
    },
  ];
  const codeReviewHiringReadout = [
    {
      label: 'Decision',
      value: codeReviewOutcome,
      detail: codeReviewAction,
      tone: 'neutral' as CodeReviewNextStepTone,
    },
    {
      label: 'Assignment',
      value: codeReviewAssignmentTrust.value,
      detail: codeReviewAssignmentTrust.detail,
      tone: codeReviewAssignmentTrust.tone,
    },
    {
      label: 'Score validity',
      value: codeReviewAssessmentValidity.value,
      detail: codeReviewAssessmentValidity.detail,
      tone: codeReviewAssessmentValidity.tone,
    },
    {
      label: 'Risk',
      value: codeReviewDecisionRisk.uncertainty.value,
      detail: codeReviewDecisionRisk.uncertainty.detail,
      tone: codeReviewNextStep.tone,
    },
    {
      label: 'Next action',
      value: codeReviewNextStep.value,
      detail: codeReviewNextStep.detail,
      tone: codeReviewNextStep.tone,
    },
  ];
  const openPersonProfile = (): void => {
    if (!personProfilePath) return;
    const state = interview.livingContext || interview.candidateId
      ? {
          livingContext: interview.livingContext ?? undefined,
          candidateId: interview.candidateId ?? undefined,
          selectedAssessment: assessmentProgress ?? undefined,
        }
      : undefined;
    navigate(personProfilePath, {
      state,
    });
  };

  return (
    <div style={PAGE}>
      <header style={HEADER}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <button onClick={() => navigate('/interviews')} style={BACK_BUTTON}>
            <ArrowLeft size={13} />
            INTERVIEWS
          </button>
          <div>
            <div style={EYEBROW}>INTERVIEW</div>
            <h1 style={TITLE}>{personName}</h1>
            <div style={SUBTITLE}>
              {roleTitle} · {stageTitle}
            </div>
          </div>
          <StatusBadge status={displayStatus} />
        </div>

        <div style={ACTION_ROW}>
          {personProfilePath && (
            <button
              type="button"
              data-testid="interview-open-person-profile"
              onClick={openPersonProfile}
              style={PRIMARY_BUTTON}
            >
              <User size={14} />
              PERSON
            </button>
          )}
        </div>
      </header>

      {showsRoomPanel && (
        <section style={ROOM_PANEL}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 10 }}>
              <Video size={15} />
              Room
            </div>
            <h2 style={ROOM_TITLE}>{interview.linkedMeeting?.title ?? `${personName} interview`}</h2>
            <div style={ROOM_LINK_TEXT}>
              {guestRoomUrl
                ? 'Guest and host join the same meeting with different secure links.'
                : 'Send an invite or open the host room to create the guest link.'}
            </div>
            {roomLinks?.expiresAt && (
              <div style={{ ...ROOM_LINK_TEXT, marginTop: 8 }}>
                Links expire {formatDate(roomLinks.expiresAt, 'after token expiry')}
              </div>
            )}
          </div>
          <div style={ROOM_ACTIONS}>
            {personEmail && (
              <button
                onClick={() => void sendInvite()}
                disabled={isSendingInvite}
                style={{ ...PRIMARY_BUTTON, ...ROOM_PRIMARY_BUTTON }}
              >
                {isSendingInvite ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
                {hasInviteDelivery ? 'RESEND INVITE' : 'SEND INVITE'}
              </button>
            )}
            <button
              onClick={() => void copyGuestLink()}
              disabled={isPreparingRoom}
              style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
            >
              <Copy size={14} />
              COPY GUEST LINK
            </button>
            <button
              onClick={() => void openHostRoom()}
              disabled={isPreparingRoom}
              style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
            >
              {isPreparingRoom ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Video size={14} />}
              OPEN HOST ROOM
            </button>
            {guestRoomUrl && (
              <label style={ROOM_GUEST_LINK_LABEL}>
                <span style={ROOM_GUEST_LINK_TEXT}>GUEST LINK</span>
                <input
                  ref={guestLinkInputRef}
                  readOnly
                  value={guestRoomUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  style={ROOM_GUEST_LINK_INPUT}
                />
              </label>
            )}
            {roomNotice && <div style={SUCCESS_NOTE}>{roomNotice}</div>}
            {roomError && <div style={ERROR_NOTE}>{roomError}</div>}
          </div>
        </section>
      )}

      {showsAssessmentInvitePanel && (
        <section data-testid="interview-assessment-link" style={ROOM_PANEL}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 10 }}>
              <Mail size={15} />
              Assessment invite
            </div>
            <h2 style={ROOM_TITLE}>Candidate assessment link</h2>
            <div style={ROOM_LINK_TEXT}>
              {assessmentInviteMessage}
            </div>
            <div data-testid="interview-assessment-link-state" style={ASSESSMENT_INVITE_STATE_GRID}>
              <div style={ASSESSMENT_INVITE_STATE_ITEM}>
                <span style={ROOM_GUEST_LINK_TEXT}>STATUS</span>
                <span style={ASSESSMENT_INVITE_STATE_VALUE}>{assessmentInviteStatus}</span>
              </div>
              <div style={ASSESSMENT_INVITE_STATE_ITEM}>
                <span style={ROOM_GUEST_LINK_TEXT}>VALIDITY</span>
                <span style={ASSESSMENT_INVITE_STATE_VALUE}>{assessmentInviteValidity}</span>
              </div>
              <div style={ASSESSMENT_INVITE_STATE_ITEM}>
                <span style={ROOM_GUEST_LINK_TEXT}>ASSESSMENT</span>
                <span style={ASSESSMENT_INVITE_STATE_VALUE}>{assessmentInviteEvidenceState}</span>
              </div>
              <div style={ASSESSMENT_INVITE_STATE_ITEM}>
                <span style={ROOM_GUEST_LINK_TEXT}>RECIPIENT</span>
                <span style={ASSESSMENT_INVITE_STATE_VALUE}>{assessmentInviteRecipient}</span>
              </div>
              <div style={ASSESSMENT_INVITE_STATE_ITEM}>
                <span style={ROOM_GUEST_LINK_TEXT}>NEXT ACTION</span>
                <span style={ASSESSMENT_INVITE_STATE_VALUE}>{assessmentInviteNextAction}</span>
              </div>
            </div>
          </div>
          <div style={ROOM_ACTIONS}>
            {canCopyAssessmentInvite && (
              <button
                type="button"
                onClick={() => void copyAssessmentInviteLink()}
                style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
              >
                <Copy size={14} />
                COPY CANDIDATE LINK
              </button>
            )}
            {personEmail && (
              <button
                type="button"
                onClick={() => void resendAssessmentInvite()}
                disabled={isSendingInvite}
                style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
              >
                {isSendingInvite ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
                {assessmentInviteUrl ? 'RESEND ASSESSMENT INVITE' : 'SEND ASSESSMENT INVITE'}
              </button>
            )}
            {assessmentInviteUrl && (
              <label style={ROOM_GUEST_LINK_LABEL}>
                <span style={ROOM_GUEST_LINK_TEXT}>
                  {canCopyAssessmentInvite ? 'CANDIDATE ASSESSMENT URL' : 'LAST CANDIDATE ASSESSMENT URL'}
                </span>
                <input
                  ref={assessmentLinkInputRef}
                  readOnly
                  value={assessmentInviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  style={ROOM_GUEST_LINK_INPUT}
                />
              </label>
            )}
            {assessmentLinkNotice && <div style={SUCCESS_NOTE}>{assessmentLinkNotice}</div>}
            {assessmentLinkError && <div style={ERROR_NOTE}>{assessmentLinkError}</div>}
          </div>
        </section>
      )}

      {evidenceFollowUpPlan && (
        <section data-testid="interview-evidence-follow-up-plan" style={FOLLOW_UP_PLAN_SECTION}>
          <div style={SECTION_TITLE}>
            <CalendarCheck size={15} />
            Follow-up assessment plan
          </div>
          <div style={FOLLOW_UP_PLAN_GRID}>
            <div style={FOLLOW_UP_PLAN_PRIMARY}>
              <div style={FIELD_LABEL}>Ask this first</div>
              <div style={DECISION_PLAN_SIGNAL}>{evidenceFollowUpPlan.questions[0]}</div>
              <div style={CONTEXT_RECORD_NARRATIVE}>
                Candidate answer becomes source-backed context for repo matching.
              </div>
              <div style={CONTEXT_RECORD_NARRATIVE}>
                The invite includes this question so the call has a concrete purpose.
              </div>
            </div>
            <div style={FOLLOW_UP_PLAN_META}>
              {evidenceFollowUpPlan.originalInterviewId && (
                <div style={MATCH_BRIDGE_CARD}>
                  <div style={FIELD_LABEL}>Original code-review interview</div>
                  <div style={TRANSCRIPT_TEXT}>{evidenceFollowUpPlan.originalInterviewId}</div>
                </div>
              )}
              {evidenceFollowUpPlan.matchStatus && (
                <div style={MATCH_BRIDGE_CARD}>
                  <div style={FIELD_LABEL}>Match status</div>
                  <div style={TRANSCRIPT_TEXT}>{titleCaseToken(evidenceFollowUpPlan.matchStatus)}</div>
                </div>
              )}
              {evidenceFollowUpPlan.gaps.length > 0 && (
                <div style={MATCH_BRIDGE_CARD}>
                  <div style={FIELD_LABEL}>Missing evidence</div>
                  <div style={TAG_ROW}>
                    {evidenceFollowUpPlan.gaps.slice(0, 3).map((gap) => (
                      <span key={gap} style={TAG}>{titleCaseToken(gap)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {evidenceFollowUpPlan.questions.length > 1 && (
            <div style={FOLLOW_UP_QUESTION_LIST}>
              <div style={FIELD_LABEL}>Useful follow-ups</div>
              {evidenceFollowUpPlan.questions.slice(1, 3).map((question) => (
                <div key={question} style={CONTEXT_RECORD_NARRATIVE}>{question}</div>
              ))}
            </div>
          )}
        </section>
      )}

      {usesWorkspaceInterview && (
        <section
          data-testid="interview-workspace-assessment-decision-summary"
          style={WORKSPACE_ASSESSMENT_DECISION_SECTION}
        >
          <div style={DECISION_HEADER}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...SECTION_TITLE, marginBottom: 8 }}>
                <CheckCircle size={15} />
                Assessment decision
              </div>
              <div style={ROOM_LINK_TEXT}>
                A hiring-manager readout from the source-backed task, commit, diff, tests, and evaluator report.
              </div>
            </div>
            <span style={MATCH_BADGE}>{assessmentProgressStage}</span>
          </div>
          <div style={DECISION_COCKPIT}>
            <div style={FIELD_LABEL}>Hiring manager readout</div>
            <div style={DECISION_COCKPIT_GRID}>
              {workspaceAssessmentReadout.map((item) => (
                <div
                  key={item.label}
                  style={{
                    ...DECISION_COCKPIT_ITEM,
                    ...DECISION_NEXT_STEP_TONE[item.tone],
                  }}
                >
                  <div style={FIELD_LABEL}>{item.label}</div>
                  <div style={DECISION_COCKPIT_VALUE}>{item.value}</div>
                  <div style={DECISION_COCKPIT_DETAIL}>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {showsAssessmentProgress && (
        <section data-testid="interview-assessment-progress" style={ASSESSMENT_PROGRESS_PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...SECTION_TITLE, marginBottom: 8 }}>
                <CheckCircle size={15} />
                Assessment progress
              </div>
              <div style={ROOM_LINK_TEXT}>
                {interview.assessmentSetup?.message ?? 'Source-backed assessment evidence is tracked against this interview.'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span style={MATCH_BADGE}>{assessmentProgressStage}</span>
              {canStartAssessmentEvaluation && (
                <button
                  type="button"
                  onClick={() => void startAssessmentEvaluation()}
                  disabled={isStartingAssessmentEvaluation}
                  style={PRIMARY_BUTTON}
                >
                  {isStartingAssessmentEvaluation
                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    : <CheckCircle size={14} />}
                  START EVALUATION
                </button>
              )}
            </div>
          </div>
          <div style={ASSESSMENT_PROGRESS_GRID}>
            <div style={ASSESSMENT_PROGRESS_CARD}>
              <div style={FIELD_LABEL}>Mode</div>
              <div style={MATCH_DECISION_VALUE}>{sentenceCaseToken(interview.interviewType ?? 'VIDEO')}</div>
            </div>
            <div style={ASSESSMENT_PROGRESS_CARD}>
              <div style={FIELD_LABEL}>Next action</div>
              <div style={ASSESSMENT_PROGRESS_VALUE}>{assessmentProgressNextAction}</div>
            </div>
            <div style={ASSESSMENT_PROGRESS_CARD}>
              <div style={FIELD_LABEL}>Evidence</div>
              <div style={ASSESSMENT_PROGRESS_VALUE}>{assessmentProgressEvidence}</div>
            </div>
            <div style={ASSESSMENT_PROGRESS_CARD}>
              <div style={FIELD_LABEL}>Workspace</div>
              <div style={ASSESSMENT_PROGRESS_VALUE}>{assessmentWorkspaceSummary ?? 'Not launched'}</div>
            </div>
            <div style={ASSESSMENT_PROGRESS_CARD}>
              <div style={FIELD_LABEL}>Commit</div>
              {assessmentProgress?.commit?.commitUrl ? (
                <a href={assessmentProgress.commit.commitUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                  {shortCommitSha(assessmentProgress.commit.commitSha)}
                </a>
              ) : (
                <div style={ASSESSMENT_PROGRESS_VALUE}>{shortCommitSha(assessmentProgress?.commit?.commitSha)}</div>
              )}
            </div>
          </div>
          {assessmentAssignment && (
            <div
              data-testid="interview-assessment-assignment"
              style={ASSESSMENT_PROGRESS_DETAIL}
            >
              <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                <span style={FIELD_LABEL}>Assignment</span>
                <span style={{ ...FIELD_VALUE, lineHeight: 1.5 }}>
                  <strong style={{ display: 'block', marginBottom: 4, ...assessmentAssignmentToneStyle(assessmentAssignment.tone) }}>
                    {assessmentAssignment.label}
                  </strong>
                  {assessmentAssignment.detail}
                </span>
              </div>
            </div>
          )}
          {assessmentProgress ? (
            <div style={ASSESSMENT_PROGRESS_DETAIL}>
              {assessmentWorkPacket.length > 0 && (
                <div data-testid="interview-assessment-work-packet" style={DECISION_COCKPIT}>
                  <div style={FIELD_LABEL}>Candidate work packet</div>
                  <div style={DECISION_COCKPIT_GRID}>
                    {assessmentWorkPacket.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          ...DECISION_COCKPIT_ITEM,
                          ...DECISION_NEXT_STEP_TONE[item.tone],
                        }}
                      >
                        <div style={FIELD_LABEL}>{item.label}</div>
                        <div style={DECISION_COCKPIT_VALUE}>{item.value}</div>
                        <div style={DECISION_COCKPIT_DETAIL}>{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {assessmentProgress.challenge && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Challenge</span>
                  <span style={FIELD_VALUE}>
                    {assessmentChallengeText ?? 'Challenge packet captured'}
                  </span>
                </div>
              )}
              {assessmentChallengeContract && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Task contract</span>
                  <div
                    data-testid="interview-assessment-challenge-contract"
                    style={ASSESSMENT_CHALLENGE_CONTRACT}
                  >
                    {(assessmentChallengeContract.repositoryUrl || assessmentChallengeContract.baseCommitSha) && (
                      <div style={ASSESSMENT_CHALLENGE_META}>
                        {assessmentChallengeContract.repositoryUrl && (
                          <span>
                            Repo{' '}
                            <strong>
                              {repoLabelFromUrl(assessmentChallengeContract.repositoryUrl)
                                ?? assessmentChallengeContract.repositoryUrl}
                            </strong>
                          </span>
                        )}
                        {assessmentChallengeContract.baseCommitSha && (
                          <span>
                            Base <strong>{shortCommitSha(assessmentChallengeContract.baseCommitSha)}</strong>
                          </span>
                        )}
                      </div>
                    )}
                    {assessmentChallengeContract.task && (
                      <div style={ASSESSMENT_CHALLENGE_SECTION}>
                        <span style={FIELD_LABEL}>Task</span>
                        <p style={ASSESSMENT_CHALLENGE_TEXT}>{assessmentChallengeContract.task}</p>
                      </div>
                    )}
                    {assessmentChallengeContract.successCriteria.length > 0 && (
                      <div style={ASSESSMENT_CHALLENGE_SECTION}>
                        <span style={FIELD_LABEL}>Success criteria</span>
                        <ul style={ASSESSMENT_CHALLENGE_LIST}>
                          {assessmentChallengeContract.successCriteria.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {assessmentChallengeContract.expectedEvidence.length > 0 && (
                      <div style={ASSESSMENT_CHALLENGE_SECTION}>
                        <span style={FIELD_LABEL}>Expected evidence</span>
                        <ul style={ASSESSMENT_CHALLENGE_LIST}>
                          {assessmentChallengeContract.expectedEvidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {assessmentProgress.commit?.repositoryUrl && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Repository</span>
                  <a href={assessmentProgress.commit.repositoryUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                    {assessmentProgress.commit.repositoryUrl.replace(/^https:\/\/github\.com\//, '')}
                  </a>
                </div>
              )}
              {assessmentProgress.commit?.branchName && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Branch</span>
                  <span style={FIELD_VALUE}>{assessmentProgress.commit.branchName}</span>
                </div>
              )}
              {assessmentProgress.humanDecision && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Human decision</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.5 }}>
                    {[
                      assessmentHumanDecisionLabel(assessmentProgress.humanDecision.decision),
                      assessmentProgress.humanDecision.summary,
                      `${assessmentProgress.humanDecision.sourceRefCount} source ${assessmentProgress.humanDecision.sourceRefCount === 1 ? 'ref' : 'refs'}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              {assessmentProgress.evaluation && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Evaluation</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.5 }}>
                    {[
                      assessmentEvaluationStatusLabel(assessmentProgress.evaluation.status),
                      assessmentEvaluationRecommendationLabel(assessmentProgress.evaluation.recommendation),
                      assessmentProgress.evaluation.summary,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              {canRecordHumanAssessmentDecision && (
                <form
                  data-testid="interview-human-decision-form"
                  style={HUMAN_DECISION_FORM}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void recordHumanAssessmentDecision();
                  }}
                >
                  <div style={FIELD_LABEL}>Human review</div>
                  <div style={ROOM_LINK_TEXT}>
                    Record the final reviewer decision after checking the source-backed report, commit, diff, and evidence trail.
                  </div>
                  <div style={HUMAN_DECISION_FORM_GRID}>
                    <label style={HUMAN_DECISION_FIELD}>
                      <span style={FIELD_LABEL}>Decision</span>
                      <select
                        value={humanDecisionValue}
                        onChange={(event) => {
                          setHumanDecisionValue(event.currentTarget.value as HumanAssessmentDecisionValue);
                          setHumanDecisionError(null);
                          setHumanDecisionNotice(null);
                        }}
                        style={WORKSPACE_INPUT}
                      >
                        {HUMAN_ASSESSMENT_DECISION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={HUMAN_DECISION_FIELD}>
                      <span style={FIELD_LABEL}>Decision summary</span>
                      <input
                        value={humanDecisionSummary}
                        onChange={(event) => {
                          setHumanDecisionSummary(event.currentTarget.value);
                          setHumanDecisionError(null);
                          setHumanDecisionNotice(null);
                        }}
                        placeholder="Why this is the right hiring decision from the evidence"
                        style={WORKSPACE_INPUT}
                      />
                    </label>
                  </div>
                  <label style={HUMAN_DECISION_FIELD}>
                    <span style={FIELD_LABEL}>Review notes</span>
                    <textarea
                      value={humanDecisionNotes}
                      onChange={(event) => {
                        setHumanDecisionNotes(event.currentTarget.value);
                        setHumanDecisionError(null);
                        setHumanDecisionNotice(null);
                      }}
                      placeholder="Optional calibration notes for the hiring team"
                      style={HUMAN_DECISION_TEXTAREA}
                    />
                  </label>
                  <div style={HUMAN_DECISION_ACTION_ROW}>
                    <button
                      type="submit"
                      disabled={isRecordingHumanDecision || humanDecisionSummary.trim().length === 0}
                      style={PRIMARY_BUTTON}
                    >
                      {isRecordingHumanDecision
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <CheckCircle size={14} />}
                      RECORD HUMAN DECISION
                    </button>
                  </div>
                </form>
              )}
              {assessmentEvaluationClaims.length > 0 && (
                <div
                  data-testid="interview-assessment-evaluation-claims"
                  style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}
                >
                  <span style={FIELD_LABEL}>Evidence-backed claims</span>
                  <span style={{ ...FIELD_VALUE, ...ASSESSMENT_CLAIM_LIST }}>
                    {assessmentEvaluationClaims.map((claim) => (
                      <span key={claim.id} style={ASSESSMENT_CLAIM_ROW}>
                        <span style={ASSESSMENT_CLAIM_HEAD}>
                          <span>{assessmentClaimPolarityLabel(claim.polarity)}</span>
                          <span>{sentenceCaseToken(claim.dimension)}</span>
                          {assessmentClaimConfidenceLabel(claim.confidence) && (
                            <span>{assessmentClaimConfidenceLabel(claim.confidence)}</span>
                          )}
                        </span>
                        <span style={ASSESSMENT_CLAIM_NARRATIVE}>{claim.narrative}</span>
                        <span style={ASSESSMENT_CLAIM_SOURCES}>{assessmentClaimSourceSummary(claim)}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {assessmentEvaluationDiagnostics.length > 0 && (
                <div
                  data-testid="interview-assessment-evaluation-diagnostics"
                  style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}
                >
                  <span style={FIELD_LABEL}>Evaluator cautions</span>
                  <span style={{ ...FIELD_VALUE, ...ASSESSMENT_CLAIM_LIST }}>
                    {assessmentEvaluationDiagnostics.map((diagnostic) => (
                      <span key={diagnostic.id} style={ASSESSMENT_DIAGNOSTIC_ROW}>
                        <span style={ASSESSMENT_CLAIM_HEAD}>
                          <span>{sentenceCaseToken(diagnostic.severity)}</span>
                          <span>{sentenceCaseToken(diagnostic.code)}</span>
                        </span>
                        <span style={ASSESSMENT_CLAIM_NARRATIVE}>{diagnostic.message}</span>
                        <span style={ASSESSMENT_CLAIM_SOURCES}>{assessmentClaimSourceSummary(diagnostic)}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {assessmentProgress.hasVerificationGap && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Verification gap</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.5 }}>
                    Test evidence is missing; the candidate submitted a source-backed explanation instead of silent verification.
                  </span>
                </div>
              )}
              {assessmentEvidenceSnippets.length > 0 && (
                <div
                  data-testid="interview-assessment-evidence-snippets"
                  style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}
                >
                  <span style={FIELD_LABEL}>Evidence trail</span>
                  <span style={{ ...FIELD_VALUE, ...ASSESSMENT_CLAIM_LIST }}>
                    {assessmentEvidenceSnippets.map((snippet, index) => (
                      <span
                        key={`${snippet.sourceRefType}:${snippet.evidenceRole}:${snippet.occurredAt}:${index}`}
                        style={ASSESSMENT_CLAIM_ROW}
                      >
                        <span style={ASSESSMENT_CLAIM_HEAD}>
                          <span>{assessmentEvidenceSnippetLabel(snippet.sourceRefType)}</span>
                          <span>{sentenceCaseToken(snippet.evidenceRole)}</span>
                        </span>
                        <span style={ASSESSMENT_CLAIM_NARRATIVE}>
                          {compactEvidenceText(snippet.exactText, 360)}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {assessmentRequiredProof.length > 0 && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Required proof</span>
                  <span style={{ ...FIELD_VALUE, ...ASSESSMENT_COVERAGE_CHIPS }}>
                    {assessmentRequiredProof.map((item) => (
                      <span
                        key={item.label}
                        style={item.satisfied ? ASSESSMENT_COVERAGE_OK : ASSESSMENT_COVERAGE_MISSING}
                        title={item.satisfied ? undefined : item.missingImpact}
                      >
                        {assessmentCoverageLabel(item.label)} {item.satisfied ? 'captured' : 'missing'}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {assessmentConfidenceSignals.length > 0 && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Confidence signals</span>
                  <span style={{ ...FIELD_VALUE, ...ASSESSMENT_COVERAGE_CHIPS }}>
                    {assessmentConfidenceSignals.map((item) => (
                      <span
                        key={item.label}
                        style={item.satisfied ? ASSESSMENT_COVERAGE_OK : ASSESSMENT_COVERAGE_MISSING}
                        title={item.satisfied ? undefined : item.missingImpact}
                      >
                        {assessmentCoverageLabel(item.label)} {item.satisfied ? 'captured' : 'missing'}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {assessmentProgressSourceRefCounts.length > 0 && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Source refs</span>
                  <span style={FIELD_VALUE}>
                    {assessmentProgressSourceRefCounts
                      .map((count) => `${count.count} ${sentenceCaseToken(count.kind)}`)
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div style={EMPTY_TEXT}>
              Assessment session evidence will appear after PIPE creates the session for this interview.
            </div>
          )}
          {assessmentEvaluationNotice && <div style={SUCCESS_NOTE}>{assessmentEvaluationNotice}</div>}
          {assessmentEvaluationError && <div style={ERROR_NOTE}>{assessmentEvaluationError}</div>}
          {humanDecisionNotice && <div style={SUCCESS_NOTE}>{humanDecisionNotice}</div>}
          {humanDecisionError && <div style={ERROR_NOTE}>{humanDecisionError}</div>}
        </section>
      )}

      {usesWorkspaceInterview && (
        <section style={WORKSPACE_CONFIG_PANEL}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 10 }}>
              <GitPullRequest size={15} />
              Live workspace
            </div>
            <div style={ROOM_LINK_TEXT}>
              Pick the repository that should open inside the live implementation room.
            </div>
          </div>
          <div style={WORKSPACE_CONFIG_FORM}>
            <input
              value={workspaceRepoUrl}
              onChange={(event) => setWorkspaceRepoUrl(event.currentTarget.value)}
              placeholder="https://github.com/owner/repo"
              style={WORKSPACE_INPUT}
            />
            <input
              value={workspacePrNumber}
              onChange={(event) => setWorkspacePrNumber(event.currentTarget.value)}
              placeholder="PR # optional"
              inputMode="numeric"
              style={{ ...WORKSPACE_INPUT, maxWidth: 140 }}
            />
            <button
              onClick={() => void saveWorkspaceConfig()}
              disabled={isSavingWorkspace}
              style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
            >
              {isSavingWorkspace ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={14} />}
              SAVE
            </button>
          </div>
        </section>
      )}

      <main style={EVIDENCE_GRID}>
        {isCodeReviewInterview && (codeReviewMatch || codeReviewSubmission) && (
          <Section
            title="Recruiter decision"
            icon={<CheckCircle size={15} />}
            style={CODE_REVIEW_DECISION_SECTION}
          >
            <div data-testid="interview-code-review-decision-summary" style={DECISION_SUMMARY}>
              <div style={DECISION_HEADER}>
                <div style={{ minWidth: 0 }}>
                  <div style={FIELD_LABEL}>Review outcome</div>
                  <div style={DECISION_TITLE}>{codeReviewOutcome}</div>
                </div>
                {codeReviewMatch?.status && (
                  <span style={MATCH_BADGE}>{titleCaseToken(codeReviewMatch.status)}</span>
                )}
              </div>
              <div style={DECISION_ACTION}>{codeReviewAction}</div>
              <div data-testid="interview-code-review-hiring-readout" style={DECISION_COCKPIT}>
                <div style={FIELD_LABEL}>Hiring manager readout</div>
                <div style={DECISION_COCKPIT_GRID}>
                  {codeReviewHiringReadout.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        ...DECISION_COCKPIT_ITEM,
                        ...DECISION_NEXT_STEP_TONE[item.tone],
                      }}
                    >
                      <div style={FIELD_LABEL}>{item.label}</div>
                      <div style={DECISION_COCKPIT_VALUE}>{item.value}</div>
                      <div style={DECISION_COCKPIT_DETAIL}>{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div
                data-testid="interview-code-review-match-explanation"
                style={{
                  ...DECISION_MATCH_EXPLANATION,
                  ...DECISION_NEXT_STEP_TONE[codeReviewExplanation.tone],
                }}
              >
                <div style={FIELD_LABEL}>Why this challenge</div>
                <div style={DECISION_NEXT_STEP_VALUE}>{codeReviewExplanation.selectedChallenge}</div>
                <div style={DECISION_MATCH_EXPLANATION_GRID}>
                  <div style={DECISION_MATCH_EXPLANATION_ITEM}>
                    <div style={FIELD_LABEL}>Why selected</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewExplanation.whyThisChallenge}</div>
                  </div>
                  <div style={DECISION_MATCH_EXPLANATION_ITEM}>
                    <div style={FIELD_LABEL}>Valid because</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewExplanation.proofSummary}</div>
                  </div>
                  <div style={DECISION_MATCH_EXPLANATION_ITEM}>
                    <div style={FIELD_LABEL}>Do not over-trust because</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewExplanation.riskSummary}</div>
                  </div>
                  <div style={DECISION_MATCH_EXPLANATION_ITEM}>
                    <div style={FIELD_LABEL}>Remaining question</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewExplanation.remainingQuestion}</div>
                  </div>
                </div>
              </div>
              <div
                data-testid="interview-code-review-assignment-trust"
                style={{
                  ...DECISION_NEXT_STEP,
                  ...DECISION_NEXT_STEP_TONE[codeReviewAssignmentTrust.tone],
                }}
              >
                <div style={FIELD_LABEL}>Assignment trust</div>
                <div style={DECISION_NEXT_STEP_VALUE}>{codeReviewAssignmentTrust.value}</div>
                <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewAssignmentTrust.detail}</div>
              </div>
              <div
                data-testid="interview-code-review-next-step"
                style={{
                  ...DECISION_NEXT_STEP,
                  ...DECISION_NEXT_STEP_TONE[codeReviewNextStep.tone],
                }}
              >
                <div style={FIELD_LABEL}>Recommended next step</div>
                <div style={DECISION_NEXT_STEP_VALUE}>{codeReviewNextStep.value}</div>
                <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewNextStep.detail}</div>
              </div>
              <div data-testid="interview-code-review-decision-risk" style={DECISION_RISK_GRID}>
                <div style={DECISION_RISK_CARD}>
                  <div style={FIELD_LABEL}>Uncertainty</div>
                  <div style={DECISION_RISK_VALUE}>{codeReviewDecisionRisk.uncertainty.value}</div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewDecisionRisk.uncertainty.detail}</div>
                </div>
                <div style={DECISION_RISK_CARD}>
                  <div style={FIELD_LABEL}>Missing context</div>
                  <ul style={DECISION_RISK_LIST}>
                    {codeReviewDecisionRisk.missingContext.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div
                data-testid="interview-code-review-score-validity"
                style={{
                  ...DECISION_NEXT_STEP,
                  ...DECISION_NEXT_STEP_TONE[codeReviewAssessmentValidity.tone],
                }}
              >
                <div style={FIELD_LABEL}>Score validity</div>
                <div style={DECISION_NEXT_STEP_VALUE}>{codeReviewAssessmentValidity.value}</div>
                <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewAssessmentValidity.detail}</div>
              </div>
              {codeReviewScore && (
                <div data-testid="interview-code-review-score-summary" style={DECISION_SCORE_SUMMARY}>
                  <div style={DECISION_SCORE_HEADER}>
                    <div style={{ minWidth: 0 }}>
                      <div style={FIELD_LABEL}>Candidate signal</div>
                      <div style={DECISION_SCORE_VALUE}>
                        {codeReviewScoreValue ?? titleCaseToken(codeReviewScore.status)}
                      </div>
                    </div>
                    <span style={MATCH_BADGE}>{titleCaseToken(codeReviewScore.status)}</span>
                  </div>
                  {codeReviewScoreDetail && (
                    <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewScoreDetail}</div>
                  )}
                  <div style={FIELD_LABEL}>Signal basis</div>
                  <div data-testid="interview-code-review-score-basis" style={DECISION_SCORE_BASIS}>
                    {codeReviewSignalBasis.map((item) => (
                      <div
                        key={item.label}
                        style={item.satisfied ? DECISION_SCORE_BASIS_ITEM_OK : DECISION_SCORE_BASIS_ITEM_MISSING}
                      >
                        <span style={FIELD_LABEL}>{item.label}</span>
                        <span style={DECISION_SCORE_BASIS_VALUE}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  {(codeReviewScore.strengths.length > 0 || codeReviewScore.growthAreas.length > 0) && (
                    <div style={DECISION_SCORE_COLUMNS}>
                      {codeReviewScore.strengths.length > 0 && (
                        <div style={DECISION_SCORE_COLUMN}>
                          <div style={FIELD_LABEL}>What looked good</div>
                          {codeReviewScore.strengths.slice(0, 2).map((strength) => (
                            <div key={strength} style={CONTEXT_RECORD_NARRATIVE}>{strength}</div>
                          ))}
                        </div>
                      )}
                      {codeReviewScore.growthAreas.length > 0 && (
                        <div style={DECISION_SCORE_COLUMN}>
                          <div style={FIELD_LABEL}>What to probe</div>
                          {codeReviewScore.growthAreas.slice(0, 2).map((area) => (
                            <div key={area} style={CONTEXT_RECORD_NARRATIVE}>{area}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {codeReviewEvidenceRefresh && (
                <div data-testid="interview-code-review-evidence-refresh" style={DECISION_FOLLOW_UP}>
                  <div style={FIELD_LABEL}>
                    {codeReviewEvidenceRefreshUsed
                      ? 'Evidence used for current match'
                      : codeReviewEvidenceRefreshStillMissing
                        ? 'Evidence tried, still insufficient'
                        : !codeReviewEvidenceRefreshMatcherReady
                          ? 'Evidence captured, prepare context'
                        : 'New evidence is ready'}
                  </div>
                  <div style={DECISION_PLAN_SIGNAL}>
                    {codeReviewEvidenceRefreshUsed
                      ? 'Current PR assignment is evidence-backed'
                      : codeReviewEvidenceRefreshStillMissing
                        ? 'Capture another concrete source-backed answer before rerunning.'
                        : !codeReviewEvidenceRefreshMatcherReady
                          ? 'Prepare matcher context and rerun'
                        : 'Rerun repo matching'}
                  </div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    {codeReviewEvidenceRefreshUsed
                      ? 'These source-backed follow-up spans were used to select the current PR assignment.'
                      : codeReviewEvidenceRefreshStillMissing
                        ? 'The last rerun used these source-backed spans but still did not find a confident repo/PR assignment.'
                        : !codeReviewEvidenceRefreshMatcherReady
                          ? 'PIPE will project the captured source evidence into candidate matcher context before trying PR selection again.'
                        : 'Use the new source-backed spans to try PR selection again.'}
                  </div>
                  <div style={DECISION_FOLLOW_UP_ITEM}>
                    <div style={FIELD_LABEL}>Captured follow-up assessment</div>
                    <div>{codeReviewEvidenceRefresh.summary}</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {codeReviewEvidenceRefresh.sourceSpanCount ?? 0} source-backed transcript {codeReviewEvidenceRefresh.sourceSpanCount === 1 ? 'span is' : 'spans are'} linked to this original code-review match.
                    </div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {codeReviewEvidenceRefreshMatcherContextCount} matcher-visible context {codeReviewEvidenceRefreshMatcherContextCount === 1 ? 'record is' : 'records are'} ready for repo matching.
                    </div>
                  </div>
                  {(codeReviewEvidenceRefresh.evidenceSnippets?.length ?? 0) > 0 && (
                    <div style={DECISION_FOLLOW_UP_ITEM}>
                      <div style={FIELD_LABEL}>Captured source evidence</div>
                      <div style={DECISION_FOLLOW_UP_LIST}>
                        {codeReviewEvidenceRefresh.evidenceSnippets?.slice(0, 3).map((snippet) => (
                          <div key={`${snippet.eventId}:${snippet.sourceRefId}`} style={CONTEXT_RECORD_NARRATIVE}>
                            {snippet.exactText}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {codeReviewEvidenceRefreshStillMissing && (codeReviewMatch?.gaps.length ?? 0) > 0 && (
                    <div style={DECISION_FOLLOW_UP_ITEM}>
                      <div style={FIELD_LABEL}>Still missing</div>
                      <div style={TAG_ROW}>
                        {codeReviewMatch?.gaps.slice(0, 3).map((gap) => (
                          <span key={gap} style={TAG}>{titleCaseToken(gap)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {codeReviewEvidenceRefreshStillMissing && codeReviewEvidencePlan.length > 0 && (
                    <div style={DECISION_FOLLOW_UP_ITEM}>
                      <div style={FIELD_LABEL}>Next evidence to collect</div>
                      <div style={DECISION_FOLLOW_UP_LIST}>
                        {codeReviewEvidencePlan.slice(0, 3).map((item) => (
                          <div key={`refresh:${item.id}`} style={DECISION_FOLLOW_UP_ITEM}>
                            <div style={FIELD_LABEL}>What PIPE needs</div>
                            <div style={DECISION_PLAN_SIGNAL}>{item.missingSignal}</div>
                            <div style={FIELD_LABEL}>What to ask</div>
                            <div>{item.question}</div>
                            <div style={FIELD_LABEL}>What good evidence looks like</div>
                            <div style={CONTEXT_RECORD_NARRATIVE}>
                              {item.expectedEvidence}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!codeReviewEvidenceRefreshUsed && !codeReviewEvidenceRefreshStillMissing && (
                    <button
                      data-testid="interview-code-review-refresh-match-cta"
                      onClick={() => void refreshCodeReviewMatch()}
                      disabled={isRefreshingMatch}
                      style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                    >
                      {isRefreshingMatch
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Network size={14} />}
                      {!codeReviewEvidenceRefreshMatcherReady
                        ? 'PREPARE + RERUN MATCH'
                        : codeReviewEvidenceRefreshStillMissing ? 'RERUN AFTER NEW EVIDENCE' : 'RERUN REPO MATCH'}
                    </button>
                  )}
                  {codeReviewEvidenceRefreshStillMissing && (
                    <button
                      data-testid="interview-code-review-next-follow-up-cta"
                      onClick={() => void createContextCall()}
                      disabled={isCreatingContextCall}
                      style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                    >
                      {isCreatingContextCall
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <CalendarCheck size={14} />}
                      CREATE NEXT FOLLOW-UP ASSESSMENT
                    </button>
                  )}
                  {codeReviewEvidenceRefresh.contextCallInterviewId && (
                    <button
                      data-testid="interview-code-review-open-evidence-call"
                      onClick={() => navigate(`/interviews/${codeReviewEvidenceRefresh.contextCallInterviewId}`)}
                      style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                    >
                      <CheckCircle size={14} />
                      OPEN EVIDENCE CALL
                    </button>
                  )}
                  {matchRefreshNotice && <div style={SUCCESS_NOTE}>{matchRefreshNotice}</div>}
                  {matchRefreshError && <div style={ERROR_NOTE}>{matchRefreshError}</div>}
                  {contextCallError && <div style={ERROR_NOTE}>{contextCallError}</div>}
                </div>
              )}
              {codeReviewEvidenceFollowUp && !codeReviewEvidenceRefresh && (
                <div data-testid="interview-code-review-evidence-follow-up" style={DECISION_FOLLOW_UP}>
                  <div style={FIELD_LABEL}>
                    {codeReviewEvidenceFollowUpBlocked ? 'Follow-up needs attribution' : 'Follow-up assessment open'}
                  </div>
                  <div style={DECISION_PLAN_SIGNAL}>
                    {codeReviewEvidenceFollowUpBlocked
                      ? 'Record another answer with clear candidate audio before rerunning matching.'
                      : 'Waiting for source-backed response'}
                  </div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    {codeReviewEvidenceFollowUpBlocked
                      ? (codeReviewEvidenceFollowUp.blockedReason
                        ?? 'The previous follow-up did not produce attributable candidate transcript evidence, so PIPE did not use it for repo matching.')
                      : 'PIPE already has an evidence-plan assessment linked to this code-review match gap.'}
                  </div>
                  {codeReviewEvidenceFollowUp.contextCallInterviewId && (
                    <div style={DECISION_FOLLOW_UP_ITEM}>
                      <div style={FIELD_LABEL}>Linked evidence interview</div>
                      <div style={TRANSCRIPT_TEXT}>
                        Follow-up assessment ready
                      </div>
                      <div style={CONTEXT_RECORD_NARRATIVE}>
                        Same person graph; this follow-up adds source evidence to the original code-review match.
                      </div>
                    </div>
                  )}
                  {codeReviewEvidenceFollowUp.questions.length > 0 && (
                    <>
                      <div style={FIELD_LABEL}>Question plan</div>
                      <div style={DECISION_FOLLOW_UP_LIST}>
                        {codeReviewEvidenceFollowUp.questions.map((question, index) => (
                          <div
                            key={`${codeReviewEvidenceFollowUp.assessmentSessionId}:${index}`}
                            style={DECISION_FOLLOW_UP_ITEM}
                          >
                            {question}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {codeReviewEvidenceFollowUp.contextCallInterviewId && (
                    <button
                      data-testid="interview-code-review-open-follow-up-assessment"
                      onClick={() => navigate(`/interviews/${codeReviewEvidenceFollowUp.contextCallInterviewId}`)}
                      style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                    >
                      <CalendarCheck size={14} />
                      OPEN FOLLOW-UP ASSESSMENT
                    </button>
                  )}
                </div>
              )}
              {shouldShowEvidencePlan && (
                <div data-testid="interview-code-review-evidence-plan" style={DECISION_FOLLOW_UP}>
                  <div style={FIELD_LABEL}>Resolve missing evidence</div>
                  <div style={DECISION_PLAN_SIGNAL}>Plan a follow-up assessment</div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    Ask one targeted question and capture the answer as source evidence. Use the answer to rerun repo matching.
                  </div>
                  <div style={FIELD_LABEL}>Evidence to collect</div>
                  <div style={DECISION_FOLLOW_UP_LIST}>
                    {codeReviewEvidencePlan.map((item) => (
                      <div key={item.id} style={DECISION_FOLLOW_UP_ITEM}>
                        <div style={FIELD_LABEL}>What PIPE needs</div>
                        <div style={DECISION_PLAN_SIGNAL}>{item.missingSignal}</div>
                        <div style={FIELD_LABEL}>What to ask</div>
                        <div>{item.question}</div>
                        <div style={FIELD_LABEL}>Why it matters</div>
                        <div style={CONTEXT_RECORD_NARRATIVE}>{item.whyItMatters}</div>
                        <div style={FIELD_LABEL}>What good evidence looks like</div>
                        <div style={CONTEXT_RECORD_NARRATIVE}>
                          {item.expectedEvidence}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    data-testid="interview-code-review-context-call-cta"
                    onClick={() => void createContextCall()}
                    disabled={isCreatingContextCall}
                    style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                  >
                    {isCreatingContextCall
                      ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                      : <CalendarCheck size={14} />}
                    CREATE FOLLOW-UP ASSESSMENT
                  </button>
                  {contextCallError && <div style={ERROR_NOTE}>{contextCallError}</div>}
                </div>
              )}
              <div style={DECISION_SIGNAL_GRID}>
                {codeReviewDecisionSignals.map((signal) => (
                  <div key={signal.label} style={DECISION_SIGNAL_CARD}>
                    <div style={TRANSCRIPT_ROLE}>{signal.label}</div>
                    <div style={DECISION_SIGNAL_VALUE}>{signal.value}</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>{signal.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        <Section
          title="Scheduling"
          icon={<CalendarCheck size={15} />}
          style={isCodeReviewInterview ? CODE_REVIEW_OPERATIONAL_SECTION : undefined}
        >
          <div style={EVIDENCE_LIST}>
            <div style={EVIDENCE_ROW}>
              <span style={FIELD_LABEL}>Status</span>
              <span style={FIELD_VALUE}>{displayStatus ?? 'INVITED'}</span>
            </div>
            <div style={EVIDENCE_ROW}>
              <span style={FIELD_LABEL}>Scheduled for</span>
              <span style={FIELD_VALUE}>{formatDate(interview.scheduledAt)}</span>
            </div>
            {providerName && (
              <div style={EVIDENCE_ROW}>
                <span style={FIELD_LABEL}>Provider</span>
                <span style={FIELD_VALUE}>{providerName}</span>
              </div>
            )}
            {providerEventId && (
              <div style={EVIDENCE_ROW}>
                <span style={FIELD_LABEL}>Provider event</span>
                {providerEventId.startsWith('http') ? (
                  <a href={providerEventId} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                    {providerEventDisplay ?? providerEventId}
                  </a>
                ) : (
                  <span style={FIELD_VALUE}>{providerEventDisplay ?? providerEventId}</span>
                )}
              </div>
            )}
            {interview.linkedMeeting?.id && (
              <div style={EVIDENCE_ROW}>
                <span style={FIELD_LABEL}>Meeting room</span>
                <span style={FIELD_VALUE}>Linked to this interview</span>
              </div>
            )}
          </div>
        </Section>

        {showsCallRecord && (
          <Section
            title="Call record"
            icon={<FileText size={15} />}
            style={isCodeReviewInterview ? CODE_REVIEW_CALL_RECORD_SECTION : undefined}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {transcriptStatus === 'COMPLETED' || transcriptStatus === 'READY'
                ? <CheckCircle size={14} color="#4ade80" />
                : transcriptStatus === 'FAILED'
                  ? <AlertCircle size={14} color="#f87171" />
                  : <Clock size={14} color="var(--pipe-text-dim)" />}
              <span style={{ ...FIELD_VALUE, color: 'var(--pipe-text)' }}>{transcriptStatusLabel(transcriptStatus)}</span>
            </div>
            {interview.linkedMeeting?.transcriptSummary && (
              <div style={NOTE}>{interview.linkedMeeting.transcriptSummary}</div>
            )}
            {interview.linkedMeeting?.recordingR2Key && (
              <div style={SMALL_NOTE}>Recording stored. Transcript and person context rebuild from this call.</div>
            )}
            {transcriptContextText && (
              <div style={SMALL_NOTE}>{transcriptContextText}</div>
            )}
            {transcriptTopics.length > 0 && (
              <div style={ANALYSIS_GROUP}>
                <div style={FIELD_LABEL}>Topics</div>
                <div style={TAG_ROW}>
                  {transcriptTopics.map((topic) => <span key={topic} style={TAG}>{topic}</span>)}
                </div>
              </div>
            )}
            {transcriptDecisions.length > 0 && (
              <div style={ANALYSIS_GROUP}>
                <div style={FIELD_LABEL}>Decisions</div>
                <div style={TAG_ROW}>
                  {transcriptDecisions.map((decision) => <span key={decision} style={TAG}>{decision}</span>)}
                </div>
              </div>
            )}
            {transcriptError && (
              <div style={{ ...NOTE, borderColor: 'rgba(248,113,113,0.35)', color: '#fca5a5' }}>
                {transcriptError}
              </div>
            )}
            {transcriptEntries.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {transcriptEntries.map((entry, index) => {
                  const timeLabel = transcriptTimeLabel(entry);
                  return (
                    <div key={`${entry.role}-${index}`} style={TRANSCRIPT_ROW}>
                      <div style={TRANSCRIPT_ROLE}>{entry.role}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={TRANSCRIPT_TEXT}>{entry.text}</div>
                        {timeLabel && (
                          <div style={TRANSCRIPT_TIME}>{timeLabel}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={EMPTY_TEXT}>{transcriptEmptyText}</div>
            )}
          </Section>
        )}

        <Section
          title="Person context"
          icon={<Network size={15} />}
          style={isCodeReviewInterview ? CODE_REVIEW_PERSON_CONTEXT_SECTION : undefined}
        >
          {hasLivingContextEvidence && contextSummary ? (
            <>
              <div data-testid="interview-person-context-relationship" style={CONTEXT_RECORD}>
                <div style={FIELD_LABEL}>Person context rollup</div>
                <div style={TRANSCRIPT_TEXT}>{countLabel(contextSummary.interactionCount, 'evidence moment')} on the person profile</div>
                <div style={CONTEXT_RECORD_NARRATIVE}>
                  This meeting remains scoped to its own invite, room, transcript, and assessment evidence.
                </div>
              </div>
              {relatedEvidenceInterviews.length > 0 && (
                <div data-testid="interview-related-evidence-interviews" style={CONTEXT_RECORD}>
                  <div style={FIELD_LABEL}>Other interviews for this person</div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    These are separate interviews on the same person graph. Open the person profile for the full cross-meeting view.
                  </div>
                  <div data-testid="interview-related-evidence-summary" style={RELATED_EVIDENCE_SUMMARY}>
                    <div style={{ minWidth: 0 }}>
                      <div style={DECISION_PLAN_SIGNAL}>{relatedEvidenceDecision.headline}</div>
                      <div style={CONTEXT_RECORD_NARRATIVE}>{relatedEvidenceDecision.detail}</div>
                      <div style={RELATED_EVIDENCE_NEXT_ACTION}>{relatedEvidenceDecision.nextAction}</div>
                    </div>
                    <div style={RELATED_EVIDENCE_METRICS}>
                      {relatedEvidenceDecision.metrics.map((metric) => (
                        <div key={metric.label} style={RELATED_EVIDENCE_METRIC}>
                          <span style={CONTEXT_METRIC_VALUE}>{metric.value}</span>
                          <span style={CONTEXT_METRIC_LABEL}>{metric.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={RELATED_EVIDENCE_SCOPE}>
                    <span style={CONTEXT_RECORD_NARRATIVE}>
                      {relatedEvidenceHiddenCount > 0
                        ? `Showing ${relatedEvidenceInterviews.length} of ${relatedEvidenceTotal} related context previews.`
                        : `Showing ${countLabel(relatedEvidenceInterviews.length, 'related context preview')}.`}
                    </span>
                    {personProfilePath && (
                      <button
                        type="button"
                        data-testid="interview-open-person-profile"
                        onClick={openPersonProfile}
                        style={RELATED_EVIDENCE_PROFILE_BUTTON}
                      >
                        Open full person graph
                      </button>
                    )}
                  </div>
                  <div style={RELATED_EVIDENCE_LIST}>
                    {relatedEvidenceInterviews.map((related) => (
                      <button
                        key={related.id}
                        type="button"
                        onClick={() => navigate(`/interviews/${related.id}`)}
                        style={RELATED_EVIDENCE_ROW}
                      >
                        <span style={RELATED_EVIDENCE_MAIN}>
                          <span style={TRANSCRIPT_ROLE}>{relatedEvidenceRelationshipLabel(related)}</span>
                          <span style={TRANSCRIPT_TEXT}>{relatedEvidenceDisplayName(related)}</span>
                          <span style={CONTEXT_RECORD_NARRATIVE}>{relatedEvidenceDetail(related)}</span>
                        </span>
                        <span style={MATCH_BADGE}>{titleCaseToken(related.status)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={CONTEXT_METRICS}>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.interactionCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>moments</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.contextRecordCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>learned context</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.sourceSpanCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>source text</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.assertionCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>claims</span>
                </div>
              </div>
              {personProfilePath && (
                <button
                  type="button"
                  data-testid="interview-open-person-profile"
                  onClick={openPersonProfile}
                  style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                >
                  <User size={14} />
                  OPEN PERSON PROFILE
                </button>
              )}
            </>
          ) : (
            <div style={EMPTY_TEXT}>
              Person context will appear after PIPE has exact source evidence from the invite, transcript, assessment, or code-review material.
            </div>
          )}
        </Section>

        {showsReviewAssignmentPanel && (
          <Section
            title={hasConcreteReviewAssignment ? 'Review assignment' : 'Assignment setup gap'}
            icon={<GitPullRequest size={15} />}
            style={CODE_REVIEW_ASSIGNMENT_SECTION}
          >
            <div style={EVIDENCE_LIST}>
              {interview.githubRepoUrl && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>
                    {hasConcreteReviewAssignment ? 'Repository' : 'Draft repository'}
                  </span>
                  <a href={interview.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                    {interview.githubRepoUrl.replace(/^https:\/\/github\.com\//, '')}
                  </a>
                </div>
              )}
              {interview.githubPrNumber && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>PR</span>
                  <span style={FIELD_VALUE}>#{interview.githubPrNumber}</span>
                </div>
              )}
              {codeReviewMatch?.summary && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Why this PR</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.6 }}>{codeReviewMatch.summary}</span>
                </div>
              )}
              <div
                data-testid="interview-review-assignment-trust"
                style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}
              >
                <span style={FIELD_LABEL}>Assignment trust</span>
                <span style={{ ...FIELD_VALUE, lineHeight: 1.6 }}>
                  {codeReviewAssignmentTrust.value}
                  {' — '}
                  {codeReviewAssignmentTrust.detail}
                </span>
              </div>
              {hasReviewSetupGap && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Why it is not ready</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.6 }}>
                    This interview only has repository setup data. No reviewable PR or source-backed match is attached yet, so this should not be treated as the candidate's code-review assignment.
                  </span>
                </div>
              )}
            </div>
          </Section>
        )}

        {codeReviewMatch && (
          <Section
            title="Match decision"
            icon={<Network size={15} />}
            style={CODE_REVIEW_MATCH_SECTION}
          >
            <div data-testid="interview-code-review-match" style={EVIDENCE_LIST}>
              <div style={MATCH_DECISION_GRID}>
                <div style={MATCH_DECISION_CARD}>
                  <div style={FIELD_LABEL}>Match</div>
                  <div style={MATCH_DECISION_VALUE}>{titleCaseToken(codeReviewMatch.status)}</div>
                </div>
                {codeReviewMatch.assessmentQuality && (
                  <div style={MATCH_DECISION_CARD}>
                    <div style={FIELD_LABEL}>Assessment fit</div>
                    <div style={MATCH_DECISION_VALUE}>{codeReviewMatch.assessmentQuality.verdict}</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {codeReviewMatch.assessmentQuality.score}/{codeReviewMatch.assessmentQuality.maxScore}
                    </div>
                  </div>
                )}
              </div>

              {codeReviewMatch.assessmentQuality && (
                <details data-testid="interview-code-review-match-quality" style={DETAILS_CARD}>
                  <summary style={DETAILS_SUMMARY}>
                    Assessment quality gate
                    <span style={DETAILS_HINT}>
                      {codeReviewMatch.assessmentQuality.verdict}
                      {' · '}
                      {codeReviewMatch.assessmentQuality.score}/{codeReviewMatch.assessmentQuality.maxScore}
                      {' · '}
                      {countLabel(recruiterAssessmentMetrics.length, 'rubric check')}
                    </span>
                  </summary>
                  <div style={MATCH_QUALITY_BODY}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={MATCH_BADGE}>{codeReviewMatch.assessmentQuality.verdict}</span>
                      <span style={FIELD_VALUE}>
                        {codeReviewMatch.assessmentQuality.score}/{codeReviewMatch.assessmentQuality.maxScore}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {recruiterAssessmentMetrics.map((metric) => (
                        <div key={metric.id} style={MATCH_METRIC_ROW}>
                          <div style={{ minWidth: 0 }}>
                            <div style={TRANSCRIPT_ROLE}>{metric.label}</div>
                            <div style={CONTEXT_RECORD_NARRATIVE}>{metric.reason}</div>
                          </div>
                          <div style={MATCH_SCORE}>{metric.score}/{metric.maxScore}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}

              {codeReviewProfile && (
                <ReviewProfileCard profile={codeReviewProfile} />
              )}

              {(codeReviewMatch.validatorAgent || matchHyperedges.length > 0 || primaryMatchEvidence || codeReviewMatch.gaps.length > 0) && (
                <details style={DETAILS_CARD}>
                  <summary style={DETAILS_SUMMARY}>
                    Source proof
                    <span style={DETAILS_HINT}>candidate, role, repo, and scoring provenance</span>
                  </summary>

                  {codeReviewMatch.validatorAgent && (
                    <div data-testid="interview-code-review-match-validator" style={CONTEXT_RECORD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={FIELD_LABEL}>Validator agent</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={MATCH_BADGE}>{codeReviewMatch.validatorAgent.mode}</span>
                      <span style={MATCH_BADGE}>{codeReviewMatch.validatorAgent.verdict}</span>
                    </div>
                  </div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>{codeReviewMatch.validatorAgent.rationale}</div>
                  {codeReviewMatch.validatorAgent.sourceBridge && (
                    <div style={MATCH_BRIDGE_GRID}>
                      <div style={MATCH_BRIDGE_CARD}>
                        <div style={TRANSCRIPT_ROLE}>Person sources</div>
                        <div style={TRANSCRIPT_TEXT}>{codeReviewMatch.validatorAgent.sourceBridge.candidateSourceCount}</div>
                      </div>
                      <div style={MATCH_BRIDGE_CARD}>
                        <div style={TRANSCRIPT_ROLE}>Role sources</div>
                        <div style={TRANSCRIPT_TEXT}>{codeReviewMatch.validatorAgent.sourceBridge.roleSourceCount}</div>
                      </div>
                      <div style={MATCH_BRIDGE_CARD}>
                        <div style={TRANSCRIPT_ROLE}>Repo sources</div>
                        <div style={TRANSCRIPT_TEXT}>{codeReviewMatch.validatorAgent.sourceBridge.repoSourceCount}</div>
                      </div>
                    </div>
                  )}
                  {codeReviewMatch.validatorAgent.checks.length > 0 && (
                    <div style={TAG_ROW}>
                      {codeReviewMatch.validatorAgent.checks
                        .filter((check) => check.passed)
                        .slice(0, 6)
                        .map((check) => (
                          <span key={check.id} title={check.reason} style={TAG}>
                            {titleCaseToken(check.id)}
                          </span>
                        ))}
                    </div>
                  )}
                    </div>
                  )}

                  {matchHyperedges.length > 0 && (
                    <div data-testid="interview-code-review-match-hyperedges" style={CONTEXT_RECORD}>
                  <div style={{ display: 'grid', gap: 5 }}>
                    <div style={FIELD_LABEL}>Evidence trace</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {hyperedgePathLabel(matchHyperedges)}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 12 }}>
                    {matchHyperedges.slice(0, 3).map((edge: CodeReviewMatchHyperedge, index) => (
                      <div
                        key={`${edge.relation}:${edge.label}:${index}`}
                        style={{
                          display: 'grid',
                          gap: 10,
                          paddingTop: index === 0 ? 0 : 12,
                          borderTop: index === 0 ? 'none' : '1px solid var(--pipe-border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={TRANSCRIPT_ROLE}>
                            {edge.label}
                            <span style={{ ...TAG, marginLeft: 8 }}>{hyperedgeRelationBadge(edge)}</span>
                          </div>
                          {formatMatchScore(edge.pairScore) && (
                            <span style={MATCH_SCORE}>{formatMatchScore(edge.pairScore)}</span>
                          )}
                        </div>
                        <div style={MATCH_BRIDGE_GRID}>
                          {edge.nodes.map((node, nodeIndex) => (
                            <div key={`${node.kind}:${nodeIndex}`} style={MATCH_BRIDGE_CARD}>
                              <div style={TRANSCRIPT_ROLE}>{hyperedgeNodeTitle(node)}</div>
                              <div style={TRANSCRIPT_TEXT}>
                                {sourceRefText(node.sourceRef) ?? sourceEvidenceFallback(node.kind)}
                              </div>
                              {node.sourceRef.conceptKeys && node.sourceRef.conceptKeys.length > 0 && (
                                <div style={TAG_ROW}>
                                  {node.sourceRef.conceptKeys.slice(0, 4).map((concept) => (
                                    <span key={concept} style={TAG}>{concept}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                    </div>
                  )}

                  {primaryMatchEvidence && (
                    <div data-testid="interview-code-review-evidence-bridge" style={CONTEXT_RECORD}>
                  <div style={{ display: 'grid', gap: 5 }}>
                    <div style={FIELD_LABEL}>Evidence bridge</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {matchPathLabel}
                    </div>
                    {primaryMatchEvidence.sharedConcepts.length > 0 && (
                      <div style={TAG_ROW}>
                        {primaryMatchEvidence.sharedConcepts.map((concept) => (
                          <span key={concept} style={TAG}>{concept}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={MATCH_BRIDGE_GRID}>
                    <div style={MATCH_BRIDGE_CARD}>
                      <div style={TRANSCRIPT_ROLE}>
                        {primaryMatchHasRoleContext ? 'Role requirement' : 'Match concepts'}
                      </div>
                      <div style={TRANSCRIPT_TEXT}>
                        {sourceRefText(primaryMatchEvidence.roleSourceRefs[0])
                          ?? sourceRefText(codeReviewMatch.roleSources[0])
                          ?? alignmentLabel(primaryMatchEvidence)}
                      </div>
                      {(primaryMatchEvidence.roleSourceRefs[0]?.conceptKeys.length
                        ?? codeReviewMatch.roleSources[0]?.conceptKeys.length
                        ?? 0) > 0 && (
                        <div style={TAG_ROW}>
                          {(primaryMatchEvidence.roleSourceRefs[0]?.conceptKeys
                            ?? codeReviewMatch.roleSources[0]?.conceptKeys
                            ?? []).slice(0, 4).map((concept) => (
                            <span key={concept} style={TAG}>{concept}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={MATCH_BRIDGE_CARD}>
                      <div style={TRANSCRIPT_ROLE}>Person evidence</div>
                      <div style={TRANSCRIPT_TEXT}>
                        {firstSourceRefText(primaryMatchEvidence.candidateSourceRefs)
                          ?? 'Candidate source evidence'}
                      </div>
                    </div>

                    <div style={MATCH_BRIDGE_CARD}>
                      <div style={TRANSCRIPT_ROLE}>Repo challenge</div>
                      <div style={TRANSCRIPT_TEXT}>
                        {firstSourceRefText(primaryMatchEvidence.challengeSourceRefs)
                          ?? 'Repo challenge evidence'}
                      </div>
                    </div>
                  </div>
                    </div>
                  )}

                  {codeReviewMatch.gaps.length > 0 && (
                    <div style={CONTEXT_RECORD}>
                  <div style={FIELD_LABEL}>Gaps</div>
                  {codeReviewMatch.gaps.slice(0, 3).map((gap) => (
                    <div key={gap} style={CONTEXT_RECORD_NARRATIVE}>{readableGapLabel(gap)}</div>
                  ))}
                    </div>
                  )}
                </details>
              )}
            </div>
          </Section>
        )}

        {codeReviewSubmission && (
          <Section
            title="Candidate review result"
            icon={<CheckCircle size={15} />}
            style={CODE_REVIEW_RESULT_SECTION}
          >
            <div data-testid="interview-code-review-result" style={EVIDENCE_LIST}>
              {codeReviewSubmission.verdict && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Verdict</span>
                  <span style={FIELD_VALUE}>{titleCaseToken(codeReviewSubmission.verdict)}</span>
                </div>
              )}
              {codeReviewSubmission.summary && (
                <div style={{ ...EVIDENCE_ROW, alignItems: 'flex-start' }}>
                  <span style={FIELD_LABEL}>Summary</span>
                  <span style={{ ...FIELD_VALUE, lineHeight: 1.6 }}>{codeReviewSubmission.summary}</span>
                </div>
              )}
              <div style={EVIDENCE_ROW}>
                <span style={FIELD_LABEL}>Annotations</span>
                <span style={FIELD_VALUE}>
                  {codeReviewSubmission.annotations.length} {codeReviewSubmission.annotations.length === 1 ? 'annotation' : 'annotations'}
                </span>
              </div>
              {codeReviewSubmission.annotations.length > 0 && (
                <details data-testid="interview-code-review-annotations" style={DETAILS_CARD}>
                  <summary style={DETAILS_SUMMARY}>
                    Review annotations
                    <span style={DETAILS_HINT}>
                      {countLabel(codeReviewSubmission.annotations.length, 'line comment')}
                    </span>
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {codeReviewSubmission.annotations.map((annotation, index) => (
                      <div key={`${annotation.file}:${annotation.line ?? 'x'}:${index}`} style={CONTEXT_RECORD}>
                        <div style={TRANSCRIPT_ROLE}>
                          {annotation.file}
                          {annotation.line !== null ? ` · line ${annotation.line}` : ''}
                          {annotation.severity ? ` · ${annotation.severity}` : ''}
                        </div>
                        <div style={TRANSCRIPT_TEXT}>{annotation.comment}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {codeReviewSubmission.defenseThreads.length > 0 && (
                <details data-testid="interview-code-review-defense-threads" style={DETAILS_CARD}>
                  <summary style={DETAILS_SUMMARY}>
                    Review interaction
                    <span style={DETAILS_HINT}>candidate comments and AI developer pushback</span>
                  </summary>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {codeReviewSubmission.defenseThreads.slice(0, 4).map((thread) => (
                      <div key={thread.commentId} style={DEFENSE_THREAD}>
                        <div style={TRANSCRIPT_ROLE}>
                          Candidate comment
                          {thread.line !== null ? ` · line ${thread.line}` : ''}
                          {thread.severity ? ` · ${thread.severity}` : ''}
                        </div>
                        <div style={TRANSCRIPT_TEXT}>{thread.comment}</div>
                        {thread.file && (
                          <div style={TRANSCRIPT_TIME}>{thread.file}</div>
                        )}
                        <div style={DEFENSE_EXCHANGE_LIST}>
                          {thread.exchanges.map((exchange, index) => (
                            <div
                              key={`${thread.commentId}:${exchange.actor}:${exchange.round ?? 'x'}:${index}`}
                              style={exchange.actor === 'ai_developer' ? DEFENSE_EXCHANGE_AI : DEFENSE_EXCHANGE_CANDIDATE}
                            >
                              <div style={TRANSCRIPT_ROLE}>
                                {exchange.actor === 'ai_developer' ? 'AI developer' : 'Candidate defense'}
                                {exchange.move ? ` · ${exchange.move}` : ''}
                                {exchange.round !== null ? ` · round ${exchange.round}` : ''}
                              </div>
                              <div style={TRANSCRIPT_TEXT}>{exchange.content}</div>
                              {exchange.updatedCode && (
                                <pre style={DEFENSE_CODE}>{exchange.updatedCode}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </Section>
        )}
      </main>

    </div>
  );
}

const HEADER: CSSProperties = recruiterHeaderStyle;

const PAGE: CSSProperties = recruiterPageStyle;

const ROOM_PANEL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 420px)',
  gap: 22,
  alignItems: 'center',
  border: '1px solid var(--pipe-accent-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 20,
  boxShadow: '0 18px 42px var(--pipe-shadow)',
};

const WORKSPACE_CONFIG_PANEL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 560px)',
  gap: 18,
  alignItems: 'center',
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

const ASSESSMENT_PROGRESS_PANEL: CSSProperties = {
  display: 'grid',
  gap: 14,
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

const WORKSPACE_ASSESSMENT_DECISION_SECTION: CSSProperties = {
  display: 'grid',
  gap: 14,
  border: '1px solid rgba(96,165,250,0.32)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
  boxShadow: '0 18px 42px var(--pipe-shadow)',
};

const ASSESSMENT_PROGRESS_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 10,
};

const ASSESSMENT_PROGRESS_CARD: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 7,
  minWidth: 0,
  minHeight: 86,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
  padding: 12,
};

const ASSESSMENT_PROGRESS_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
};

const ASSESSMENT_PROGRESS_DETAIL: CSSProperties = {
  display: 'grid',
  gap: 8,
  borderTop: '1px solid var(--pipe-border)',
  paddingTop: 12,
};

const ASSESSMENT_CHALLENGE_CONTRACT: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
};

const ASSESSMENT_CHALLENGE_META: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 11,
  lineHeight: 1.5,
};

const ASSESSMENT_CHALLENGE_SECTION: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
};

const ASSESSMENT_CHALLENGE_TEXT: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
};

const ASSESSMENT_CHALLENGE_LIST: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.55,
};

const ASSESSMENT_COVERAGE_CHIPS: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const ASSESSMENT_COVERAGE_OK: CSSProperties = {
  ...recruiterTagStyle,
  borderColor: 'rgba(74,222,128,0.32)',
  background: 'rgba(74,222,128,0.08)',
  color: '#86efac',
};

const ASSESSMENT_COVERAGE_MISSING: CSSProperties = {
  ...recruiterTagStyle,
  borderColor: 'rgba(248,113,113,0.36)',
  background: 'rgba(248,113,113,0.08)',
  color: '#fca5a5',
};

const ASSESSMENT_CLAIM_LIST: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const ASSESSMENT_CLAIM_ROW: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
  padding: 10,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
};

const ASSESSMENT_DIAGNOSTIC_ROW: CSSProperties = {
  ...ASSESSMENT_CLAIM_ROW,
  borderColor: 'rgba(251,191,36,0.35)',
  background: 'rgba(251,191,36,0.07)',
};

const ASSESSMENT_CLAIM_HEAD: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const ASSESSMENT_CLAIM_NARRATIVE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 12,
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
};

const ASSESSMENT_CLAIM_SOURCES: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.45,
};

const WORKSPACE_CONFIG_FORM: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  minWidth: 0,
};

const FOLLOW_UP_PLAN_SECTION: CSSProperties = {
  border: '1px solid rgba(96,165,250,0.32)',
  borderRadius: 8,
  background: 'rgba(96,165,250,0.08)',
  padding: 18,
};

const FOLLOW_UP_PLAN_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(240px, 0.85fr)',
  gap: 12,
  minWidth: 0,
};

const FOLLOW_UP_PLAN_PRIMARY: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  padding: 14,
  border: '1px solid rgba(96,165,250,0.28)',
  borderRadius: 6,
  background: 'rgba(12,12,14,0.28)',
};

const FOLLOW_UP_PLAN_META: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
};

const FOLLOW_UP_QUESTION_LIST: CSSProperties = {
  display: 'grid',
  gap: 7,
  marginTop: 12,
  paddingTop: 12,
  borderTop: '1px solid rgba(96,165,250,0.24)',
};

const WORKSPACE_INPUT: CSSProperties = {
  minWidth: 0,
  width: '100%',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  padding: '10px 12px',
  fontFamily: FONT,
  fontSize: 11,
};

const HUMAN_DECISION_FORM: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
  padding: 12,
  border: '1px solid rgba(74,222,128,0.26)',
  borderRadius: 6,
  background: 'rgba(74,222,128,0.06)',
};

const HUMAN_DECISION_FORM_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px minmax(0, 1fr)',
  gap: 10,
  minWidth: 0,
};

const HUMAN_DECISION_FIELD: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
};

const HUMAN_DECISION_TEXTAREA: CSSProperties = {
  ...WORKSPACE_INPUT,
  minHeight: 84,
  resize: 'vertical',
  lineHeight: 1.5,
};

const HUMAN_DECISION_ACTION_ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
};

const ROOM_TITLE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 20,
  lineHeight: 1.25,
  letterSpacing: 0,
};

const EVIDENCE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 14,
  minWidth: 0,
};

const EVIDENCE_LIST: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const EVIDENCE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '96px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'baseline',
};

const SECTION: CSSProperties = recruiterSectionStyle;

const CODE_REVIEW_ASSIGNMENT_SECTION: CSSProperties = {
  order: -30,
};

const CODE_REVIEW_DECISION_SECTION: CSSProperties = {
  order: -40,
  gridColumn: '1 / -1',
};

const CODE_REVIEW_MATCH_SECTION: CSSProperties = {
  order: -20,
};

const CODE_REVIEW_RESULT_SECTION: CSSProperties = {
  order: -10,
};

const CODE_REVIEW_OPERATIONAL_SECTION: CSSProperties = {
  order: 20,
};

const CODE_REVIEW_CALL_RECORD_SECTION: CSSProperties = {
  order: 30,
};

const CODE_REVIEW_PERSON_CONTEXT_SECTION: CSSProperties = {
  order: 40,
};

const SECTION_TITLE: CSSProperties = recruiterSectionTitleStyle;

const FIELD_LABEL: CSSProperties = recruiterFieldLabelStyle;

const FIELD_VALUE: CSSProperties = recruiterFieldValueStyle;

const EYEBROW: CSSProperties = recruiterEyebrowStyle;

const TITLE: CSSProperties = recruiterTitleStyle;

const SUBTITLE: CSSProperties = recruiterSubtitleStyle;

const ACTION_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
};

const BACK_BUTTON: CSSProperties = recruiterBackButtonStyle;

const PRIMARY_BUTTON: CSSProperties = recruiterPrimaryButtonStyle;

const TEXT_BUTTON: CSSProperties = recruiterTextButtonStyle;

const INLINE_LINK: CSSProperties = recruiterInlineLinkStyle;

const ROOM_ACTIONS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 10,
};

const ROOM_PRIMARY_BUTTON: CSSProperties = {
  justifyContent: 'center',
  width: '100%',
  borderColor: 'var(--pipe-accent-border)',
  background: 'var(--pipe-accent-surface)',
};

const ROOM_SECONDARY_BUTTON: CSSProperties = {
  justifyContent: 'center',
  width: '100%',
};

const ROOM_LINK_TEXT: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.5,
};

const ASSESSMENT_INVITE_STATE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 8,
  marginTop: 14,
};

const ASSESSMENT_INVITE_STATE_ITEM: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 10,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
};

const ASSESSMENT_INVITE_STATE_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.45,
};

const ROOM_GUEST_LINK_LABEL: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const ROOM_GUEST_LINK_TEXT: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
};

const ROOM_GUEST_LINK_INPUT: CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.4,
  padding: '10px 11px',
};

const ERROR_NOTE: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  border: '1px solid rgba(248,113,113,0.35)',
  background: 'rgba(248,113,113,0.08)',
  color: '#fca5a5',
  fontSize: 11,
  lineHeight: 1.5,
};

const SUCCESS_NOTE: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  border: '1px solid rgba(74,222,128,0.35)',
  background: 'rgba(74,222,128,0.08)',
  color: '#86efac',
  fontSize: 11,
  lineHeight: 1.5,
};

const NOTE: CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 6,
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.6,
};

const SMALL_NOTE: CSSProperties = {
  marginTop: 10,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.5,
};

const ANALYSIS_GROUP: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 14,
};

const TAG_ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const TAG: CSSProperties = recruiterTagStyle;

const EMPTY_TEXT: CSSProperties = recruiterEmptyTextStyle;

const TRANSCRIPT_ROW: CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const TRANSCRIPT_ROLE: CSSProperties = {
  width: 82,
  flexShrink: 0,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const TRANSCRIPT_TEXT: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 13,
  lineHeight: 1.6,
};

const TRANSCRIPT_TIME: CSSProperties = {
  marginTop: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
};

const CONTEXT_METRICS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 1,
  overflow: 'hidden',
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-border)',
  marginBottom: 14,
};

const CONTEXT_METRIC: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 12,
  background: 'var(--pipe-surface)',
};

const CONTEXT_METRIC_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1,
};

const CONTEXT_METRIC_LABEL: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const RELATED_EVIDENCE_LIST: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const RELATED_EVIDENCE_SCOPE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 10,
  minWidth: 0,
  padding: '8px 10px',
  border: '1px solid var(--pipe-border)',
  borderRadius: 5,
  background: 'rgba(96,165,250,0.06)',
};

const RELATED_EVIDENCE_SUMMARY: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
  alignItems: 'stretch',
  minWidth: 0,
  padding: 12,
  border: '1px solid rgba(96,165,250,0.26)',
  borderRadius: 6,
  background: 'rgba(96,165,250,0.08)',
};

const RELATED_EVIDENCE_NEXT_ACTION: CSSProperties = {
  marginTop: 8,
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.45,
};

const RELATED_EVIDENCE_METRICS: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(72px, 1fr)',
  gap: 1,
  overflow: 'hidden',
  minWidth: 0,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-border)',
};

const RELATED_EVIDENCE_METRIC: CSSProperties = {
  display: 'grid',
  gap: 6,
  alignContent: 'center',
  minWidth: 0,
  padding: 10,
  background: 'rgba(12,20,34,0.76)',
};

const RELATED_EVIDENCE_PROFILE_BUTTON: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  border: '1px solid rgba(96,165,250,0.36)',
  borderRadius: 5,
  background: 'rgba(96,165,250,0.08)',
  color: 'var(--pipe-info)',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const RELATED_EVIDENCE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
  width: '100%',
  minWidth: 0,
  padding: 10,
  border: '1px solid var(--pipe-border)',
  borderRadius: 5,
  background: 'rgba(255,255,255,0.03)',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const RELATED_EVIDENCE_MAIN: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
};

const CONTEXT_RECORD: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const CONTEXT_RECORD_NARRATIVE: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.55,
};

const DECISION_SUMMARY: CSSProperties = {
  display: 'grid',
  gap: 14,
  minWidth: 0,
};

const DECISION_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 14,
  minWidth: 0,
};

const DECISION_TITLE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 24,
  fontWeight: 800,
  lineHeight: 1.2,
  letterSpacing: 0,
  overflowWrap: 'anywhere',
};

const DECISION_ACTION: CSSProperties = {
  maxWidth: 880,
  color: 'var(--pipe-text)',
  fontSize: 14,
  lineHeight: 1.65,
};

const DECISION_COCKPIT: CSSProperties = {
  display: 'grid',
  gap: 9,
  minWidth: 0,
  padding: 12,
  border: '1px solid rgba(96,165,250,0.28)',
  borderRadius: 6,
  background: 'rgba(96,165,250,0.06)',
};

const DECISION_COCKPIT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 8,
  minWidth: 0,
};

const DECISION_COCKPIT_ITEM: CSSProperties = {
  display: 'grid',
  gap: 6,
  alignContent: 'start',
  minWidth: 0,
  minHeight: 126,
  padding: 11,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_COCKPIT_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

const DECISION_COCKPIT_DETAIL: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontSize: 11,
  lineHeight: 1.45,
};

const DECISION_NEXT_STEP: CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: 14,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_NEXT_STEP_TONE: Record<CodeReviewNextStepTone, CSSProperties> = {
  positive: {
    borderColor: 'rgba(74,222,128,0.32)',
    background: 'rgba(74,222,128,0.08)',
  },
  watch: {
    borderColor: 'rgba(251,191,36,0.36)',
    background: 'rgba(251,191,36,0.08)',
  },
  blocked: {
    borderColor: 'rgba(248,113,113,0.34)',
    background: 'rgba(248,113,113,0.08)',
  },
  neutral: {
    borderColor: 'rgba(96,165,250,0.28)',
    background: 'rgba(96,165,250,0.08)',
  },
};

const DECISION_NEXT_STEP_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.25,
  overflowWrap: 'anywhere',
};

const DECISION_MATCH_EXPLANATION: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 14,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_MATCH_EXPLANATION_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 8,
  minWidth: 0,
};

const DECISION_MATCH_EXPLANATION_ITEM: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
  padding: 10,
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  background: 'rgba(5,10,20,0.32)',
};

const DECISION_RISK_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
};

const DECISION_RISK_CARD: CSSProperties = {
  display: 'grid',
  gap: 7,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_RISK_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

const DECISION_RISK_LIST: CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  color: 'var(--pipe-text-muted)',
  fontSize: 12,
  lineHeight: 1.55,
};

const DECISION_SCORE_SUMMARY: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 14,
  border: '1px solid rgba(74,222,128,0.28)',
  borderRadius: 6,
  background: 'rgba(74,222,128,0.08)',
};

const DECISION_SCORE_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
};

const DECISION_SCORE_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1.15,
  overflowWrap: 'anywhere',
};

const DECISION_SCORE_BASIS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 8,
};

const DECISION_SCORE_BASIS_ITEM_OK: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 10,
  border: '1px solid rgba(74,222,128,0.28)',
  borderRadius: 6,
  background: 'rgba(74,222,128,0.08)',
};

const DECISION_SCORE_BASIS_ITEM_MISSING: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 10,
  border: '1px solid rgba(251,191,36,0.3)',
  borderRadius: 6,
  background: 'rgba(251,191,36,0.08)',
};

const DECISION_SCORE_BASIS_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
};

const DECISION_SCORE_COLUMNS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
  paddingTop: 2,
};

const DECISION_SCORE_COLUMN: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
};

const DECISION_FOLLOW_UP: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 4,
  borderTop: '1px solid var(--pipe-border)',
};

const DECISION_FOLLOW_UP_LIST: CSSProperties = {
  display: 'grid',
  gap: 10,
  margin: 0,
  padding: 0,
};

const DECISION_FOLLOW_UP_ITEM: CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  fontSize: 13,
  lineHeight: 1.55,
};

const DECISION_PLAN_SIGNAL: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
};

const CONTEXT_CALL_BUTTON: CSSProperties = {
  width: 'fit-content',
  marginTop: 4,
  borderColor: 'rgba(96,165,250,0.38)',
  background: 'rgba(96,165,250,0.12)',
  color: '#bfdbfe',
};

const DECISION_SIGNAL_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 10,
};

const DECISION_SIGNAL_CARD: CSSProperties = {
  display: 'grid',
  gap: 7,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_SIGNAL_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.25,
  overflowWrap: 'anywhere',
};

const MATCH_DECISION_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
};

const MATCH_DECISION_CARD: CSSProperties = {
  display: 'grid',
  gap: 7,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-accent-border)',
  borderRadius: 6,
  background: 'var(--pipe-accent-surface)',
};

const MATCH_DECISION_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.1,
  overflowWrap: 'anywhere',
};

const DETAILS_CARD: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DETAILS_SUMMARY: CSSProperties = {
  cursor: 'pointer',
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const DETAILS_HINT: CSSProperties = {
  display: 'block',
  marginTop: 5,
  color: 'var(--pipe-text-dim)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: 'none',
};

const MATCH_BADGE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 7px',
  borderRadius: 5,
  border: '1px solid rgba(74,222,128,0.3)',
  background: 'rgba(74,222,128,0.08)',
  color: '#86efac',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.1em',
};

const MATCH_METRIC_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 10,
  alignItems: 'center',
  padding: '10px 0',
  borderTop: '1px solid var(--pipe-border)',
};

const MATCH_QUALITY_BODY: CSSProperties = {
  display: 'grid',
  gap: 10,
  paddingTop: 12,
};

const MATCH_SCORE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const MATCH_BRIDGE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
};

const MATCH_BRIDGE_CARD: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface-solid)',
};

const DEFENSE_THREAD: CSSProperties = {
  display: 'grid',
  gap: 8,
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface-solid)',
};

const DEFENSE_EXCHANGE_LIST: CSSProperties = {
  display: 'grid',
  gap: 8,
  paddingTop: 4,
};

const DEFENSE_EXCHANGE_AI: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  border: '1px solid rgba(96,165,250,0.28)',
  borderRadius: 6,
  background: 'rgba(96,165,250,0.08)',
};

const DEFENSE_EXCHANGE_CANDIDATE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  border: '1px solid rgba(74,222,128,0.28)',
  borderRadius: 6,
  background: 'rgba(74,222,128,0.07)',
};

const DEFENSE_CODE: CSSProperties = {
  margin: 0,
  padding: 10,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'rgba(0,0,0,0.24)',
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const CENTERED: CSSProperties = {
  minHeight: '55vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
};
