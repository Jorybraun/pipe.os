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
  summarizeAssessmentAssignment,
  summarizeAssessmentChallenge,
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
  report?: unknown | null;
  diagnostic?: {
    code?: string;
    severity?: string;
  } | null;
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
  ].filter((value): value is string => Boolean(value));
  return ready.length > 0 ? ready.join(', ') : 'no evidence yet';
}

function assessmentAssignmentColor(
  tone: NonNullable<ReturnType<typeof summarizeAssessmentAssignment>>['tone'],
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

function assessmentAssignmentFromProgressTrust(
  trust: NonNullable<ScheduledInterview['assessmentProgress']>['assignmentTrust'],
): AssessmentAssignmentSummary | null {
  if (!trust || typeof trust !== 'object') return null;
  const candidate = trust as {
    label?: unknown;
    detail?: unknown;
    tone?: unknown;
  };
  if (typeof candidate.label !== 'string' || typeof candidate.detail !== 'string') return null;
  const tone = candidate.tone;
  if (
    tone !== 'matched'
    && tone !== 'manual'
    && tone !== 'waiting'
    && tone !== 'blocked'
    && tone !== 'neutral'
  ) {
    return null;
  }
  return {
    label: candidate.label,
    detail: candidate.detail,
    tone,
  };
}

interface AssessmentDecisionSummary {
  value: string;
  detail: string;
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
      return {
        value: progress.evaluation.recommendation?.trim() || 'Evaluated',
        detail: compactText(
          progress.evaluation.summary
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
  const assessmentAssignment = summarizeAssessmentAssignment(assessmentSetup)
    ?? assessmentAssignmentFromProgressTrust(assessmentProgress?.assignmentTrust);
  const showsAssessmentSnapshot = isAssessmentInterviewType(interview.interviewType)
    || Boolean(assessmentProgress);
  const assessmentStageLabel = assessmentProgress
    ? sentenceCaseToken(assessmentProgress.stage)
    : assessmentSetup?.blocksPositiveAssessment
      ? 'Setup gap'
      : 'Assessment ready';
  const assessmentNextAction = assessmentProgress?.nextActionLabel
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
  const assessmentCommitIntegrityLabel = assessmentProgress?.commit?.integrity?.label
    ?? assessmentProgress?.commit?.submissionSourceLabel
    ?? null;
  const assessmentEvaluationLabel = assessmentProgress?.evaluation?.status
    ? sentenceCaseToken(assessmentProgress.evaluation.status)
    : null;
  const assessmentDiagnosticCount = assessmentProgress?.evaluation?.diagnostics?.length ?? 0;
  const assessmentDecision = assessmentDecisionSummary({
    setup: assessmentSetup,
    progress: assessmentProgress,
  });
  const canStartAssessmentEvaluation = Boolean(
    startAssessmentEvaluation && assessmentProgress?.nextAction === 'START_EVALUATION',
  );
  const workspaceSummary = workspaceSessionSummary(interview);

  return (
    <>
      <div
        role="button"
        aria-label={`Open ${candidateName} interview details`}
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

        {/* Center: person + interview mode + optional role context */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            {candidateName}
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
          <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
            {roleContext ? `${modeLabel} · ${roleContext}` : modeLabel}
          </div>
          {candidateEmail && (
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              {candidateEmail}
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
              {assessmentCommitLabel && (
                <>
                  <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.12em', fontWeight: 700 }}>
                    COMMIT
                  </div>
                  <div style={{ minWidth: 0, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {[assessmentCommitLabel, assessmentCommitIntegrityLabel].filter(Boolean).join(' · ')}
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
