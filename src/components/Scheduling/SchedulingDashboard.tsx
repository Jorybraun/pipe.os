import { useMemo, useState } from 'react';
import { Calendar, RefreshCw, Video, User } from 'lucide-react';
import { useScheduledInterviews } from '../../hooks/useScheduledInterviews';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import { InterviewCard } from './InterviewCard';
import { Skeleton } from '../ui/Skeleton';
import { ConnectionSetup } from './ConnectionSetup';
import { InviteCreationModal } from './InviteCreationModal';
import type { ScheduledInterview, MeetingType } from '../../lib/scheduling/types';
import { useApiClient } from '../../hooks/useApiClient';

// Timeline grouping
type TimelineGroup = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'LATER' | 'PAST' | 'UNSCHEDULED';

function getTimelineGroup(scheduledAt: string | null): TimelineGroup {
  if (!scheduledAt) return 'UNSCHEDULED';

  const eventDate = new Date(scheduledAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  eventDate.setHours(0, 0, 0, 0);

  if (eventDate < today) return 'PAST';
  if (eventDate.getTime() === today.getTime()) return 'TODAY';
  if (eventDate.getTime() === tomorrow.getTime()) return 'TOMORROW';
  if (eventDate < nextWeek) return 'THIS_WEEK';
  return 'LATER';
}

const TIMELINE_ORDER: Record<TimelineGroup, number> = {
  TODAY: 0,
  TOMORROW: 1,
  THIS_WEEK: 2,
  LATER: 3,
  PAST: 4,
  UNSCHEDULED: 5,
};

const TIMELINE_LABELS: Record<TimelineGroup, string> = {
  TODAY: 'TODAY',
  TOMORROW: 'TOMORROW',
  THIS_WEEK: 'THIS WEEK',
  LATER: 'LATER',
  PAST: 'PAST',
  UNSCHEDULED: 'UNSCHEDULED',
};

// ---------------------------------------------------------------------------
// SchedulingDashboard
// ---------------------------------------------------------------------------

/**
 * SchedulingDashboard — recruiter view of all scheduled interviews.
 *
 * Data enrichment is now done server-side: GET /api/v1/scheduling/interviews
 * returns interviews with candidateName, candidateEmail, pipelineTitle, and
 * stageTitle embedded via LEFT JOINs. This component simply groups by timeline
 * and renders.
 */
export function SchedulingDashboard(): JSX.Element {
  const { interviews, isLoading, error, updateStatus, refetch } = useScheduledInterviews();
  const { connection } = useSchedulingConnection();
  const api = useApiClient();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [initialMeetingType, setInitialMeetingType] = useState<MeetingType>('DIRECT_VIDEO_CALL');

  const handleCreateInvite = async (data: {
    recipientName: string;
    recipientEmail: string;
    meetingType: MeetingType;
    scheduledAt?: string;
  }) => {
    const result = await api.post<{
      interview: {
        id: string;
      };
    }>('/api/v1/scheduling/interviews', {
      recipientName: data.recipientName,
      recipientEmail: data.recipientEmail,
      meetingType: data.meetingType,
      scheduledAt: data.scheduledAt,
    });
    await refetch();
    return { id: result.interview.id };
  };

  // Group interviews by timeline, then sort within each group by time
  const groupedInterviews = useMemo(() => {
    const groups = new Map<TimelineGroup, ScheduledInterview[]>();

    interviews.forEach((iv) => {
      const group = getTimelineGroup(iv.scheduledAt ?? null);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(iv);
    });

    // Sort each group by scheduledAt (ascending), and sort groups by timeline order
    const sorted = Array.from(groups.entries())
      .sort((a, b) => TIMELINE_ORDER[a[0]] - TIMELINE_ORDER[b[0]])
      .map(([group, ivs]) => [
        group,
        ivs.sort((a, b) => {
          if (!a.scheduledAt) return 1;
          if (!b.scheduledAt) return -1;
          return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
        }),
      ] as [TimelineGroup, ScheduledInterview[]]);

    return sorted;
  }, [interviews]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={64} style={{ borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p style={{ color: '#f87171', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
        Failed to load interviews: {error.message}
      </p>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            INTERVIEW_SCHEDULE
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text)', letterSpacing: '-0.02em' }}>
            Schedule
          </h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, marginTop: 8 }}>
          {/* Primary action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setInitialMeetingType('DIRECT_VIDEO_CALL');
                setIsInviteModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: 'rgba(96,165,250,0.15)',
                border: '1px solid rgba(96,165,250,0.3)',
                color: '#60a5fa',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
                transition: 'all 0.2s',
              }}
            >
              <Video size={12} />
              DIRECT CALL
            </button>
            <button
              onClick={() => {
                setInitialMeetingType('SCREENING_INTERVIEW');
                setIsInviteModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: 'rgba(168,85,247,0.15)',
                border: '1px solid rgba(168,85,247,0.3)',
                color: '#a855f7',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
                transition: 'all 0.2s',
              }}
            >
              <User size={12} />
              SCREENING
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              {interviews.length} total
            </span>
            {connection?.lastSyncAt && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 10,
                  color: 'rgba(74,222,128,0.7)',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.05em',
                }}
                title={`Last webhook sync: ${new Date(connection.lastSyncAt).toLocaleString()}`}
              >
                <RefreshCw size={10} />
                Last sync {new Date(connection.lastSyncAt).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* OAuth connection setup */}
      <ConnectionSetup />

      {/* Timeline groups */}
      {interviews.length === 0 ? (
        <div
          style={{
            padding: 64,
            textAlign: 'center',
            border: '1px dashed var(--pipe-border)',
            borderRadius: 12,
          }}
        >
          <Calendar size={40} color="var(--pipe-text-dim)" style={{ marginBottom: 16 }} />
          <p style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 13, lineHeight: 1.7 }}>
            No interviews yet. Invite candidates to LIVE_VIDEO stages to get started.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groupedInterviews.map(([group, ivs]) => (
            <div key={group}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  fontWeight: 700,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 12,
                  textTransform: 'uppercase',
                }}
              >
                {TIMELINE_LABELS[group]}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ivs.map((iv) => {
                  const candidateName: string | null = iv.candidateName ?? iv.candidateEmail ?? iv.recipientName ?? iv.candidateId?.slice(0, 8) ?? 'Unknown';
                  const candidateEmail = iv.candidateEmail ?? iv.recipientEmail ?? null;
                  const pipelineTitle: string | null = iv.pipelineTitle ?? iv.pipelineId ?? 'N/A';
                  const stageTitle: string | null = iv.stageTitle ?? iv.stageId ?? 'N/A';

                  return (
                    <InterviewCard
                      key={iv.id}
                      interview={iv}
                      candidateName={candidateName}
                      candidateEmail={candidateEmail}
                      pipelineTitle={pipelineTitle}
                      stageTitle={stageTitle}
                      updateStatus={updateStatus}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite creation modal */}
      <InviteCreationModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onCreateInvite={handleCreateInvite}
        initialMeetingType={initialMeetingType}
      />
    </div>
  );
}
