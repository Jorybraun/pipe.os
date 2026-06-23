import type { InterviewStatus } from '../../lib/scheduling/types';

const STATUS_STYLES: Record<InterviewStatus, { label: string; color: string; bg: string }> = {
  INVITED:   { label: 'Invited',   color: 'var(--pipe-text-muted)', bg: 'var(--pipe-surface-hover)' },
  SCHEDULED: { label: 'Scheduled', color: '#60a5fa',               bg: 'rgba(96,165,250,0.12)' },
  ACTIVE:    { label: 'Active',    color: '#a78bfa',               bg: 'rgba(167,139,250,0.12)' },
  COMPLETED: { label: 'Completed', color: '#4ade80',               bg: 'rgba(74,222,128,0.12)' },
  CANCELLED: { label: 'Cancelled', color: '#f87171',               bg: 'rgba(248,113,113,0.12)' },
  NO_SHOW:   { label: 'No Show',   color: '#fbbf24',               bg: 'rgba(251,191,36,0.12)' },
};

interface InterviewStatusBadgeProps {
  status: InterviewStatus;
}

export function InterviewStatusBadge({ status }: InterviewStatusBadgeProps): JSX.Element {
  const style = STATUS_STYLES[status];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        fontFamily: '"Space Mono", monospace',
        color: style.color,
        background: style.bg,
        border: `1px solid ${style.color}30`,
      }}
    >
      {style.label.toUpperCase()}
    </span>
  );
}
