import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Mail, Video, Loader2, Radio } from 'lucide-react';
import { INTERVIEW_TYPE_LABELS, type ScheduledInterview } from '../../lib/scheduling/types';
import { InterviewStatusBadge } from './InterviewStatusBadge';
import { StatusOverrideModal } from './StatusOverrideModal';
import { InviteToCallModal } from './InviteToCallModal';
import { useApiClient } from '../../hooks/useApiClient';
import type { InterviewStatus } from '../../lib/scheduling/types';
import {
  summarizeAssessmentChallenge,
  summarizeResolvedAssessmentAssignment,
  type AssessmentAssignmentSummary,
} from '../../lib/scheduling/assessmentChallenge';

// TODO: Wire candidateName and pipelineTitle via enriched data once we join
// across models. For MVP these are passed as props by SchedulingDashboard which
// pre-fetches candidates and pipelines.
interface InterviewCardProps {
  interview: ScheduledInterview;
  candidateName: string;
  candidateEmail?: string | null;
  pipelineTitle: string;
  stageTitle: string;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string | undefined;
      meetingUrl?: string | undefined;
      recruiterNotes?: string | undefined;
    }
  ) => Promise<void>;
  sendInvite: (id: string, email: string, message?: string) => Promise<void>;
  startAssessmentEvaluation?: (id: string) => Promise<AssessmentEvaluationStartResult | void>;
}

interface AssessmentEvaluationStartResult {
  progress?: {
    stage: string;
    nextAction: string;
  };
  report?: unknown | null;
  diagnostic?: {
    code?: string;
    severity?: string;
  } | null;
  accepted?: boolean;
  backgrounded?: boolean;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ASSESSMENT_INTERVIEW_TYPES = new Set(['CODE_REVIEW', 'DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX']);

function providerEventLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function isJoinable(interview: ScheduledInterview): boolean {
  // Allow host to join for both INVITED and SCHEDULED statuses
  if (interview.status !== 'SCHEDULED' && interview.status !== 'INVITED') return false;
  // INVITED interviews are always joinable (manual/direct calls)
  if (interview.status === 'INVITED') return true;
  if (!interview.scheduledAt) return false;
  const diff = new Date(interview.scheduledAt).getTime() - Date.now();
  // Joinable within 15 minutes before or any time after the start
  return diff <= FIFTEEN_MINUTES_MS;
}

function sentenceCaseToken(value: string): string {
  const normalized = value.toLowerCase().replace(/_/g, ' ').trim();
  if (!normalized) return value;
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function compactText(value: string, maxLength = 150): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
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

function assessmentEvaluationRecommendationLabel(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  switch (recommendation.trim()) {
    case 'strong_evidence_to_advance':
      return 'Strong evidence to advance';
    case 'mixed_evidence_human_review':
      return 'Human review needed';
    case 'insufficient_evidence':
      return 'Insufficient evidence';
    case 'not_demonstrated':
      return 'Not demonstrated';
    default:
      return sentenceCaseToken(recommendation);
  }
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
  return compactText(value, 56);
}

function shortCommitSha(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 12 ? trimmed.slice(0, 12) : trimmed;
}

function workspaceSessionSummary(interview: ScheduledInterview): string | null {
  const workspace = interview.workspaceSession ?? null;
  if (!workspace) return null;
  const status = sentenceCaseToken(workspace.status);
  if (workspace.errorMessage) return `${status}: ${compactText(workspace.errorMessage, 96)}`;
  const repo = repoLabelFromUrl(workspace.repoGitUrl);
  const base = shortCommitSha(workspace.baseCommitSha);
  const details = [repo, base ? `base ${base}` : null].filter((value): value is string => Boolean(value));
  return details.length > 0 ? `${status} · ${details.join(' · ')}` : status;
}

function roomStateSummary(interview: ScheduledInterview): string | null {
  const roomStatus = interview.roomStatus ? sentenceCaseToken(interview.roomStatus) : null;
  const guestState = interview.guestWaiting ? 'guest waiting' : null;
  const parts = [roomStatus, guestState].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' · ') : null;
}

function isAssessmentInterviewType(value: ScheduledInterview['interviewType']): boolean {
  return typeof value === 'string' && ASSESSMENT_INTERVIEW_TYPES.has(value);
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
    || input.hasTestEvidence
    || input.hasVerificationGap,
  );
  const ready = [
    input.hasChallengePacket ? 'challenge' : null,
    input.hasMessageEvidence ? 'chat' : null,
    input.hasDevContainerEvidence ? 'workspace telemetry' : null,
    input.hasToolUsageEvidence ? 'tool activity' : null,
    input.hasWorkEvidence && !hasGranularWorkEvidence ? 'work evidence' : null,
    input.hasCommitSubmission ? 'commit' : null,
    input.hasAiInteraction ? 'AI use' : null,
    input.hasTranscriptEvidence ? 'transcript' : null,
    input.hasTestEvidence ? 'tests' : null,
    input.hasVerificationGap ? 'verification gap' : null,
  ].filter((value): value is string => Boolean(value));
  return ready.length > 0 ? ready.join(', ') : 'no evidence yet';
}

function assessmentAssignmentColor(
  tone: AssessmentAssignmentSummary['tone'],
): string {
  switch (tone) {
    case 'matched':
      return '#4ade80';
    case 'manual':
      return '#fbbf24';
    case 'blocked':
      return '#f87171';
    case 'waiting':
      return '#93c5fd';
    default:
      return 'var(--pipe-text)';
  }
}

interface AssessmentDecisionSummary {
  value: string;
  detail: string;
}

interface AssessmentCommitTrustSummary {
  label: string;
  detail: string;
  tone: 'verified' | 'warning' | 'neutral';
}

interface AssessmentPacketContractSummary {
  label: string;
  detail: string;
  tone: 'verified' | 'warning' | 'neutral';
}

interface AssessmentReviewArtifactSummary {
  label: string;
  detail: string;
  tone: 'verified' | 'warning' | 'neutral';
}

interface AssessmentProofChecklistSummary {
  required: string[];
  confidence: string[];
  missingRequiredCount: number;
}

type AssessmentEvaluation = NonNullable<NonNullable<ScheduledInterview['assessmentProgress']>['evaluation']>;
type AssessmentEvaluationClaim = NonNullable<AssessmentEvaluation['claims']>[number];
type AssessmentEvaluationDiagnostic = NonNullable<AssessmentEvaluation['diagnostics']>[number];
type AssessmentEvidenceCoverage = NonNullable<AssessmentEvaluation['evidenceCoverage']>;
type AssessmentEvidenceCoverageItem = AssessmentEvidenceCoverage['requiredForEvaluation'][number];

function assessmentSourceRefTypeLabel(sourceRefType: string): string {
  switch (sourceRefType) {
    case 'ai_user_prompt':
      return 'AI prompt';
    case 'ai_user_prompt_blocked':
      return 'Blocked AI prompt';
    case 'ai_agent_response':
      return 'Agent response';
    case 'ai_usage_event':
      return 'AI evaluator trace';
    default:
      return sentenceCaseToken(sourceRefType);
  }
}

function sourceRefSummary(count: number, types: string[]): string {
  const refLabel = `${count} source ref${count === 1 ? '' : 's'}`;
  const visibleTypes = types
    .map(assessmentSourceRefTypeLabel)
    .slice(0, 3);
  if (visibleTypes.length === 0) return refLabel;
  const suffix = types.length > visibleTypes.length ? ' +' : '';
  return `${refLabel}: ${visibleTypes.join(', ')}${suffix}`;
}

function assessmentClaimToneColor(polarity: string): string {
  switch (polarity) {
    case 'positive':
      return '#4ade80';
    case 'negative':
      return '#f87171';
    case 'neutral':
      return '#93c5fd';
    case 'diagnostic':
      return '#fbbf24';
    default:
      return 'var(--pipe-text-dim)';
  }
}

function assessmentDiagnosticToneColor(severity: string): string {
  switch (severity) {
    case 'blocking':
    case 'error':
      return '#f87171';
    case 'warning':
      return '#fbbf24';
    default:
      return '#93c5fd';
  }
}

function assessmentEvaluationClaims(
  evaluation: AssessmentEvaluation | null | undefined,
): AssessmentEvaluationClaim[] {
  return (evaluation?.claims ?? [])
    .filter((claim) => claim.sourceRefCount > 0)
    .slice(0, 3);
}

function assessmentEvaluationDiagnostics(
  evaluation: AssessmentEvaluation | null | undefined,
): AssessmentEvaluationDiagnostic[] {
  return (evaluation?.diagnostics ?? []).slice(0, 4);
}

function assessmentEvaluationDiagnosticCodes(
  evaluation: AssessmentEvaluation | null | undefined,
): Set<string> {
  return new Set((evaluation?.diagnostics ?? []).map((diagnostic) => diagnostic.code));
}

function assessmentEvaluationNeedsHumanCorrectnessReview(
  evaluation: AssessmentEvaluation | null | undefined,
): boolean {
  const codes = assessmentEvaluationDiagnosticCodes(evaluation);
  return evaluation?.recommendation === 'mixed_evidence_human_review'
    || codes.has('MODEL_CLAIMS_UNUSABLE')
    || codes.has('HUMAN_CORRECTNESS_REVIEW_REQUIRED');
}

function assessmentCoverageGaps(
  coverage: AssessmentEvidenceCoverage | null | undefined,
): AssessmentEvidenceCoverageItem[] {
  if (!coverage) return [];
  return [
    ...coverage.requiredForEvaluation,
    ...coverage.expectedForHighConfidence,
  ].filter((item) => !item.satisfied).slice(0, 4);
}

function assessmentDecisionSummary(input: {
  setup: ScheduledInterview['assessmentSetup'] | null;
  progress: ScheduledInterview['assessmentProgress'] | null;
}): AssessmentDecisionSummary | null {
  const { setup, progress } = input;

  if (progress?.humanDecision) {
    return {
      value: assessmentHumanDecisionLabel(progress.humanDecision.decision),
      detail: compactText(progress.humanDecision.summary, 150),
    };
  }

  if (progress?.evaluation) {
    const status = progress.evaluation.status.toUpperCase();
    if (status === 'EVALUATED') {
      const needsHumanReview = assessmentEvaluationNeedsHumanCorrectnessReview(progress.evaluation);
      return {
        value: needsHumanReview
          ? 'Human review required'
          : assessmentEvaluationRecommendationLabel(progress.evaluation.recommendation) ?? 'Evaluated',
        detail: compactText(
          needsHumanReview
            ? `${progress.evaluation.summary || 'Source-backed report is reviewable.'} Inspect the diff before deciding.`
            : progress.evaluation.summary
              || 'Review the source-backed evaluation report before advancing the candidate.',
          150,
        ),
      };
    }

    return {
      value: 'Evaluation needs attention',
      detail: compactText(
        progress.evaluation.summary
        || `Evaluation is ${sentenceCaseToken(progress.evaluation.status)}; resolve diagnostics before using it as a hiring signal.`,
        150,
      ),
    };
  }

  if (progress?.readiness) {
    if (progress.readiness.status === 'NEEDS_ATTENTION') {
      return {
        value: progress.readiness.label,
        detail: compactText(progress.readiness.detail, 150),
      };
    }
    if (progress.readiness.isReadyForEvaluation) {
      return {
        value: progress.readiness.label,
        detail: compactText(progress.readiness.detail, 150),
      };
    }
    if (progress.readiness.status !== 'WAITING_FOR_CHALLENGE') {
      return {
        value: progress.readiness.label,
        detail: compactText(progress.readiness.detail, 150),
      };
    }
  }

  if (progress?.nextAction === 'RESOLVE_DIAGNOSTIC' || progress?.stage === 'NEEDS_ATTENTION') {
    return {
      value: 'Needs attention',
      detail: compactText(progress.nextActionLabel || 'Resolve the assessment diagnostic before evaluation.', 150),
    };
  }

  if (progress?.nextAction === 'START_EVALUATION' || progress?.stage === 'READY_FOR_EVALUATION') {
    return {
      value: 'Ready for evaluation',
      detail: 'Challenge and commit evidence are captured; run source-backed AI or human evaluation.',
    };
  }

  if (progress?.hasCommitSubmission) {
    return {
      value: 'Commit submitted',
      detail: 'Run source-backed evaluation before using this as a hiring signal.',
    };
  }

  if (progress?.hasChallengePacket || setup?.status === 'reviewable_task_assigned') {
    return {
      value: 'Task assigned',
      detail: 'Waiting for candidate workspace evidence and assessment-branch commit.',
    };
  }

  if (setup?.blocksPositiveAssessment) {
    return {
      value: 'Setup gap',
      detail: compactText(setup.message || 'PIPE needs source-backed evidence before this can become an assessment.', 150),
    };
  }

  return null;
}

function assessmentCommitTrustSummary(
  commit: NonNullable<ScheduledInterview['assessmentProgress']>['commit'] | null | undefined,
): AssessmentCommitTrustSummary | null {
  if (!commit) return null;
  const labels = [
    commit.integrity?.label,
    commit.challengeBinding?.label,
  ].filter((value): value is string => Boolean(value?.trim()));
  const details = [
    commit.integrity?.detail,
    commit.challengeBinding?.detail,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (labels.length === 0 && details.length === 0) return null;

  const hasWarning = commit.integrity?.tone === 'warning' || commit.challengeBinding?.tone === 'warning';
  const hasVerified = commit.integrity?.tone === 'verified' || commit.challengeBinding?.tone === 'verified';
  return {
    label: labels.length > 0 ? labels.join(' · ') : 'Commit provenance captured',
    detail: compactText(details.join(' '), 180),
    tone: hasWarning ? 'warning' : hasVerified ? 'verified' : 'neutral',
  };
}

function assessmentCommitTrustColor(tone: AssessmentCommitTrustSummary['tone']): string {
  switch (tone) {
    case 'verified':
      return '#4ade80';
    case 'warning':
      return '#fbbf24';
    default:
      return 'var(--pipe-text-dim)';
  }
}

function assessmentSourceRefCount(
  progress: ScheduledInterview['assessmentProgress'] | null | undefined,
  kind: string,
): number {
  return progress?.sourceRefCounts?.find((row) => row.kind === kind)?.count ?? 0;
}

function assessmentReviewArtifactSummary(
  progress: ScheduledInterview['assessmentProgress'] | null | undefined,
): AssessmentReviewArtifactSummary | null {
  const commit = progress?.commit ?? null;
  if (!commit) return null;
  if (commit.commitUrl) {
    return {
      label: 'GitHub commit available',
      detail: 'External commit URL is captured; open detail to compare base to submitted work.',
      tone: 'verified',
    };
  }

  if (assessmentSourceRefCount(progress, 'code_diff') > 0) {
    return {
      label: 'Captured diff available',
      detail: 'Workspace-only commit has exact code_diff source evidence ready for review.',
      tone: 'verified',
    };
  }

  return {
    label: 'Review artifact missing',
    detail: 'Commit exists, but PIPE has no remote commit URL or captured code_diff source evidence.',
    tone: 'warning',
  };
}

function assessmentPacketContractSummary(
  contract: NonNullable<ScheduledInterview['assessmentProgress']>['challengePacketContract'] | null | undefined,
): AssessmentPacketContractSummary | null {
  if (!contract) return null;
  if (contract.isComplete) {
    return {
      label: 'Complete challenge packet',
      detail: 'Repo, base commit, task, success criteria, and expected evidence are captured.',
      tone: 'verified',
    };
  }
  const missingFields = contract.missingFields
    .map((field) => sentenceCaseToken(field))
    .join(', ');
  return {
    label: 'Incomplete challenge packet',
    detail: missingFields
      ? `Missing ${missingFields}. Complete the packet before candidate work starts.`
      : 'Complete the repo URL, base commit, task, success criteria, and expected evidence before candidate work starts.',
    tone: 'warning',
  };
}

function assessmentPacketContractColor(tone: AssessmentPacketContractSummary['tone']): string {
  switch (tone) {
    case 'verified':
      return '#4ade80';
    case 'warning':
      return '#fbbf24';
    default:
      return 'var(--pipe-text-dim)';
  }
}

function assessmentProofItemLabel(
  item: NonNullable<NonNullable<ScheduledInterview['assessmentProgress']>['readiness']>['required'][number],
): string {
  return `${item.satisfied ? 'Captured' : 'Missing'}: ${item.label}`;
}

function assessmentProofChecklistSummary(
  readiness: NonNullable<ScheduledInterview['assessmentProgress']>['readiness'] | null | undefined,
): AssessmentProofChecklistSummary | null {
  if (!readiness) return null;

  const required = readiness.required.map(assessmentProofItemLabel);
  const confidence = readiness.confidence.map(assessmentProofItemLabel);

  if (required.length === 0 && confidence.length === 0) return null;

  return {
    required,
    confidence,
    missingRequiredCount: readiness.missingRequiredCount,
  };
}

function assessmentEvaluationStartNotice(result: AssessmentEvaluationStartResult | void): string {
  if (result?.report) return 'Source-backed assessment report is ready.';
  if (result?.diagnostic) {
    const diagnosticLabel = sentenceCaseToken(result.diagnostic.code ?? 'diagnostic')
      .replace(/\bai\b/g, 'AI')
      .replace(/\bAi\b/g, 'AI')
      .replace(/\bapi\b/g, 'API')
      .replace(/\bApi\b/g, 'API');
    return `Evaluation needs attention: ${diagnosticLabel}.`;
  }
  if (result?.progress?.stage === 'EVALUATING' || result?.progress?.nextAction === 'WAIT_FOR_EVALUATION') {
    return 'Source-backed assessment evaluation is running.';
  }
  return 'Source-backed assessment evaluation requested.';
}

export function InterviewCard({
  interview,
  candidateName,
  candidateEmail,
  pipelineTitle,
  stageTitle,
  updateStatus,
  sendInvite,
  startAssessmentEvaluation,
}: InterviewCardProps): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isStartingAssessmentEvaluation, setIsStartingAssessmentEvaluation] = useState(false);
  const [assessmentEvaluationNotice, setAssessmentEvaluationNotice] = useState<string | null>(null);
  const [assessmentEvaluationError, setAssessmentEvaluationError] = useState<string | null>(null);

  const joinable = isJoinable(interview);
  const guestWaiting = interview.guestWaiting ?? false;
  const now = Date.now();
  const scheduled = interview.scheduledAt ? new Date(interview.scheduledAt).getTime() : null;

  // Determine dot color
  let dotColor = 'var(--pipe-text-dim)'; // Default: dim for past/unscheduled
  if (scheduled && scheduled > now) {
    const minutesUntil = (scheduled - now) / 1000 / 60;
    if (minutesUntil <= 15) {
      dotColor = '#10b981'; // Green: joinable soon
    } else {
      dotColor = '#f59e0b'; // Amber: upcoming
    }
  }

  const handleJoinRoom = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    if (!interview.meetingId) {
      navigate(`/interviews/${interview.id}`);
      return;
    }
    setIsJoining(true);
    try {
      const result = await api.post<{ room: { hostUrl: string } }>(
        `/api/v1/meetings/${interview.meetingId}/room`,
        {},
      );
      if (result.room?.hostUrl) {
        window.open(result.room.hostUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('[InterviewCard] Failed to join room:', err);
      navigate(`/interviews/${interview.id}`);
    } finally {
      setIsJoining(false);
    }
  };

  const handleStartAssessmentEvaluation = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    if (!startAssessmentEvaluation) return;
    setAssessmentEvaluationNotice(null);
    setAssessmentEvaluationError(null);
    setIsStartingAssessmentEvaluation(true);
    try {
      const result = await startAssessmentEvaluation(interview.id);
      setAssessmentEvaluationNotice(assessmentEvaluationStartNotice(result));
    } catch (err) {
      setAssessmentEvaluationError(
        err instanceof Error ? err.message : 'Unable to start assessment evaluation',
      );
    } finally {
      setIsStartingAssessmentEvaluation(false);
    }
  };

  const timeStr = interview.scheduledAt
    ? new Date(interview.scheduledAt).toLocaleString(undefined, {
        timeStyle: 'short',
      })
    : '—';
  const modeLabel = interview.interviewType
    ? INTERVIEW_TYPE_LABELS[interview.interviewType] ?? interview.interviewType
    : 'Interview';
  const interviewTitle = interview.title?.trim() || null;
  const interviewDescription = interview.description?.trim() || null;
  const primaryLabel = interviewTitle ?? candidateName;
  const secondaryIdentity = interviewTitle ? candidateName : null;
  const provider = interview.meetingSchedulingProvider ?? interview.schedulingProvider ?? null;
  const providerEventId = providerEventLabel(interview.meetingExternalEventId ?? interview.externalEventId);
  const roleContext = pipelineTitle && pipelineTitle !== 'Talent Pool'
    ? `${pipelineTitle}${stageTitle ? ` · ${stageTitle}` : ''}`
    : null;
  const hasInviteDelivery = Boolean(
    interview.inviteLinkSentAt
    ?? interview.emailSentAt
    ?? interview.meetingUrl,
  );
  const displayStatusLabel =
    interview.status === 'INVITED' && !hasInviteDelivery ? 'Ready' : undefined;
  const assessmentProgress = interview.assessmentProgress ?? null;
  const assessmentSetup = interview.assessmentSetup ?? null;
  const assessmentAssignment = summarizeResolvedAssessmentAssignment({
    setup: assessmentSetup,
    assignmentTrust: assessmentProgress?.assignmentTrust,
  });
  const showsAssessmentSnapshot = isAssessmentInterviewType(interview.interviewType)
    || Boolean(assessmentProgress);
  const assessmentStageLabel = assessmentProgress
    ? assessmentProgress.readiness?.label ?? sentenceCaseToken(assessmentProgress.stage)
    : assessmentSetup?.blocksPositiveAssessment
      ? 'Setup gap'
      : 'Assessment ready';
  const assessmentNextAction = assessmentProgress?.nextActionLabel
    ?? assessmentProgress?.readiness?.detail
    ?? assessmentSetup?.nextActionLabel
    ?? assessmentSetup?.message
    ?? 'Assessment evidence will appear after the session starts.';
  const assessmentEvidence = assessmentProgress
    ? assessmentEvidenceSummary(assessmentProgress)
    : assessmentSetup?.status === 'reviewable_task_assigned'
      ? 'challenge assigned'
      : 'no assessment session yet';
  const assessmentChallenge = summarizeAssessmentChallenge(assessmentProgress?.challenge ?? null);
  const assessmentRepoLabel = repoLabelFromUrl(
    assessmentProgress?.commit?.repositoryUrl
      ?? assessmentChallenge?.repositoryUrl
      ?? interview.githubRepoUrl,
  );
  const assessmentPrNumber = assessmentChallenge?.githubPrNumber ?? interview.githubPrNumber ?? null;
  const assessmentPrLabel = assessmentPrNumber ? `PR #${assessmentPrNumber}` : null;
  const assessmentBaseLabel = shortCommitSha(
    assessmentProgress?.commit?.baseCommitSha
      ?? assessmentChallenge?.baseCommitSha
      ?? null,
  );
  const assessmentCommitLabel = shortCommitSha(assessmentProgress?.commit?.commitSha);
  const assessmentUpstreamPullRequestUrl = assessmentProgress?.commit?.upstreamPullRequestUrl ?? null;
  const assessmentUpstreamPullRequestLabel = assessmentUpstreamPullRequestUrl && assessmentProgress?.commit?.upstreamPrConsent
    ? assessmentUpstreamPullRequestUrl.replace(/^https:\/\/github\.com\//, '')
    : null;
  const assessmentCommitIntegrityLabel = assessmentProgress?.commit?.integrity?.label
    ?? assessmentProgress?.commit?.submissionSourceLabel
    ?? null;
  const assessmentChallengeBindingLabel = assessmentProgress?.commit?.challengeBinding?.label ?? null;
  const assessmentCommitTrust = assessmentCommitTrustSummary(assessmentProgress?.commit);
  const assessmentReviewArtifact = assessmentReviewArtifactSummary(assessmentProgress);
  const assessmentPacketContract = assessmentPacketContractSummary(assessmentProgress?.challengePacketContract);
  const assessmentCriteriaLabel = assessmentChallenge?.successCriteria.length
    ? compactText(assessmentChallenge.successCriteria.join(' · '), 150)
    : null;
  const assessmentExpectedEvidenceLabel = assessmentChallenge?.expectedEvidence.length
    ? compactText(assessmentChallenge.expectedEvidence.join(' · '), 150)
    : null;
  const assessmentEvaluationLabel = assessmentProgress?.evaluation?.status
    ? sentenceCaseToken(assessmentProgress.evaluation.status)
    : null;
  const assessmentDiagnosticCount = assessmentProgress?.evaluation?.diagnostics?.length ?? 0;
  const visibleAssessmentEvaluationClaims = assessmentEvaluationClaims(assessmentProgress?.evaluation);
  const visibleAssessmentEvaluationDiagnostics = assessmentEvaluationDiagnostics(assessmentProgress?.evaluation);
  const visibleAssessmentEvaluationGaps = assessmentCoverageGaps(assessmentProgress?.evaluation?.evidenceCoverage);
  const assessmentDecision = assessmentDecisionSummary({
    setup: assessmentSetup,
    progress: assessmentProgress,
  });
  const assessmentProofChecklist = assessmentProofChecklistSummary(assessmentProgress?.readiness);
  const canStartAssessmentEvaluation = Boolean(
    startAssessmentEvaluation && assessmentProgress?.nextAction === 'START_EVALUATION',
  );
  const roomSummary = roomStateSummary(interview);
  const workspaceSummary = workspaceSessionSummary(interview);

  return (
    <>
      <div
        role="button"
        data-testid="interview-card"
        data-interview-id={interview.id}
        data-interview-type={interview.interviewType ?? ''}
        data-candidate-email={candidateEmail ?? ''}
        aria-label={`Open ${primaryLabel} interview details`}
        tabIndex={0}
        onClick={() => navigate(`/interviews/${interview.id}`)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigate(`/interviews/${interview.id}`);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          padding: '16px 20px',
          background: 'var(--pipe-surface-solid)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 8,
          transition: 'all 0.2s',
          cursor: 'pointer',
        }}
      >
        {/* Left: dot + time */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 'max-content' }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dotColor,
              marginTop: 6,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', minWidth: 70 }}>
            {timeStr}
          </div>
        </div>

        {/* Center: assessment title/person + interview mode + optional role context */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{primaryLabel}</span>
            {guestWaiting && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: '#10b981',
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: 4,
                  fontFamily: '"Space Mono", monospace',
                  whiteSpace: 'nowrap',
                }}
              >
                <Radio size={10} className="pulse-dot" />
                GUEST WAITING
              </span>
            )}
          </div>
          {secondaryIdentity && (
            <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4, overflowWrap: 'anywhere' }}>
              {secondaryIdentity}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
            {roleContext ? `${modeLabel} · ${roleContext}` : modeLabel}
          </div>
          {candidateEmail && (
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              {candidateEmail}
            </div>
          )}
          {interviewDescription && (
            <div style={{ marginTop: 5, fontSize: 10, lineHeight: 1.45, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', overflowWrap: 'anywhere' }}>
              {compactText(interviewDescription, 180)}
            </div>
          )}
          {provider && providerEventId && (
            <div style={{ fontSize: 9, color: '#60a5fa', fontFamily: '"Space Mono", monospace', marginTop: 4, letterSpacing: '0.08em' }}>
              {provider} ACCEPTED · {providerEventId}
            </div>
          )}
          {showsAssessmentSnapshot && (
            <div
              data-testid="interview-card-assessment-progress"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, max-content) minmax(0, 1fr)',
                gap: '4px 10px',
                marginTop: 10,
                padding: '9px 10px',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.03)',
                fontFamily: '"Space Mono", monospace',
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontSize: 9, color: '#93c5fd', letterSpacing: '0.12em', fontWeight: 700 }}>
                ASSESSMENT
              </div>
              <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text)', fontWeight: 700, overflowWrap: 'anywhere' }}>
                {assessmentStageLabel}
              </div>
              {assessmentAssignment && (
                <>
                  <div style={{ fontSize: 9, color: '#93c5fd', letterSpacing: '0.12em', fontWeight: 700 }}>
                    ASSIGNMENT
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: assessmentAssignmentColor(assessmentAssignment.tone), fontWeight: 700 }}>
                      {assessmentAssignment.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                      {assessmentAssignment.detail}
                    </div>
                  </div>
                </>
              )}
              {assessmentDecision && (
                <>
                  <div style={{ fontSize: 9, color: '#93c5fd', letterSpacing: '0.12em', fontWeight: 700 }}>
                    DECISION
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text)', fontWeight: 700 }}>
                      {assessmentDecision.value}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                      {assessmentDecision.detail}
                    </div>
                  </div>
                </>
              )}
              <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                NEXT
              </div>
              <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                {compactText(assessmentNextAction)}
              </div>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                EVIDENCE
              </div>
              <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                {assessmentEvidence}
              </div>
              {assessmentProofChecklist && (
                <>
                  <div style={{
                    fontSize: 9,
                    color: assessmentProofChecklist.missingRequiredCount > 0 ? '#fbbf24' : '#4ade80',
                    letterSpacing: '0.12em',
                    fontWeight: 700,
                  }}>
                    PROOF
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {assessmentProofChecklist.required.length > 0 && (
                      <div style={{
                        fontSize: 10,
                        color: assessmentProofChecklist.missingRequiredCount > 0 ? '#fde68a' : 'var(--pipe-text-dim)',
                      }}>
                        Required: {assessmentProofChecklist.required.join(' · ')}
                      </div>
                    )}
                    {assessmentProofChecklist.confidence.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                        Confidence: {assessmentProofChecklist.confidence.join(' · ')}
                      </div>
                    )}
                  </div>
                </>
              )}
              {assessmentPacketContract && (
                <>
                  <div style={{ fontSize: 9, color: assessmentPacketContractColor(assessmentPacketContract.tone), letterSpacing: '0.12em', fontWeight: 700 }}>
                    PACKET
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: assessmentPacketContractColor(assessmentPacketContract.tone), fontWeight: 700 }}>
                      {assessmentPacketContract.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                      {assessmentPacketContract.detail}
                    </div>
                  </div>
                </>
              )}
              {workspaceSummary && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    WORKSPACE
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {workspaceSummary}
                  </div>
                </>
              )}
              {roomSummary && (
                <>
                  <div style={{ fontSize: 9, color: guestWaiting ? '#10b981' : 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    ROOM
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: guestWaiting ? '#10b981' : 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {roomSummary}
                  </div>
                </>
              )}
              {assessmentRepoLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    REPO
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentPrLabel ? `${assessmentRepoLabel} · ${assessmentPrLabel}` : assessmentRepoLabel}
                  </div>
                </>
              )}
              {assessmentBaseLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    BASE
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentBaseLabel}
                  </div>
                </>
              )}
              {assessmentChallenge?.task && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    TASK
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {compactText(assessmentChallenge.task, 120)}
                  </div>
                </>
              )}
              {assessmentCriteriaLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    CRITERIA
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentCriteriaLabel}
                  </div>
                </>
              )}
              {assessmentExpectedEvidenceLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    EXPECTED
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentExpectedEvidenceLabel}
                  </div>
                </>
              )}
              {assessmentCommitLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    COMMIT
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {[assessmentCommitLabel, assessmentCommitIntegrityLabel, assessmentChallengeBindingLabel].filter(Boolean).join(' · ')}
                  </div>
                </>
              )}
              {assessmentUpstreamPullRequestLabel && (
                <>
                  <div style={{ fontSize: 9, color: '#93c5fd', letterSpacing: '0.12em', fontWeight: 700 }}>
                    UPSTREAM PR
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: '#bfdbfe', overflowWrap: 'anywhere' }}>
                    {assessmentUpstreamPullRequestLabel} · candidate-approved tracking
                  </div>
                </>
              )}
              {assessmentReviewArtifact && (
                <>
                  <div style={{ fontSize: 9, color: assessmentCommitTrustColor(assessmentReviewArtifact.tone), letterSpacing: '0.12em', fontWeight: 700 }}>
                    REVIEW ARTIFACT
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: assessmentCommitTrustColor(assessmentReviewArtifact.tone), fontWeight: 700 }}>
                      {assessmentReviewArtifact.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                      {assessmentReviewArtifact.detail}
                    </div>
                  </div>
                </>
              )}
              {assessmentCommitTrust && (
                <>
                  <div style={{ fontSize: 9, color: assessmentCommitTrustColor(assessmentCommitTrust.tone), letterSpacing: '0.12em', fontWeight: 700 }}>
                    COMMIT TRUST
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <div style={{ fontSize: 10, color: assessmentCommitTrustColor(assessmentCommitTrust.tone), fontWeight: 700 }}>
                      {assessmentCommitTrust.label}
                    </div>
                    {assessmentCommitTrust.detail && (
                      <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                        {assessmentCommitTrust.detail}
                      </div>
                    )}
                  </div>
                </>
              )}
              {assessmentEvaluationLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    EVAL
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentEvaluationLabel}
                  </div>
                </>
              )}
              {visibleAssessmentEvaluationClaims.length > 0 && (
                <>
                  <div style={{ fontSize: 9, color: '#4ade80', letterSpacing: '0.12em', fontWeight: 700 }}>
                    CLAIMS
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {visibleAssessmentEvaluationClaims.map((claim) => (
                      <div key={claim.id} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color: assessmentClaimToneColor(claim.polarity), fontWeight: 700 }}>
                          {sentenceCaseToken(claim.dimension)} · {sentenceCaseToken(claim.polarity)}
                          {typeof claim.confidence === 'number' ? ` · ${Math.round(claim.confidence * 100)}%` : ''}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                          {compactText(claim.narrative, 150)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)' }}>
                          {sourceRefSummary(claim.sourceRefCount, claim.sourceRefTypes)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {visibleAssessmentEvaluationGaps.length > 0 && (
                <>
                  <div style={{ fontSize: 9, color: '#fbbf24', letterSpacing: '0.12em', fontWeight: 700 }}>
                    GAPS
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {visibleAssessmentEvaluationGaps.map((gap) => (
                      <div key={`${gap.label}:${gap.sourceRefTypes.join(',')}`} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color: gap.required ? '#fde68a' : 'var(--pipe-text-dim)', fontWeight: 700 }}>
                          Missing: {gap.label}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                          {compactText(gap.missingImpact, 150)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {assessmentDiagnosticCount > 0 && (
                <>
                  <div style={{ fontSize: 9, color: '#fbbf24', letterSpacing: '0.12em', fontWeight: 700 }}>
                    CAUTION
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: '#fde68a', overflowWrap: 'anywhere' }}>
                    {assessmentDiagnosticCount} evaluator caution{assessmentDiagnosticCount === 1 ? '' : 's'}
                  </div>
                </>
              )}
              {visibleAssessmentEvaluationDiagnostics.length > 0 && (
                <>
                  <div style={{ fontSize: 9, color: '#fbbf24', letterSpacing: '0.12em', fontWeight: 700 }}>
                    DIAGNOSTICS
                  </div>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {visibleAssessmentEvaluationDiagnostics.map((diagnostic) => (
                      <div key={diagnostic.id} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 10, color: assessmentDiagnosticToneColor(diagnostic.severity), fontWeight: 700 }}>
                          {sentenceCaseToken(diagnostic.code)} · {sentenceCaseToken(diagnostic.severity)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                          {compactText(diagnostic.message, 150)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)' }}>
                          {sourceRefSummary(diagnostic.sourceRefCount, diagnostic.sourceRefTypes)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {(assessmentEvaluationNotice || assessmentEvaluationError) && (
                <>
                  <div style={{ fontSize: 9, color: assessmentEvaluationError ? '#f87171' : '#93c5fd', letterSpacing: '0.12em', fontWeight: 700 }}>
                    EVALUATION
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: assessmentEvaluationError ? '#fca5a5' : 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {assessmentEvaluationError ?? assessmentEvaluationNotice}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <InterviewStatusBadge status={interview.status ?? 'INVITED'} label={displayStatusLabel} />
        </div>

        {/* Right: INVITE + JOIN button + overflow menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {canStartAssessmentEvaluation && (
            <button
              disabled={isStartingAssessmentEvaluation}
              onClick={(event) => void handleStartAssessmentEvaluation(event)}
              title="Start source-backed assessment evaluation"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: 'rgba(96,165,250,0.15)',
                border: '1px solid rgba(96,165,250,0.35)',
                color: '#93c5fd',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: isStartingAssessmentEvaluation ? 'default' : 'pointer',
                borderRadius: 4,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {isStartingAssessmentEvaluation ? <Loader2 size={12} className="spin" /> : <CheckCircle size={12} />}
              EVALUATE
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              setIsInviteOpen(true);
            }}
            title="Invite to video call via email"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.25)',
              color: '#4ade80',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            <Mail size={12} />
            {hasInviteDelivery ? 'RESEND' : 'SEND'}
          </button>
          <button
            disabled={!joinable && !guestWaiting}
            onClick={guestWaiting ? handleJoinRoom : (event) => {
              event.stopPropagation();
              navigate(`/interviews/${interview.id}`);
            }}
            title={guestWaiting ? 'Join room now — guest is waiting' : joinable ? 'Open room controls' : 'Available 15 min before start'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: guestWaiting ? 'rgba(16,185,129,0.15)' : joinable ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
              border: `1px solid ${guestWaiting ? 'rgba(16,185,129,0.4)' : joinable ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
              color: guestWaiting ? '#10b981' : joinable ? '#60a5fa' : 'var(--pipe-text-dim)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: (joinable || guestWaiting) ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {isJoining ? <Loader2 size={12} className="spin" /> : <Video size={12} />}
            {guestWaiting ? 'JOIN' : 'ROOM'}
          </button>

          {/* Edit / override status */}
          <button
            onClick={(event) => {
              event.stopPropagation();
              setIsModalOpen(true);
            }}
            title="Update status"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text-dim)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'all 0.2s',
            }}
          >
            ⋯
          </button>
        </div>
      </div>

      {isModalOpen && (
        <StatusOverrideModal
          interview={interview}
          updateStatus={updateStatus}
          onClose={() => setIsModalOpen(false)}
        />
      )}
      {isInviteOpen && (
        <InviteToCallModal
          interview={interview}
          candidateEmail={candidateEmail}
          onSend={sendInvite}
          onClose={() => setIsInviteOpen(false)}
        />
      )}
    </>
  );
}
