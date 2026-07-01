import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, UserPlus, X, CheckCircle2, XCircle } from 'lucide-react';
import { useScheduledInterviews } from '../../hooks/useScheduledInterviews';
import { useBookingNotifications, type BookingNotification } from '../../hooks/useBookingNotifications';
import { useApiClient } from '../../hooks/useApiClient';
import { InterviewCard } from './InterviewCard';
import { InviteCreationModal } from './InviteCreationModal';
import { Skeleton } from '../ui/Skeleton';
import type {
  AssessmentProgressSnapshot,
  AssessmentSetupProjection,
  InterviewType,
  MeetingType,
  ScheduledInterview,
  SchedulingProvider,
} from '../../lib/scheduling/types';

// Timeline grouping
type TimelineGroup = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'LATER' | 'PAST' | 'UNSCHEDULED';
type InterviewSortMode = 'CREATED_DESC' | 'TIMELINE' | 'CREATED_ASC';
type InterviewListGroup = TimelineGroup | 'CREATED_DESC' | 'CREATED_ASC';
type AssessmentFilterMode = 'ALL' | 'ACTION_NEEDED' | 'READY_TO_EVALUATE' | 'NEEDS_ATTENTION' | 'EVALUATED';
type InterviewTypeFilterMode = 'ALL' | 'STANDARD_CALLS' | 'CODE_REVIEW' | 'DEV_CONTAINER_CHALLENGE' | 'OPEN_SOURCE_BUG_FIX';

interface InvitePrefill {
  recipientName: string;
  recipientEmail: string;
  interviewType: InterviewType;
  recruiterNotes: string;
}

interface InviteResponse {
  success: boolean;
  emailSent: boolean;
  meetingUrl: string;
  schedulingUrl?: string | null;
  deliveredUrl?: string | null;
  provider?: string;
  emailError?: string;
}

interface StartAssessmentEvaluationResponse {
  progress: AssessmentProgressSnapshot;
  report?: {
    id: string;
    sessionId: string;
    status: string;
    contextRecordId: string | null;
  } | null;
  diagnostic?: {
    id: string;
    sessionId: string;
    reportId: string | null;
    code: string;
    severity: string;
  } | null;
}

export function resolveInviteCreationGuestLink(
  inviteResult: Pick<InviteResponse, 'meetingUrl' | 'schedulingUrl' | 'deliveredUrl'> | null,
): string | null {
  // `deliveredUrl` can be a provider scheduling page. The modal should show
  // the Pipe room link that host/recruiter can open immediately.
  return inviteResult?.meetingUrl ?? null;
}

function isInterviewType(value: string | null): value is InterviewType {
  return value === 'VIDEO'
    || value === 'SCREENING'
    || value === 'CULTURE'
    || value === 'CODE_REVIEW'
    || value === 'DEV_CONTAINER_CHALLENGE'
    || value === 'OPEN_SOURCE_BUG_FIX';
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

const CREATED_LABELS: Record<Exclude<InterviewListGroup, TimelineGroup>, string> = {
  CREATED_DESC: 'NEWEST CREATED',
  CREATED_ASC: 'OLDEST CREATED',
};

const SORT_OPTIONS: ReadonlyArray<{ label: string; value: InterviewSortMode }> = [
  { label: 'Newest', value: 'CREATED_DESC' },
  { label: 'Timeline', value: 'TIMELINE' },
  { label: 'Oldest', value: 'CREATED_ASC' },
];

const ASSESSMENT_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: AssessmentFilterMode }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Action needed', value: 'ACTION_NEEDED' },
  { label: 'Ready to evaluate', value: 'READY_TO_EVALUATE' },
  { label: 'Needs attention', value: 'NEEDS_ATTENTION' },
  { label: 'Evaluated', value: 'EVALUATED' },
];

const INTERVIEW_TYPE_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: InterviewTypeFilterMode }> = [
  { label: 'All modes', value: 'ALL' },
  { label: 'Standard calls', value: 'STANDARD_CALLS' },
  { label: 'Code review', value: 'CODE_REVIEW' },
  { label: 'Dev container', value: 'DEV_CONTAINER_CHALLENGE' },
  { label: 'Open source', value: 'OPEN_SOURCE_BUG_FIX' },
];

function getGroupLabel(group: InterviewListGroup): string {
  return group in TIMELINE_LABELS
    ? TIMELINE_LABELS[group as TimelineGroup]
    : CREATED_LABELS[group as Exclude<InterviewListGroup, TimelineGroup>];
}

function getCreatedTime(interview: ScheduledInterview): number {
  const time = new Date(interview.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareByCreatedNewest(a: ScheduledInterview, b: ScheduledInterview): number {
  const createdDiff = getCreatedTime(b) - getCreatedTime(a);
  return createdDiff === 0 ? a.id.localeCompare(b.id) : createdDiff;
}

function compareByCreatedOldest(a: ScheduledInterview, b: ScheduledInterview): number {
  const createdDiff = getCreatedTime(a) - getCreatedTime(b);
  return createdDiff === 0 ? a.id.localeCompare(b.id) : createdDiff;
}

function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function assessmentFilterBucket(interview: ScheduledInterview): Exclude<AssessmentFilterMode, 'ALL' | 'ACTION_NEEDED'> | null {
  const progress = interview.assessmentProgress ?? null;
  if (progress?.readiness?.status === 'EVALUATED' || progress?.readiness?.isUsableHiringSignal) return 'EVALUATED';
  if (progress?.readiness?.status === 'NEEDS_ATTENTION') return 'NEEDS_ATTENTION';
  if (progress?.readiness?.isReadyForEvaluation) return 'READY_TO_EVALUATE';
  if (progress?.evaluation?.status === 'EVALUATED') return 'EVALUATED';
  if (
    progress?.stage === 'NEEDS_ATTENTION'
    || progress?.nextAction === 'RESOLVE_DIAGNOSTIC'
    || (progress?.evaluation && progress.evaluation.status !== 'EVALUATED')
    || interview.assessmentSetup?.blocksPositiveAssessment
  ) {
    return 'NEEDS_ATTENTION';
  }
  if (progress?.nextAction === 'START_EVALUATION' || progress?.stage === 'READY_FOR_EVALUATION') {
    return 'READY_TO_EVALUATE';
  }
  return null;
}

function matchesAssessmentFilter(interview: ScheduledInterview, filter: AssessmentFilterMode): boolean {
  if (filter === 'ALL') return true;
  const bucket = assessmentFilterBucket(interview);
  if (filter === 'ACTION_NEEDED') {
    return bucket === 'READY_TO_EVALUATE' || bucket === 'NEEDS_ATTENTION';
  }
  return bucket === filter;
}

function interviewTypeFilterBucket(interview: ScheduledInterview): InterviewTypeFilterMode {
  switch (interview.interviewType) {
    case 'CODE_REVIEW':
      return 'CODE_REVIEW';
    case 'DEV_CONTAINER_CHALLENGE':
      return 'DEV_CONTAINER_CHALLENGE';
    case 'OPEN_SOURCE_BUG_FIX':
      return 'OPEN_SOURCE_BUG_FIX';
    default:
      return 'STANDARD_CALLS';
  }
}

function matchesInterviewTypeFilter(interview: ScheduledInterview, filter: InterviewTypeFilterMode): boolean {
  if (filter === 'ALL') return true;
  return interviewTypeFilterBucket(interview) === filter;
}

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
  const {
    interviews,
    isLoading,
    isLoadingMore = false,
    error,
    total = interviews.length,
    hasMore = false,
    updateStatus,
    sendInvite,
    refetch,
    loadMore = async () => undefined,
  } = useScheduledInterviews();
  const { notifications, isConnected } = useBookingNotifications();
  const api = useApiClient();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitePrefill, setInvitePrefill] = useState<InvitePrefill>({
    recipientName: '',
    recipientEmail: '',
    interviewType: 'VIDEO',
    recruiterNotes: '',
  });
  const [sortMode, setSortMode] = useState<InterviewSortMode>('CREATED_DESC');
  const [interviewTypeFilter, setInterviewTypeFilter] = useState<InterviewTypeFilterMode>('ALL');
  const [assessmentFilter, setAssessmentFilter] = useState<AssessmentFilterMode>('ALL');
  const [searchParams, setSearchParams] = useSearchParams();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenNotificationIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const requestedInterviewType = searchParams.get('interviewType');
    setInvitePrefill({
      recipientName: searchParams.get('recipientName') ?? '',
      recipientEmail: searchParams.get('recipientEmail') ?? '',
      interviewType: isInterviewType(requestedInterviewType) ? requestedInterviewType : 'VIDEO',
      recruiterNotes: searchParams.get('recruiterNotes') ?? '',
    });
    setShowInviteModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('recipientName');
    next.delete('recipientEmail');
    next.delete('interviewType');
    next.delete('recruiterNotes');
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

  const startAssessmentEvaluation = useCallback(async (interviewId: string): Promise<StartAssessmentEvaluationResponse> => {
    const result = await api.post<StartAssessmentEvaluationResponse>(
      `/api/v1/scheduling/interviews/${interviewId}/assessment/start-evaluation`,
      {},
    );
    await refetch();
    return result;
  }, [api, refetch]);

  const assessmentFilterCounts = useMemo(() => {
    const counts: Record<AssessmentFilterMode, number> = {
      ALL: interviews.length,
      ACTION_NEEDED: 0,
      READY_TO_EVALUATE: 0,
      NEEDS_ATTENTION: 0,
      EVALUATED: 0,
    };
    for (const interview of interviews) {
      const bucket = assessmentFilterBucket(interview);
      if (!bucket) continue;
      counts[bucket] += 1;
      if (bucket === 'READY_TO_EVALUATE' || bucket === 'NEEDS_ATTENTION') {
        counts.ACTION_NEEDED += 1;
      }
    }
    return counts;
  }, [interviews]);

  const interviewTypeFilterCounts = useMemo(() => {
    const counts: Record<InterviewTypeFilterMode, number> = {
      ALL: interviews.length,
      STANDARD_CALLS: 0,
      CODE_REVIEW: 0,
      DEV_CONTAINER_CHALLENGE: 0,
      OPEN_SOURCE_BUG_FIX: 0,
    };
    for (const interview of interviews) {
      counts[interviewTypeFilterBucket(interview)] += 1;
    }
    return counts;
  }, [interviews]);

  const visibleInterviews = useMemo(
    () => interviews.filter((interview) =>
      matchesInterviewTypeFilter(interview, interviewTypeFilter)
      && matchesAssessmentFilter(interview, assessmentFilter)
    ),
    [assessmentFilter, interviewTypeFilter, interviews],
  );
  const loadedInterviewCount = interviews.length;
  const totalInterviewCount = Math.max(total, loadedInterviewCount);
  const hasActiveInterviewFilter = assessmentFilter !== 'ALL' || interviewTypeFilter !== 'ALL';
  const interviewCountLabel = !hasActiveInterviewFilter
    ? hasMore
      ? `${loadedInterviewCount} loaded · ${totalInterviewCount} total`
      : `${loadedInterviewCount} total`
    : hasMore
      ? `${visibleInterviews.length} shown · ${loadedInterviewCount} loaded · ${totalInterviewCount} total`
      : `${visibleInterviews.length} shown · ${loadedInterviewCount} total`;

  // Group interviews by the selected recruiter view.
  const groupedInterviews = useMemo(() => {
    if (sortMode === 'CREATED_DESC') {
      return [
        ['CREATED_DESC', [...visibleInterviews].sort(compareByCreatedNewest)],
      ] as Array<[InterviewListGroup, ScheduledInterview[]]>;
    }

    if (sortMode === 'CREATED_ASC') {
      return [
        ['CREATED_ASC', [...visibleInterviews].sort(compareByCreatedOldest)],
      ] as Array<[InterviewListGroup, ScheduledInterview[]]>;
    }

    const groups = new Map<TimelineGroup, ScheduledInterview[]>();

    visibleInterviews.forEach((iv) => {
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
        [...ivs].sort((a, b) => {
          if (!a.scheduledAt) return 1;
          if (!b.scheduledAt) return -1;
          const scheduleDiff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
          return scheduleDiff === 0 ? compareByCreatedNewest(a, b) : scheduleDiff;
        }),
      ] as [InterviewListGroup, ScheduledInterview[]]);

    return sorted;
  }, [sortMode, visibleInterviews]);

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
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text)', letterSpacing: 0 }}>
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
            {interviewCountLabel}
          </span>
          <div
            role="group"
            aria-label="Interview sort"
            style={{
              display: 'inline-grid',
              gridTemplateColumns: 'repeat(3, minmax(72px, 1fr))',
              border: '1px solid var(--pipe-border)',
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--pipe-surface-solid)',
              minHeight: 32,
            }}
          >
            {SORT_OPTIONS.map((option) => {
              const active = sortMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSortMode(option.value)}
                  style={{
                    border: 'none',
                    borderLeft: option.value === 'CREATED_DESC' ? 'none' : '1px solid var(--pipe-border)',
                    background: active ? 'var(--pipe-text)' : 'transparent',
                    color: active ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    minHeight: 32,
                    padding: '0 10px',
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div
            role="group"
            aria-label="Assessment filter"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 6,
              maxWidth: 560,
            }}
          >
            {ASSESSMENT_FILTER_OPTIONS.map((option) => {
              const active = assessmentFilter === option.value;
              const count = assessmentFilterCounts[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAssessmentFilter(option.value)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 30,
                    padding: '0 10px',
                    border: `1px solid ${active ? '#93c5fd' : 'var(--pipe-border)'}`,
                    borderRadius: 6,
                    background: active ? 'rgba(147,197,253,0.14)' : 'transparent',
                    color: active ? '#bfdbfe' : 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{option.label}</span>
                  <span style={{ color: active ? '#dbeafe' : 'var(--pipe-text-muted)' }}>{count}</span>
                </button>
              );
            })}
          </div>
          <div
            role="group"
            aria-label="Interview mode filter"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 6,
              maxWidth: 560,
            }}
          >
            {INTERVIEW_TYPE_FILTER_OPTIONS.map((option) => {
              const active = interviewTypeFilter === option.value;
              const count = interviewTypeFilterCounts[option.value];
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setInterviewTypeFilter(option.value)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 30,
                    padding: '0 10px',
                    border: `1px solid ${active ? '#4ade80' : 'var(--pipe-border)'}`,
                    borderRadius: 6,
                    background: active ? 'rgba(74,222,128,0.12)' : 'transparent',
                    color: active ? '#bbf7d0' : 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>{option.label}</span>
                  <span style={{ color: active ? '#dcfce7' : 'var(--pipe-text-muted)' }}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timeline groups */}
      {visibleInterviews.length === 0 ? (
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
            {interviews.length === 0
              ? 'No interviews yet. Create one for any person; role context can be added later.'
              : 'No interviews match this assessment view.'}
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
                {getGroupLabel(group)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ivs.map((iv) => {
                  const candidateName = firstNonBlank(
                    iv.recipientName,
                    iv.candidateName,
                    iv.recipientEmail,
                    iv.candidateEmail,
                    iv.candidateId?.slice(0, 8),
                  ) ?? 'Unknown person';
                  const candidateEmail = firstNonBlank(iv.recipientEmail, iv.candidateEmail);
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
                      startAssessmentEvaluation={startAssessmentEvaluation}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                style={{
                  minHeight: 36,
                  padding: '0 18px',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  background: 'var(--pipe-surface-solid)',
                  color: 'var(--pipe-text)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  cursor: isLoadingMore ? 'wait' : 'pointer',
                }}
              >
                {isLoadingMore ? 'LOADING...' : `LOAD MORE (${totalInterviewCount - loadedInterviewCount} REMAINING)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Contact-first interview invite */}
      <InviteCreationModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        initialRecipientName={invitePrefill.recipientName}
        initialRecipientEmail={invitePrefill.recipientEmail}
        initialInterviewType={invitePrefill.interviewType}
        initialRecruiterNotes={invitePrefill.recruiterNotes}
        onCreateInvite={async (data: {
          recipientName: string;
          recipientEmail: string;
          meetingType: MeetingType;
          interviewType: InterviewType;
          recruiterNotes?: string;
          scheduledAt?: string;
          schedulingProvider?: SchedulingProvider;
          schedulingUrl?: string;
          githubRepoUrl?: string | null;
          githubPrNumber?: number | null;
          features?: {
            videoEnabled: boolean;
            workspaceEnabled: boolean;
            recordingEnabled: boolean;
            aiAssistantEnabled: boolean;
          };
        }) => {
          const result = await api.post<{
            interview: {
              id: string;
              assessmentSetup?: AssessmentSetupProjection | null;
            };
          }>(
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
            meetingUrl: resolveInviteCreationGuestLink(inviteResult),
            emailSent: inviteResult?.emailSent ?? false,
            provider: inviteResult?.provider,
            emailError: inviteResult?.emailError ?? inviteError,
            assessmentSetup: result.interview.assessmentSetup ?? null,
          };
        }}
      />
    </div>
  );
}
