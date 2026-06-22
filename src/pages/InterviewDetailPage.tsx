import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  GitPullRequest,
  Loader2,
  Mail,
  RefreshCw,
  User,
  Video,
} from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import type {
  ScheduledInterviewDetail,
  TranscriptArtifact,
  TranscriptEntry,
} from '../lib/scheduling/types';

const FONT = '"Space Mono", monospace';

const STATUS_COLORS: Record<string, string> = {
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

function parseTranscript(artifact: TranscriptArtifact | null | undefined): TranscriptEntry[] {
  if (!artifact?.transcriptJson) return [];
  try {
    const parsed = JSON.parse(artifact.transcriptJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is TranscriptEntry => (
          Boolean(entry)
          && typeof entry === 'object'
          && typeof (entry as TranscriptEntry).text === 'string'
          && typeof (entry as TranscriptEntry).role === 'string'
        ))
      : [];
  } catch {
    return [];
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

function Field({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={FIELD_LABEL}>{label}</div>
      <div style={FIELD_VALUE}>{value}</div>
    </div>
  );
}

function ActionLink({
  href,
  children,
  tone = 'blue',
}: {
  href: string | null | undefined;
  children: ReactNode;
  tone?: 'blue' | 'green' | 'neutral';
}): JSX.Element | null {
  if (!href) return null;
  const color = tone === 'green' ? '#4ade80' : tone === 'neutral' ? 'var(--pipe-text)' : '#60a5fa';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 6,
        border: `1px solid ${tone === 'neutral' ? 'var(--pipe-border)' : `${color}40`}`,
        background: tone === 'neutral' ? 'rgba(255,255,255,0.04)' : `${color}16`,
        color,
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textDecoration: 'none',
      }}
    >
      {children}
      <ExternalLink size={13} />
    </a>
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
  const [roomError, setRoomError] = useState<string | null>(null);

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

  const transcriptEntries = useMemo(
    () => parseTranscript(interview?.transcriptArtifact),
    [interview?.transcriptArtifact],
  );

  const prepareRoom = useCallback(async () => {
    if (!interview) return;
    setRoomError(null);
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
          return;
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
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to prepare video room');
    } finally {
      setIsPreparingRoom(false);
    }
  }, [api, interview, load]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
          <StatusBadge status={interview.status} />
        </div>

        <div style={ACTION_ROW}>
          {interview.candidateId && (
            <button onClick={() => navigate(`/candidates/${interview.candidateId}`)} style={PRIMARY_BUTTON}>
              <User size={14} />
              PERSON
            </button>
          )}
          {roomLinks?.hostUrl ? (
            <ActionLink href={roomLinks.hostUrl} tone="green">
              <Video size={14} />
              HOST ROOM
            </ActionLink>
          ) : (
            <button onClick={() => void prepareRoom()} disabled={isPreparingRoom} style={PRIMARY_BUTTON}>
              {isPreparingRoom ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Video size={14} />}
              PREPARE ROOM
            </button>
          )}
          <ActionLink href={interview.schedulingUrl}>
            <Calendar size={14} />
            BOOKING
          </ActionLink>
        </div>
      </header>

      <div style={GRID}>
        <main style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Section title="Meeting" icon={<Calendar size={15} />}>
            <div style={FIELD_GRID}>
              <Field label="When" value={formatDate(interview.scheduledAt)} />
              <Field label="Type" value={interview.interviewType ?? 'VIDEO'} />
              <Field label="Meeting model" value={interview.meetingType ?? 'SCREENING_INTERVIEW'} />
              <Field label="Provider" value={interview.schedulingProvider ?? 'PIPE'} />
            </div>
            {interview.recruiterNotes && (
              <div style={NOTE}>{interview.recruiterNotes}</div>
            )}
          </Section>

          <Section title="Person" icon={<User size={15} />}>
            <div style={FIELD_GRID}>
              <Field label="Name" value={personName} />
              <Field label="Email" value={personEmail ?? 'No email'} />
              <Field label="Candidate id" value={interview.candidateId ?? 'Roleless contact'} />
              <Field label="Created" value={formatDate(interview.createdAt, 'Unknown')} />
            </div>
          </Section>

          <Section title="Role context" icon={<Briefcase size={15} />}>
            <div style={FIELD_GRID}>
              <Field label="Role" value={roleTitle} />
              <Field label="Stage" value={stageTitle} />
              <Field label="Pipeline id" value={interview.pipelineId ?? 'None'} />
              <Field label="Stage id" value={interview.stageId ?? 'None'} />
            </div>
          </Section>

          {(interview.githubRepoUrl || interview.githubPrNumber || interview.matchedRepoId) && (
            <Section title="Code review" icon={<GitPullRequest size={15} />}>
              <div style={FIELD_GRID}>
                <Field label="Repo id" value={interview.matchedRepoId ?? 'None'} />
                <Field label="PR" value={interview.githubPrNumber ? `#${interview.githubPrNumber}` : 'None'} />
                <Field label="Completed" value={formatDate(interview.completedAt, 'Not completed')} />
                <Field
                  label="Repository"
                  value={interview.githubRepoUrl ? (
                    <a href={interview.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                      {interview.githubRepoUrl}
                    </a>
                  ) : 'None'}
                />
              </div>
            </Section>
          )}

          <Section title="Transcript" icon={<FileText size={15} />}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: transcriptEntries.length > 0 ? 14 : 0 }}>
              {transcriptStatus === 'COMPLETED' || transcriptStatus === 'READY'
                ? <CheckCircle size={14} color="#4ade80" />
                : transcriptStatus === 'FAILED'
                  ? <AlertCircle size={14} color="#f87171" />
                  : <Clock size={14} color="var(--pipe-text-dim)" />}
              <span style={{ ...FIELD_VALUE, color: 'var(--pipe-text)' }}>{transcriptStatus}</span>
            </div>
            {interview.linkedMeeting?.transcriptSummary && (
              <div style={NOTE}>{interview.linkedMeeting.transcriptSummary}</div>
            )}
            {interview.transcriptArtifact?.errorMessage && (
              <div style={{ ...NOTE, borderColor: 'rgba(248,113,113,0.35)', color: '#fca5a5' }}>
                {interview.transcriptArtifact.errorMessage}
              </div>
            )}
            {transcriptEntries.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {transcriptEntries.map((entry, index) => (
                  <div key={`${entry.role}-${index}`} style={TRANSCRIPT_ROW}>
                    <div style={TRANSCRIPT_ROLE}>{entry.role}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={TRANSCRIPT_TEXT}>{entry.text}</div>
                      {entry.timestamp && (
                        <div style={TRANSCRIPT_TIME}>{formatDate(entry.timestamp, '')}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={EMPTY_TEXT}>No transcript captured yet.</div>
            )}
          </Section>
        </main>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Section title="Room" icon={<Video size={15} />}>
            <div style={FIELD_GRID_SINGLE}>
              <Field label="Linked meeting" value={interview.linkedMeeting?.title ?? 'No linked room'} />
              <Field label="Room status" value={interview.linkedMeeting?.room?.status ?? 'None'} />
              <Field label="Meeting status" value={interview.linkedMeeting?.status ?? 'None'} />
              <Field label="Started" value={formatDate(interview.linkedMeeting?.startedAt, 'Not started')} />
              <Field label="Ended" value={formatDate(interview.linkedMeeting?.endedAt, 'Not ended')} />
            </div>
            <div style={ROOM_ACTIONS}>
              <button
                onClick={() => void prepareRoom()}
                disabled={isPreparingRoom}
                style={{ ...PRIMARY_BUTTON, justifyContent: 'center', width: '100%' }}
              >
                {isPreparingRoom ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Video size={14} />}
                {roomLinks ? 'REFRESH HOST LINK' : 'PREPARE VIDEO ROOM'}
              </button>
              {roomLinks && (
                <>
                  <ActionLink href={roomLinks.hostUrl} tone="green">
                    <Video size={14} />
                    OPEN HOST ROOM
                  </ActionLink>
                  <button
                    onClick={() => void navigator.clipboard.writeText(roomLinks.guestUrl)}
                    style={{ ...PRIMARY_BUTTON, justifyContent: 'center', width: '100%' }}
                  >
                    <Copy size={14} />
                    COPY GUEST LINK
                  </button>
                  <div style={ROOM_LINK_TEXT}>
                    Guest link expires {formatDate(roomLinks.expiresAt, 'after token expiry')}
                  </div>
                </>
              )}
              {!roomLinks && interview.linkedMeeting?.meetingUrl && (
                <Field
                  label="Current guest link"
                  value={(
                    <a href={interview.linkedMeeting.meetingUrl} target="_blank" rel="noopener noreferrer" style={INLINE_LINK}>
                      {interview.linkedMeeting.meetingUrl}
                    </a>
                  )}
                />
              )}
              {roomError && <div style={ERROR_NOTE}>{roomError}</div>}
            </div>
          </Section>

          <Section title="Delivery" icon={<Mail size={15} />}>
            <div style={FIELD_GRID_SINGLE}>
              <Field label="Invite sent" value={formatDate(interview.inviteLinkSentAt ?? interview.emailSentAt, 'Not sent')} />
              <Field label="Sync source" value={interview.syncSource ?? 'MANUAL'} />
              <Field label="Last sync" value={formatDate(interview.lastSyncedAt, 'Never')} />
              <Field label="External event" value={interview.externalEventId ?? 'None'} />
            </div>
          </Section>

          <Section title="Record" icon={<RefreshCw size={15} />}>
            <div style={FIELD_GRID_SINGLE}>
              <Field label="Interview id" value={interview.id} />
              <Field label="Updated" value={formatDate(interview.updatedAt, 'Unknown')} />
            </div>
            <button onClick={() => void load()} style={{ ...PRIMARY_BUTTON, width: '100%', justifyContent: 'center', marginTop: 14 }}>
              <RefreshCw size={14} />
              REFRESH
            </button>
          </Section>
        </aside>
      </div>
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

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
  gap: 16,
  alignItems: 'start',
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

const FIELD_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 14,
};

const FIELD_GRID_SINGLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 14,
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
  background: 'rgba(255,255,255,0.05)',
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
  color: '#60a5fa',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 700,
};

const INLINE_LINK: CSSProperties = {
  color: '#60a5fa',
  textDecoration: 'none',
  overflowWrap: 'anywhere',
};

const ROOM_ACTIONS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 10,
  marginTop: 16,
};

const ROOM_LINK_TEXT: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  lineHeight: 1.5,
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

const NOTE: CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 6,
  border: '1px solid var(--pipe-border)',
  background: 'rgba(255,255,255,0.035)',
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.6,
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
  background: 'rgba(255,255,255,0.025)',
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

const CENTERED: CSSProperties = {
  minHeight: '55vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
};
