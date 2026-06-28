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
  CodeReviewMatchAlignment,
  CodeReviewMatchHyperedge,
  CodeReviewMatchHyperedgeNode,
  CodeReviewMatchSourceRef,
  ScheduledInterviewDetail,
  TranscriptArtifact,
  TranscriptEntry,
} from '../lib/scheduling/types';
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
}: {
  title: string;
  icon: JSX.Element;
  children: ReactNode;
}): JSX.Element {
  return (
    <section style={SECTION}>
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
      const result = await api.post<InviteResponse>(
        `/api/v1/scheduling/interviews/${interview.id}/invite`,
        { email },
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
  }, [api, interview, load]);

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
        <Section title="Scheduling" icon={<CalendarCheck size={15} />}>
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
          <Section title="Call record" icon={<FileText size={15} />}>
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

        <Section title="Person context" icon={<Network size={15} />}>
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
          <Section title="Review assignment" icon={<GitPullRequest size={15} />}>
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
          <Section title="Match decision" icon={<Network size={15} />}>
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
          <Section title="Candidate review result" icon={<CheckCircle size={15} />}>
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
