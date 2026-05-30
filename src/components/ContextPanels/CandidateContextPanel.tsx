/**
 * CandidateContextPanel — context panel for candidate-facing interviews.
 *
 * Shows the candidate's progress through the assessment, current challenge
 * info, and any evidence/scoring signals surfaced during the session.
 */

import { type JSX } from 'react';
import { CheckCircle, Circle, Loader2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChallengeStatus = 'pending' | 'active' | 'complete';

export interface ChallengeInfo {
  id: string;
  title: string;
  type: string;
  status: ChallengeStatus;
}

export interface CandidateContextPanelProps {
  /** Candidate display name. */
  candidateName?: string;
  /** Current stage label. */
  stageName?: string;
  /** Challenge list with status. */
  challenges?: ChallengeInfo[];
  /** Current challenge index. */
  currentIndex?: number;
  /** Time remaining (formatted string). */
  timeRemaining?: string;
  /** Additional metadata to display. */
  metadata?: Record<string, string>;
}

// ─── Status icon helper ──────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ChallengeStatus }): JSX.Element {
  switch (status) {
    case 'complete':
      return <CheckCircle size={14} className="text-[var(--color-success)]" />;
    case 'active':
      return <Loader2 size={14} className="text-[var(--color-info)] animate-spin" />;
    default:
      return <Circle size={14} className="text-[var(--color-text-dim)]" />;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CandidateContextPanel({
  candidateName,
  stageName,
  challenges = [],
  currentIndex = 0,
  timeRemaining,
  metadata = {},
}: CandidateContextPanelProps): JSX.Element {
  return (
    <div className="space-y-4">
      {/* Header */}
      {(candidateName || stageName) && (
        <div className="space-y-1">
          {candidateName && (
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {candidateName}
            </h3>
          )}
          {stageName && (
            <p className="text-xs text-[var(--color-text-muted)]">{stageName}</p>
          )}
        </div>
      )}

      {/* Timer */}
      {timeRemaining && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)]">Time</span>
          <span className="ml-auto text-sm font-mono text-[var(--color-text)]">
            {timeRemaining}
          </span>
        </div>
      )}

      {/* Challenge Progress */}
      {challenges.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            Progress ({currentIndex + 1}/{challenges.length})
          </span>
          <div className="space-y-1">
            {challenges.map((ch, i) => (
              <div
                key={ch.id}
                className={[
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs',
                  i === currentIndex
                    ? 'bg-[var(--color-accent-surface)] border border-[var(--color-accent-border)]'
                    : '',
                ].join(' ')}
              >
                <StatusIcon status={ch.status} />
                <span
                  className={[
                    'flex-1 truncate',
                    i === currentIndex
                      ? 'text-[var(--color-text)] font-medium'
                      : 'text-[var(--color-text-muted)]',
                  ].join(' ')}
                >
                  {ch.title}
                </span>
                <span className="text-[var(--color-text-dim)] uppercase text-[10px]">
                  {ch.type.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      {Object.keys(metadata).length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
          {Object.entries(metadata).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-dim)]">{key}</span>
              <span className="text-[var(--color-text-muted)]">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
