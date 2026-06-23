import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
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
import type {
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

  const load = useCallback(async () => {
    if (!interviewId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.get<{ interview: ScheduledInterviewDetail }>(
        `/api/v1/scheduling/interviews/${interviewId}`,
      );
      setInterview(result.interview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load interview');
    } finally {
      setIsLoading(false);
    }
  }, [api, interviewId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
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
      await load();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to send invite');
    } finally {
      setIsSendingInvite(false);
    }
  }, [api, interview, load]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [load]);

  useEffect(() => {
    const status = interview?.linkedMeeting?.transcriptStatus ?? interview?.transcriptArtifact?.status ?? null;
    if (status !== 'RECORDING' && status !== 'PROCESSING' && status !== 'PENDING') return undefined;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [interview?.linkedMeeting?.transcriptStatus, interview?.transcriptArtifact?.status, load]);

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
  const transcriptStatus =
    interview.linkedMeeting?.transcriptStatus
    ?? interview.transcriptArtifact?.status
    ?? 'NONE';
  const transcriptError = interview.linkedMeeting?.transcriptError ?? interview.transcriptArtifact?.errorMessage ?? null;
  const transcriptContextText = personContextModeText(personContextMode, personContextReason);
  const guestRoomUrl = roomLinks?.guestUrl ?? interview.linkedMeeting?.meetingUrl ?? null;
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
  const transcriptEmptyText = transcriptStatus === 'PROCESSING'
    ? 'Transcription is processing. Context will update when source-backed transcript spans are ready.'
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

      <section style={ROOM_PANEL}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...SECTION_TITLE, marginBottom: 10 }}>
            <Video size={15} />
            Room
          </div>
          <h2 style={ROOM_TITLE}>{interview.linkedMeeting?.title ?? `${personName} interview`}</h2>
          <div style={ROOM_LINK_TEXT}>
            {guestRoomUrl
              ? 'Guest link is ready. Send it, copy it, or open the host room.'
              : 'No guest link yet. Send an invite, copy the guest link, or open the host room to prepare it.'}
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

      <main style={EVIDENCE_GRID}>
        <Section title="Recording and transcript" icon={<FileText size={15} />}>
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
            <div style={SMALL_NOTE}>Recording stored. Transcript and context are rebuilt from the meeting source.</div>
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

        <Section title="Source-backed context" icon={<Network size={15} />}>
          {hasLivingContextEvidence && contextSummary ? (
            <>
              <div style={CONTEXT_METRICS}>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.interactionCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>interactions</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.contextRecordCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>context records</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.sourceSpanCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>source spans</span>
                </div>
                <div style={CONTEXT_METRIC}>
                  <span style={CONTEXT_METRIC_VALUE}>{contextSummary.assertionCount}</span>
                  <span style={CONTEXT_METRIC_LABEL}>evidence claims</span>
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
                <div style={EMPTY_TEXT}>No context records have been extracted yet.</div>
              )}
            </>
          ) : (
            <div style={EMPTY_TEXT}>
              Context records will appear only after PIPE has exact source evidence from the invite, transcript, assessment, or code-review material.
            </div>
          )}
        </Section>

        {hasCodeReviewEvidence && (
          <Section title="Code-review evidence" icon={<GitPullRequest size={15} />}>
            <div style={EVIDENCE_LIST}>
              {interview.githubRepoUrl && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Repository</span>
                  <a href={interview.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                    {interview.githubRepoUrl}
                  </a>
                </div>
              )}
              {interview.githubPrNumber && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>PR</span>
                  <span style={FIELD_VALUE}>#{interview.githubPrNumber}</span>
                </div>
              )}
              {interview.matchedRepoId && (
                <div style={EVIDENCE_ROW}>
                  <span style={FIELD_LABEL}>Repo id</span>
                  <span style={FIELD_VALUE}>{interview.matchedRepoId}</span>
                </div>
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

const CENTERED: CSSProperties = {
  minHeight: '55vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
};
