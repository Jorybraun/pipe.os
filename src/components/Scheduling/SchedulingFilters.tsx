import type { ScheduledInterview, InterviewStatus } from '../../lib/scheduling/types';

export interface SchedulingFilterState {
  pipelineId: string;   // '' = all
  status: string;        // '' = all
  /** Only show interviews scheduled within the last N days (or future). 0 = no filter */
  daysWindow: number;
}

export const DEFAULT_FILTER: SchedulingFilterState = {
  pipelineId: '',
  status:     '',
  daysWindow: 30,
};

interface Pipeline {
  id: string;
  title: string;
}

interface SchedulingFiltersProps {
  filters: SchedulingFilterState;
  onFiltersChange: (f: SchedulingFilterState) => void;
  pipelines: Pipeline[];
}

const ALL_STATUSES: Array<{ value: InterviewStatus; label: string }> = [
  { value: 'INVITED',   label: 'Invited' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NO_SHOW',   label: 'No Show' },
];

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'var(--pipe-surface)',
  border: '1px solid var(--pipe-border)',
  borderRadius: 4,
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  outline: 'none',
};

export function SchedulingFilters({ filters, onFiltersChange, pipelines }: SchedulingFiltersProps): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Pipeline filter */}
      <select
        value={filters.pipelineId}
        onChange={(e) => onFiltersChange({ ...filters, pipelineId: e.target.value })}
        style={selectStyle}
      >
        <option value="">All Pipelines</option>
        {pipelines.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={filters.status}
        onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
        style={selectStyle}
      >
        <option value="">All Statuses</option>
        {ALL_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Date window */}
      <select
        value={filters.daysWindow}
        onChange={(e) => onFiltersChange({ ...filters, daysWindow: Number(e.target.value) })}
        style={selectStyle}
      >
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
        <option value={0}>All time</option>
      </select>
    </div>
  );
}

// ============================================================================
// Filter utility
// ============================================================================

export function applySchedulingFilters(
  interviews: ScheduledInterview[],
  filters: SchedulingFilterState
): ScheduledInterview[] {
  const now = Date.now();
  const windowMs = filters.daysWindow > 0 ? filters.daysWindow * 24 * 60 * 60 * 1000 : Infinity;
  const cutoff = now - windowMs;

  return interviews.filter((iv) => {
    if (filters.pipelineId && iv.pipelineId !== filters.pipelineId) return false;
    if (filters.status     && iv.status    !== filters.status)      return false;
    if (filters.daysWindow > 0) {
      // Show if scheduledAt is in window, or if status is INVITED/SCHEDULED with no date yet
      const ref = iv.scheduledAt ? new Date(iv.scheduledAt).getTime() : now;
      if (ref < cutoff) return false;
    }
    return true;
  });
}

// ============================================================================
// Sort utility
// ============================================================================

const STATUS_ORDER: Record<InterviewStatus, number> = {
  SCHEDULED: 0,
  ACTIVE:    1,
  INVITED:   2,
  COMPLETED: 3,
  CANCELLED: 4,
  NO_SHOW:   5,
};

export function sortInterviews(interviews: ScheduledInterview[]): ScheduledInterview[] {
  return [...interviews].sort((a, b) => {
    const as = (a.status ?? 'INVITED') as InterviewStatus;
    const bs = (b.status ?? 'INVITED') as InterviewStatus;
    const statusDiff = (STATUS_ORDER[as] ?? 99) - (STATUS_ORDER[bs] ?? 99);
    if (statusDiff !== 0) return statusDiff;

    // Within SCHEDULED, sort ascending by scheduledAt
    if (as === 'SCHEDULED' && a.scheduledAt && b.scheduledAt) {
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    }
    return 0;
  });
}
