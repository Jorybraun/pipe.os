import { useState } from 'react';
import { X } from 'lucide-react';
import type { ScheduledInterview, InterviewStatus } from '../../lib/scheduling/types';
import { canTransition, getAllowedTransitions } from '../../lib/scheduling/statusTransitions';
import { InterviewStatusBadge } from './InterviewStatusBadge';

interface StatusOverrideModalProps {
  interview: ScheduledInterview;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string | undefined;
      meetingUrl?: string | undefined;
      recruiterNotes?: string | undefined;
    }
  ) => Promise<void>;
  onClose: () => void;
}

const ALL_STATUSES: InterviewStatus[] = ['INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export function StatusOverrideModal({
  interview,
  updateStatus,
  onClose,
}: StatusOverrideModalProps): JSX.Element {
  const currentStatus = (interview.status ?? 'INVITED') as InterviewStatus;

  const allowedTargets = getAllowedTransitions(currentStatus);

  const [selectedStatus, setSelectedStatus] = useState<InterviewStatus>(
    allowedTargets[0] ?? currentStatus
  );
  const [scheduledAt,   setScheduledAt]   = useState(interview.scheduledAt   ?? '');
  const [meetingUrl,    setMeetingUrl]     = useState(interview.meetingUrl    ?? '');
  const [recruiterNotes, setRecruiterNotes] = useState(interview.recruiterNotes ?? '');
  const [isSaving, setIsSaving]           = useState(false);
  const [saveError, setSaveError]         = useState<string | null>(null);

  const canSave = canTransition(currentStatus, selectedStatus);

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateStatus(interview.id, {
        status:        selectedStatus,
        scheduledAt:   scheduledAt   || undefined,
        meetingUrl:    meetingUrl    || undefined,
        recruiterNotes: recruiterNotes || undefined,
      });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--pipe-surface)',
    border: '1px solid var(--pipe-border)',
    borderRadius: 4,
    color: 'var(--pipe-text)',
    fontSize: 12,
    fontFamily: '"Space Mono", monospace',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Modal panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--pipe-bg)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
              UPDATE_STATUS
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <InterviewStatusBadge status={currentStatus} />
              <span style={{ color: 'var(--pipe-text-dim)', fontSize: 12 }}>→</span>
              {canSave && <InterviewStatusBadge status={selectedStatus} />}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Status selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            NEW STATUS
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as InterviewStatus)}
            style={{ ...inputStyle }}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s} disabled={!canTransition(currentStatus, s)}>
                {s}{canTransition(currentStatus, s) ? '' : ' (not allowed)'}
              </option>
            ))}
          </select>
        </div>

        {/* Scheduled date */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            SCHEDULED DATE/TIME
          </label>
          <input
            type="datetime-local"
            value={scheduledAt ? scheduledAt.slice(0, 16) : ''}
            onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
            style={inputStyle}
          />
        </div>

        {/* Meeting URL */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            MEETING URL
          </label>
          <input
            type="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://meet.google.com/..."
            style={inputStyle}
          />
        </div>

        {/* Recruiter notes */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            NOTES (INTERNAL)
          </label>
          <textarea
            value={recruiterNotes}
            onChange={(e) => setRecruiterNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        {saveError && (
          <p style={{ color: '#f87171', fontSize: 12, fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
            {saveError}
          </p>
        )}

        {!canSave && (
          <p style={{ color: '#fbbf24', fontSize: 11, fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
            Transition from {currentStatus} to {selectedStatus} is not allowed.
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text-muted)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            style={{
              padding: '10px 20px',
              background: canSave ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
              border: `1px solid ${canSave ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
              color: canSave ? '#60a5fa' : 'var(--pipe-text-dim)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: canSave ? 'pointer' : 'default',
              borderRadius: 4,
              transition: 'all 0.2s',
            }}
          >
            {isSaving ? 'SAVING...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}
