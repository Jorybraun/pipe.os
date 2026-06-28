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
import type {
  CodeReviewEvidencePlanItem,
  CodeReviewMatchAlignment,
  CodeReviewMatchDetail,
  CodeReviewMatchHyperedge,
  CodeReviewMatchHyperedgeNode,
  CodeReviewMatchSourceRef,
  ScheduledInterviewDetail,
  TranscriptArtifact,
  TranscriptEntry,
} from '../lib/scheduling/types';
import type { LivingContextInteraction } from '../lib/api/types';
import {
  contextRecordTitle,
  contextRecordTypeLabel,
} from '../lib/livingContextDisplay';

const FONT = '"Space Mono", monospace';

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

interface EvidenceFollowUpPlan {
  originalInterviewId: string | null;
  matchStatus: string | null;
  matchSummary: string | null;
  gaps: string[];
  questions: string[];
}

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

function formatMatchScore(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function sourceRefText(ref: CodeReviewMatchSourceRef | null | undefined): string | null {
  if (!ref) return null;
  return ref.exactText
    ?? ref.locator
    ?? ref.sourceSpanId
    ?? ref.sourceRefId
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
  return `${alignment.atomId} -> ${alignment.demandId}`;
}

function hyperedgeNodeTitle(node: CodeReviewMatchHyperedgeNode): string {
  return node.label || titleCaseToken(node.kind);
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

function interactionTypeLabel(interaction: LivingContextInteraction): string {
  return titleCaseToken(interaction.interactionType);
}

function interactionEvidenceCounts(interaction: LivingContextInteraction): string {
  const parts = [
    interaction.artifactIds.length > 0
      ? countLabel(interaction.artifactIds.length, 'source artifact')
      : null,
    interaction.contextRecordIds.length > 0
      ? countLabel(interaction.contextRecordIds.length, 'learned record')
      : null,
    interaction.assertionIds.length > 0
      ? countLabel(interaction.assertionIds.length, 'claim')
      : null,
    interaction.signalKeys.length > 0
      ? countLabel(interaction.signalKeys.length, 'signal')
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'No extracted evidence yet';
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
    question: 'Walk me through a real code review or debugging task that best matches the work PIPE should assess here.',
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
  const [workspaceRepoUrl, setWorkspaceRepoUrl] = useState('');
  const [workspacePrNumber, setWorkspacePrNumber] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const hasLoadedOnceRef = useRef(false);

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
    try {
      await navigator.clipboard.writeText(guestUrl);
      setRoomNotice('Guest link copied.');
      setRoomError(null);
    } catch {
      setRoomNotice(null);
      setRoomError('Copy failed. Select the guest link below.');
    }
  }, [ensureRoomLinks, interview?.linkedMeeting?.meetingUrl, roomLinks?.guestUrl]);

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
  const personProfilePath = interview.contactId
    ? `/people/${interview.contactId}`
    : interview.candidateId
      ? `/candidates/${interview.candidateId}`
      : null;
  const hasInviteDelivery = Boolean(interview.inviteLinkSentAt ?? interview.emailSentAt);
  const displayStatus = interview.status === 'INVITED' && !hasInviteDelivery
    ? 'READY'
    : interview.status;
  const contextSummary = interview.livingContext?.summary ?? null;
  const contextRecords = interview.livingContext?.contextRecords ?? [];
  const contextInteractions = interview.livingContext?.interactions.slice(0, 4) ?? [];
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
  const hasCodeReviewEvidence = Boolean(interview.githubRepoUrl || interview.githubPrNumber || interview.matchedRepoId);
  const codeReviewMatch = interview.codeReviewMatch ?? null;
  const primaryMatchEvidence = codeReviewMatch?.evidence[0] ?? null;
  const primaryMatchHasRoleContext = Boolean(
    primaryMatchEvidence && (
      primaryMatchEvidence.roleSourceRefs.length > 0
      || (codeReviewMatch?.roleSources.length ?? 0) > 0
      || (codeReviewMatch?.validatorAgent?.sourceBridge?.roleSourceCount ?? 0) > 0
    ),
  );
  const matchHyperedges = codeReviewMatch?.evidenceHyperedges ?? [];
  const matchScore = formatMatchScore(codeReviewMatch?.score);
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
  const isCodeReviewInterview = interview.interviewType === 'CODE_REVIEW';
  const usesWorkspaceInterview = interview.interviewType === 'DEV_CONTAINER_CHALLENGE'
    || interview.interviewType === 'OPEN_SOURCE_BUG_FIX';
  const showsRoomPanel = !isCodeReviewInterview;
  const showsCallRecord = !isCodeReviewInterview || Boolean(interview.linkedMeeting || interview.transcriptArtifact);
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
  const codeReviewEvidencePlan = codeReviewEvidencePlanItems(codeReviewMatch, codeReviewSubmission);
  const codeReviewEvidenceRefresh = codeReviewMatch?.evidenceRefresh ?? null;
  const codeReviewEvidenceFollowUp = codeReviewMatch?.evidenceFollowUp ?? null;
  const codeReviewEvidenceRefreshUsed = Boolean(
    codeReviewEvidenceRefresh && codeReviewMatch?.status === 'MATCHED',
  );
  const shouldShowEvidencePlan = codeReviewEvidencePlan.length > 0
    && !codeReviewEvidenceRefresh
    && !codeReviewEvidenceFollowUp;
  const codeReviewDecisionSignals = [
    {
      label: 'Assignment',
      value: codeReviewFitLabel(codeReviewMatch),
      detail: codeReviewFitDetail(codeReviewMatch),
    },
    {
      label: 'Candidate review',
      value: countLabel(codeReviewSubmission?.annotations.length ?? 0, 'annotation'),
      detail: codeReviewSubmission?.summary ?? 'no submitted review yet',
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
            <button onClick={() => navigate(personProfilePath)} style={PRIMARY_BUTTON}>
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
              {codeReviewEvidenceRefresh && (
                <div data-testid="interview-code-review-evidence-refresh" style={DECISION_FOLLOW_UP}>
                  <div style={FIELD_LABEL}>
                    {codeReviewEvidenceRefreshUsed ? 'Evidence used for current match' : 'New evidence is ready'}
                  </div>
                  <div style={DECISION_PLAN_SIGNAL}>
                    {codeReviewEvidenceRefreshUsed ? 'Current PR assignment is evidence-backed' : 'Rerun repo matching'}
                  </div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    {codeReviewEvidenceRefreshUsed
                      ? 'These source-backed follow-up spans were used to select the current PR assignment.'
                      : 'Use the new source-backed spans to try PR selection again.'}
                  </div>
                  <div style={DECISION_FOLLOW_UP_ITEM}>
                    <div style={FIELD_LABEL}>Captured follow-up assessment</div>
                    <div>{codeReviewEvidenceRefresh.summary}</div>
                    <div style={CONTEXT_RECORD_NARRATIVE}>
                      {codeReviewEvidenceRefresh.sourceSpanCount ?? 0} source-backed transcript {codeReviewEvidenceRefresh.sourceSpanCount === 1 ? 'span is' : 'spans are'} linked to this original code-review match.
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
                  {!codeReviewEvidenceRefreshUsed && (
                    <button
                      data-testid="interview-code-review-refresh-match-cta"
                      onClick={() => void refreshCodeReviewMatch()}
                      disabled={isRefreshingMatch}
                      style={{ ...PRIMARY_BUTTON, ...CONTEXT_CALL_BUTTON }}
                    >
                      {isRefreshingMatch
                        ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Network size={14} />}
                      RERUN REPO MATCH
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
                </div>
              )}
              {codeReviewEvidenceFollowUp && !codeReviewEvidenceRefresh && (
                <div data-testid="interview-code-review-evidence-follow-up" style={DECISION_FOLLOW_UP}>
                  <div style={FIELD_LABEL}>Follow-up assessment open</div>
                  <div style={DECISION_PLAN_SIGNAL}>Waiting for source-backed response</div>
                  <div style={CONTEXT_RECORD_NARRATIVE}>
                    PIPE already has an evidence-plan assessment linked to this code-review match gap.
                  </div>
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
                  <div style={FIELD_LABEL}>Recommended next step</div>
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
                <span style={FIELD_LABEL}>Pipe meeting</span>
                <span style={FIELD_VALUE}>{interview.linkedMeeting.id}</span>
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
              {contextInteractions.length > 0 && (
                <div data-testid="interview-person-context-timeline" style={PERSON_CONTEXT_TIMELINE}>
                  <div style={FIELD_LABEL}>Evidence timeline</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {contextInteractions.map((interaction) => (
                      <div key={interaction.id} style={CONTEXT_RECORD}>
                        <div style={TRANSCRIPT_ROLE}>{interactionTypeLabel(interaction)}</div>
                        <div style={TRANSCRIPT_TEXT}>
                          {formatDate(interaction.startedAt ?? interaction.createdAt)}
                        </div>
                        {interaction.externalReference && (
                          <div style={CONTEXT_RECORD_NARRATIVE}>{interaction.externalReference}</div>
                        )}
                        <div style={CONTEXT_RECORD_NARRATIVE}>
                          {interactionEvidenceCounts(interaction)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {contextRecords.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {contextRecords.slice(0, 3).map((record) => {
                    const title = contextRecordTitle(record);
                    return (
                      <div key={record.id} style={CONTEXT_RECORD}>
                        <div style={TRANSCRIPT_ROLE}>{contextRecordTypeLabel(record)}</div>
                        <div style={TRANSCRIPT_TEXT}>{title}</div>
                        {record.narrative && record.narrative !== title && (
                          <div style={CONTEXT_RECORD_NARRATIVE}>{record.narrative}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={EMPTY_TEXT}>No person context has been extracted yet.</div>
              )}
            </>
          ) : (
            <div style={EMPTY_TEXT}>
              Person context will appear after PIPE has exact source evidence from the invite, transcript, assessment, or code-review material.
            </div>
          )}
        </Section>

        {hasCodeReviewEvidence && (
          <Section
            title="Review assignment"
            icon={<GitPullRequest size={15} />}
            style={CODE_REVIEW_ASSIGNMENT_SECTION}
          >
            <div style={EVIDENCE_LIST}>
              {interview.githubRepoUrl && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Repository</span>
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
                {matchScore && (
                  <div style={MATCH_DECISION_CARD}>
                    <div style={FIELD_LABEL}>Confidence</div>
                    <div style={MATCH_DECISION_VALUE}>{matchScore}</div>
                  </div>
                )}
              </div>

              {codeReviewMatch.assessmentQuality && (
                <div data-testid="interview-code-review-match-quality" style={CONTEXT_RECORD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={FIELD_LABEL}>Why this is useful</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={MATCH_BADGE}>{codeReviewMatch.assessmentQuality.verdict}</span>
                      <span style={FIELD_VALUE}>
                        {codeReviewMatch.assessmentQuality.score}/{codeReviewMatch.assessmentQuality.maxScore}
                      </span>
                    </div>
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
                                {sourceRefText(node.sourceRef) ?? node.kind}
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
                          ?? primaryMatchEvidence.atomId}
                      </div>
                    </div>

                    <div style={MATCH_BRIDGE_CARD}>
                      <div style={TRANSCRIPT_ROLE}>Repo challenge</div>
                      <div style={TRANSCRIPT_TEXT}>
                        {firstSourceRefText(primaryMatchEvidence.challengeSourceRefs)
                          ?? primaryMatchEvidence.demandId}
                      </div>
                    </div>
                  </div>
                    </div>
                  )}

                  {codeReviewMatch.gaps.length > 0 && (
                    <div style={CONTEXT_RECORD}>
                  <div style={FIELD_LABEL}>Gaps</div>
                  {codeReviewMatch.gaps.slice(0, 3).map((gap) => (
                    <div key={gap} style={CONTEXT_RECORD_NARRATIVE}>{gap}</div>
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

const HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 20,
  paddingBottom: 24,
  borderBottom: '1px solid var(--pipe-border)',
};

const PAGE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  width: '100%',
  maxWidth: 1180,
  margin: '0 auto',
  padding: 22,
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-elevated)',
  boxShadow: '0 24px 80px var(--pipe-shadow)',
};

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

const SECTION: CSSProperties = {
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

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

const SECTION_TITLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const FIELD_LABEL: CSSProperties = {
  marginBottom: 5,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const FIELD_VALUE: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  color: 'var(--pipe-text)',
  fontSize: 13,
  lineHeight: 1.5,
};

const EYEBROW: CSSProperties = {
  marginBottom: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
};

const TITLE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 32,
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: 0,
};

const SUBTITLE: CSSProperties = {
  marginTop: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 12,
  lineHeight: 1.5,
};

const ACTION_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
};

const BACK_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  width: 'fit-content',
  border: 'none',
  background: 'transparent',
  color: 'var(--pipe-text-dim)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: 0,
};

const PRIMARY_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 6,
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
};

const TEXT_BUTTON: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--pipe-accent)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 700,
};

const INLINE_LINK: CSSProperties = {
  color: 'var(--pipe-accent)',
  textDecoration: 'none',
  overflowWrap: 'anywhere',
};

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

const TAG: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  padding: '5px 8px',
  borderRadius: 999,
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
};

const EMPTY_TEXT: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 12,
};

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

const PERSON_CONTEXT_TIMELINE: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginBottom: 14,
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
