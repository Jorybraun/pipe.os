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
  User,
  Video,
} from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import { LivingContextGraph } from '../components/Candidate/LivingContextGraph';
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

  const transcriptEntries = useMemo(
    () => parseTranscript(interview?.transcriptArtifact),
    [interview?.transcriptArtifact],
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
    await navigator.clipboard.writeText(guestUrl);
    setRoomNotice('Guest link copied.');
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
      const result = await api.post<{
        success: boolean;
        emailSent: boolean;
        meetingUrl: string;
      }>(`/api/v1/scheduling/interviews/${interview.id}/invite`, { email });
      setRoomNotice(result.emailSent
        ? 'Invite sent.'
        : 'Guest link is ready. Email delivery is not configured locally.');
      await load();
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to send invite');
    } finally {
      setIsSendingInvite(false);
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
  const guestRoomUrl = roomLinks?.guestUrl ?? interview.linkedMeeting?.meetingUrl ?? null;
  const hasInviteDelivery = Boolean(interview.inviteLinkSentAt ?? interview.emailSentAt);
  const hasRoleContext = Boolean(interview.pipelineId || interview.stageId || interview.pipelineTitle || interview.stageTitle);
  const livingContextSummary = interview.livingContext?.summary;
  const hasLivingContextEvidence = Boolean(livingContextSummary && (
    livingContextSummary.interactionCount > 0
    || livingContextSummary.contextRecordCount > 0
    || livingContextSummary.artifactCount > 0
    || livingContextSummary.sourceSpanCount > 0
    || livingContextSummary.assertionCount > 0
    || livingContextSummary.signalCount > 0
  ));

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
          <StatusBadge status={interview.status} />
        </div>

        <div style={ACTION_ROW}>
          {interview.candidateId && (
            <button onClick={() => navigate(`/candidates/${interview.candidateId}`)} style={PRIMARY_BUTTON}>
              <User size={14} />
              PERSON
            </button>
          )}
          <ActionLink href={interview.schedulingUrl}>
            <Calendar size={14} />
            BOOKING
          </ActionLink>
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
            {guestRoomUrl ? 'Guest link ready' : 'Open the host room to create the guest link'}
          </div>
          {roomLinks?.expiresAt && (
            <div style={{ ...ROOM_LINK_TEXT, marginTop: 8 }}>
              Links expire {formatDate(roomLinks.expiresAt, 'after token expiry')}
            </div>
          )}
        </div>
        <div style={ROOM_ACTIONS}>
          <button
            onClick={() => void openHostRoom()}
            disabled={isPreparingRoom}
            style={{ ...PRIMARY_BUTTON, ...ROOM_PRIMARY_BUTTON }}
          >
            {isPreparingRoom ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Video size={14} />}
            OPEN HOST ROOM
          </button>
          <button
            onClick={() => void copyGuestLink()}
            disabled={isPreparingRoom}
            style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
          >
            <Copy size={14} />
            COPY GUEST LINK
          </button>
          {personEmail && (
            <button
              onClick={() => void sendInvite()}
              disabled={isSendingInvite}
              style={{ ...PRIMARY_BUTTON, ...ROOM_SECONDARY_BUTTON }}
            >
              {isSendingInvite ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
              {hasInviteDelivery ? 'RESEND INVITE' : 'SEND INVITE'}
            </button>
          )}
          {roomNotice && <div style={SUCCESS_NOTE}>{roomNotice}</div>}
          {roomError && <div style={ERROR_NOTE}>{roomError}</div>}
        </div>
      </section>

      <div style={GRID}>
        <main style={DETAIL_GRID}>
          <Section title="Meeting" icon={<Calendar size={15} />}>
            <div style={FIELD_GRID}>
              <Field label="When" value={formatDate(interview.scheduledAt)} />
              <Field label="Event" value={interview.interviewType ?? 'VIDEO'} />
              <Field label="Context" value={roleTitle} />
            </div>
            {interview.recruiterNotes && (
              <div style={NOTE}>{interview.recruiterNotes}</div>
            )}
          </Section>

          <Section title="Person" icon={<User size={15} />}>
            <div style={FIELD_GRID}>
              <Field label="Name" value={personName} />
              <Field label="Email" value={personEmail ?? 'No email'} />
              <Field label="Created" value={formatDate(interview.createdAt, 'Unknown')} />
            </div>
          </Section>

          {hasRoleContext && (
            <Section title="Role context" icon={<Briefcase size={15} />}>
              <div style={FIELD_GRID}>
                <Field label="Role" value={roleTitle} />
                <Field label="Stage" value={stageTitle} />
              </div>
            </Section>
          )}

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
              <div style={EMPTY_TEXT}>Transcript will appear here after the call.</div>
            )}
          </Section>

          {hasInviteDelivery && (
            <Section title="Delivery" icon={<Mail size={15} />}>
              <div style={FIELD_GRID_SINGLE}>
                <Field label="Invite sent" value={formatDate(interview.inviteLinkSentAt ?? interview.emailSentAt, 'Not sent')} />
              </div>
            </Section>
          )}
        </main>
      </div>

      {interview.livingContext && hasLivingContextEvidence && (
        <section style={GRAPH_SECTION}>
          <div style={GRAPH_HEADER}>
            <div>
              <div style={EYEBROW}>LIVING GRAPH</div>
              <h2 style={GRAPH_TITLE}>Source-backed person context</h2>
            </div>
            <div style={GRAPH_META}>
              {interview.livingContext.summary.contextRecordCount} records · {interview.livingContext.summary.sourceSpanCount} spans
            </div>
          </div>
          <LivingContextGraph
            candidateId={interview.candidateId ?? `interview:${interview.id}`}
            livingContextEndpoint={`/api/v1/scheduling/interviews/${interview.id}`}
            initialLivingContext={interview.livingContext}
          />
        </section>
      )}
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
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: 8,
  background: 'rgba(6,10,18,0.96)',
  boxShadow: '0 24px 80px rgba(0,0,0,0.34)',
};

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 16,
  alignItems: 'start',
};

const ROOM_PANEL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 420px)',
  gap: 22,
  alignItems: 'center',
  border: '1px solid rgba(96,165,250,0.34)',
  borderRadius: 8,
  background: 'rgba(10,16,28,0.92)',
  padding: 20,
  boxShadow: '0 18px 42px rgba(0,0,0,0.22)',
};

const ROOM_TITLE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 20,
  lineHeight: 1.25,
  letterSpacing: 0,
};

const DETAIL_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 14,
  minWidth: 0,
};

const GRAPH_SECTION: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const GRAPH_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
};

const GRAPH_TITLE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 18,
  lineHeight: 1.25,
  letterSpacing: 0,
};

const GRAPH_META: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
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
};

const ROOM_PRIMARY_BUTTON: CSSProperties = {
  justifyContent: 'center',
  width: '100%',
  borderColor: 'rgba(96,165,250,0.46)',
  background: 'rgba(96,165,250,0.16)',
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
