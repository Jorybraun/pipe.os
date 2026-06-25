import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, UserPlus, X, CheckCircle2, XCircle } from 'lucide-react';
import { useScheduledInterviews } from '../../hooks/useScheduledInterviews';
import { useBookingNotifications, type BookingNotification } from '../../hooks/useBookingNotifications';
import { useApiClient } from '../../hooks/useApiClient';
import { InterviewCard } from './InterviewCard';
import { InviteCreationModal } from './InviteCreationModal';
import { Skeleton } from '../ui/Skeleton';
import type { InterviewType, MeetingType, ScheduledInterview, SchedulingProvider } from '../../lib/scheduling/types';

// Timeline grouping
type TimelineGroup = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'LATER' | 'PAST' | 'UNSCHEDULED';

interface InviteResponse {
  success: boolean;
  emailSent: boolean;
  meetingUrl: string;
  schedulingUrl?: string | null;
  deliveredUrl?: string | null;
  provider?: string;
  emailError?: string;
}

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
interface ToastItem {
  id: string;
  notification: BookingNotification;
}

function statusIcon(status: string): JSX.Element {
  if (status === 'SCHEDULED') return <CheckCircle2 size={16} color="#4ade80" />;
  if (status === 'CANCELLED') return <XCircle size={16} color="#f87171" />;
  return <Calendar size={16} color="#60a5fa" />;
}

function statusMessage(notification: BookingNotification): string {
  const name = notification.recipientName ?? notification.recipientEmail ?? 'Someone';
  const time = notification.scheduledAt
    ? new Date(notification.scheduledAt).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : '';

  switch (notification.status) {
    case 'SCHEDULED':
      return time ? `${name} booked their interview for ${time}` : `${name} booked their interview`;
    case 'CANCELLED':
      return `${name} cancelled their interview`;
    case 'COMPLETED':
      return `${name}'s interview is complete`;
    default:
      return `${name}'s interview updated to ${notification.status}`;
  }
}

export function SchedulingDashboard(): JSX.Element {
  const { interviews, isLoading, error, updateStatus, sendInvite, refetch } = useScheduledInterviews();
  const { notifications, isConnected } = useBookingNotifications();
  const api = useApiClient();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenNotificationIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setShowInviteModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Process new notifications into toasts + trigger refetch
  useEffect(() => {
    if (notifications.length === 0) return;

    const newToasts: ToastItem[] = [];
    for (const n of notifications) {
      const key = `${n.interviewId}-${n.updatedAt}`;
      if (seenNotificationIds.current.has(key)) continue;
      seenNotificationIds.current.add(key);
      newToasts.push({ id: key, notification: n });
    }

    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts]);
      // Refetch interviews to pick up the updated status
      void refetch();
      // Auto-dismiss each toast after 8 seconds
      for (const t of newToasts) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
        }, 8000);
      }
    }
  }, [notifications, refetch]);

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
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: 380,
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 16px',
                background: 'var(--pipe-surface-solid)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                animation: 'slideIn 0.3s ease',
              }}
            >
              {statusIcon(t.notification.status)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
                  {statusMessage(t.notification)}
                </div>
                {t.notification.meetingUrl && (
                  <a
                    href={t.notification.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 10,
                      color: '#60a5fa',
                      textDecoration: 'none',
                      fontFamily: '"Space Mono", monospace',
                      marginTop: 4,
                      display: 'inline-block',
                    }}
                  >
                    Join meeting →
                  </a>
                )}
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            INTERVIEWS
            {isConnected && (
              <span style={{ marginLeft: 8, color: '#4ade80', fontSize: 8 }}>● LIVE</span>
            )}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text)', letterSpacing: '-0.02em' }}>
            Interviews
          </h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, marginTop: 8 }}>
          <button
            onClick={() => setShowInviteModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: 'var(--pipe-text)',
              color: 'var(--pipe-bg)',
              border: '1px solid var(--pipe-accent-border)',
              borderRadius: 6,
              fontFamily: '"Space Mono", monospace',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            <UserPlus size={14} />
            NEW INTERVIEW
          </button>
          <span style={{ fontSize: 13, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            {interviews.length} total
          </span>
        </div>
      </div>

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
            No interviews yet. Create one for any person; role context can be added later.
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
                  const candidateName = iv.candidateName ?? iv.candidateEmail ?? iv.recipientName ?? iv.candidateId?.slice(0, 8) ?? 'Unknown person';
                  const candidateEmail = iv.candidateEmail ?? iv.recipientEmail ?? null;
                  const pipelineTitle = iv.pipelineTitle ?? 'Talent Pool';
                  const stageTitle = iv.stageTitle ?? iv.interviewType ?? 'Interview';

                  return (
                    <InterviewCard
                      key={iv.id}
                      interview={iv}
                      candidateName={candidateName}
                      candidateEmail={candidateEmail}
                      pipelineTitle={pipelineTitle}
                      stageTitle={stageTitle}
                      updateStatus={updateStatus}
                      sendInvite={sendInvite}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact-first interview invite */}
      <InviteCreationModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onCreateInvite={async (data: {
          recipientName: string;
          recipientEmail: string;
          meetingType: MeetingType;
          interviewType: InterviewType;
          scheduledAt?: string;
          schedulingProvider?: SchedulingProvider;
          schedulingUrl?: string;
          githubRepoUrl?: string | null;
          githubPrNumber?: number | null;
        }) => {
          const result = await api.post<{ interview: { id: string } }>(
            '/api/v1/scheduling/interviews',
            data,
          );
          let inviteResult: InviteResponse | null = null;
          let inviteError: string | undefined;
          try {
            inviteResult = await api.post<InviteResponse>(
              `/api/v1/scheduling/interviews/${result.interview.id}/invite`,
              { email: data.recipientEmail },
            );
          } catch (err) {
            inviteError = err instanceof Error ? err.message : 'Invite email could not be sent.';
          }
          await refetch();
          return {
            id: result.interview.id,
            meetingUrl: inviteResult?.deliveredUrl ?? inviteResult?.schedulingUrl ?? inviteResult?.meetingUrl ?? data.schedulingUrl ?? null,
            emailSent: inviteResult?.emailSent ?? false,
            provider: inviteResult?.provider,
            emailError: inviteResult?.emailError ?? inviteError,
          };
        }}
      />
    </div>
  );
}
