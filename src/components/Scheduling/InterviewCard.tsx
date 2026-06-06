import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, RefreshCw, FileText } from 'lucide-react';
import type { ScheduledInterview } from '../../lib/scheduling/types';
import { InterviewStatusBadge } from './InterviewStatusBadge';
import { StatusOverrideModal } from './StatusOverrideModal';
import { TranscriptViewer } from './TranscriptViewer';
import type { InterviewStatus } from '../../lib/scheduling/types';

// TODO: Wire candidateName and pipelineTitle via enriched data once we join
// across models. For MVP these are passed as props by SchedulingDashboard which
// pre-fetches candidates and pipelines.
interface InterviewCardProps {
  interview: ScheduledInterview;
  candidateName: string | null;
  candidateEmail?: string | null;
  pipelineTitle: string | null;
  stageTitle: string | null;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string | undefined;
      meetingUrl?: string | undefined;
      recruiterNotes?: string | undefined;
    }
  ) => Promise<void>;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function isJoinable(interview: ScheduledInterview): boolean {
  if (interview.status !== 'SCHEDULED') return false;
  if (!interview.scheduledAt)            return false;
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
}: InterviewCardProps): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const navigate = useNavigate();
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const joinable = isJoinable(interview);
  const now = Date.now();
  const scheduled = interview.scheduledAt ? new Date(interview.scheduledAt).getTime() : null;

  // Determine dot color
  let dotColor = 'rgba(255,255,255,0.3)'; // Default: dim for past/unscheduled
  if (scheduled && scheduled > now) {
    const minutesUntil = (scheduled - now) / 1000 / 60;
    if (minutesUntil <= 15) {
      dotColor = '#10b981'; // Green: joinable soon
    } else {
      dotColor = '#f59e0b'; // Amber: upcoming
    }
  }

  const timeStr = interview.scheduledAt
    ? new Date(interview.scheduledAt).toLocaleString(undefined, {
        timeStyle: 'short',
      })
    : '—';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          padding: '16px 20px',
          background: 'var(--pipe-surface-solid)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 8,
          transition: 'all 0.2s',
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

        {/* Center: candidate + pipeline/stage + email */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 4 }}>
            {candidateName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
            {pipelineTitle} · {stageTitle}
          </div>
          {candidateEmail && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace' }}>
              {candidateEmail}
            </div>
          )}
        </div>

        {/* Status badge + sync indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <InterviewStatusBadge status={interview.status ?? 'INVITED'} />
          {interview.syncSource === 'WEBHOOK' && (
            <span
              title={
                interview.lastSyncedAt
                  ? `Auto-synced ${new Date(interview.lastSyncedAt).toLocaleString()}`
                  : 'Auto-synced via webhook'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                fontSize: 9,
                letterSpacing: '0.08em',
                fontFamily: '"Space Mono", monospace',
                color: '#4ade80',
                background: 'rgba(74,222,128,0.08)',
                border: '1px solid rgba(74,222,128,0.15)',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              <RefreshCw size={9} />
              SYNCED
            </span>
          )}
        </div>

        {/* Right: JOIN button + transcript button + overflow menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            disabled={!joinable}
            onClick={() => {
              // For contact-first interviews (no candidate/pipeline), navigate to internal recruiter video page
              if (interview.recipientName && interview.recipientEmail && !interview.candidateId) {
                navigate(`/recruiter/video/${interview.id}`);
              } else if (interview.meetingUrl) {
                // For external provider meetings, open the meeting URL
                window.open(interview.meetingUrl, '_blank', 'noopener,noreferrer');
              }
            }}
            title={joinable ? 'Join the meeting' : 'Available 15 min before start'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: joinable ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${joinable ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: joinable ? '#60a5fa' : 'rgba(255,255,255,0.2)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: joinable ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            <Video size={12} />
            JOIN
          </button>

          {/* Transcript button */}
          {interview.transcriptArtifact && (
            <button
              onClick={() => setIsTranscriptOpen(true)}
              title="View transcript"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--pipe-border)',
                color: interview.transcriptArtifact.status === 'COMPLETED'
                  ? '#10b981'
                  : interview.transcriptArtifact.status === 'FAILED'
                  ? '#ef4444'
                  : 'var(--pipe-text-dim)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
                transition: 'all 0.2s',
              }}
            >
              <FileText size={12} />
              TRANSCRIPT
            </button>
          )}

          {/* Edit / override status */}
          <button
            onClick={() => setIsModalOpen(true)}
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

      {isTranscriptOpen && (
        <TranscriptViewer
          interviewId={interview.id}
          transcriptArtifact={interview.transcriptArtifact ?? null}
          onClose={() => setIsTranscriptOpen(false)}
        />
      )}
    </>
  );
}
