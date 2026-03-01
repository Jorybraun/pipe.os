import { useState } from 'react';
import { Video, ExternalLink } from 'lucide-react';
import type { ScheduledInterview } from '../../lib/scheduling/types';
import { InterviewStatusBadge } from './InterviewStatusBadge';
import { StatusOverrideModal } from './StatusOverrideModal';
import type { InterviewStatus } from '../../lib/scheduling/types';

// TODO: Wire candidateName and pipelineTitle via enriched data once we join
// across models. For MVP these are passed as props by SchedulingDashboard which
// pre-fetches candidates and pipelines.
interface InterviewCardProps {
  interview: ScheduledInterview;
  candidateName: string;
  pipelineTitle: string;
  stageTitle: string;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string;
      meetingUrl?: string;
      recruiterNotes?: string;
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
  pipelineTitle,
  stageTitle,
  updateStatus,
}: InterviewCardProps): JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const formattedDate = interview.scheduledAt
    ? new Date(interview.scheduledAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  const joinable = isJoinable(interview);

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr auto auto',
          alignItems: 'center',
          gap: 16,
          padding: '16px 20px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          transition: 'border-color 0.2s',
        }}
      >
        {/* Candidate + pipeline info */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            {candidateName}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', fontFamily: '"Space Mono", monospace' }}>
            {pipelineTitle} / {stageTitle}
          </div>
        </div>

        {/* Scheduled date */}
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: '"Space Mono", monospace' }}>
          {formattedDate}
        </div>

        {/* Status badge */}
        <div>
          <InterviewStatusBadge status={interview.status ?? 'INVITED'} />
        </div>

        {/* Join Call button */}
        <button
          disabled={!joinable}
          onClick={() => {
            if (interview.meetingUrl) {
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
          }}
        >
          <Video size={12} />
          JOIN
        </button>

        {/* Edit / override status */}
        <button
          onClick={() => setIsModalOpen(true)}
          title="Update status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 10,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: 'pointer',
            borderRadius: 4,
            transition: 'all 0.2s',
          }}
        >
          <ExternalLink size={12} />
          EDIT
        </button>
      </div>

      {isModalOpen && (
        <StatusOverrideModal
          interview={interview}
          updateStatus={updateStatus}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
