import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Video, Loader2, Radio } from 'lucide-react';
import { INTERVIEW_TYPE_LABELS, type ScheduledInterview } from '../../lib/scheduling/types';
import { InterviewStatusBadge } from './InterviewStatusBadge';
import { StatusOverrideModal } from './StatusOverrideModal';
import { InviteToCallModal } from './InviteToCallModal';
import { useApiClient } from '../../hooks/useApiClient';
import type { InterviewStatus } from '../../lib/scheduling/types';

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
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

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

export function InterviewCard({
  interview,
  candidateName,
  candidateEmail,
  pipelineTitle,
  stageTitle,
  updateStatus,
  sendInvite,
}: InterviewCardProps): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

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

  return (
    <>
      <div
        role="button"
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
        </div>

        {/* Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <InterviewStatusBadge status={interview.status ?? 'INVITED'} label={displayStatusLabel} />
        </div>

        {/* Right: INVITE + JOIN button + overflow menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
