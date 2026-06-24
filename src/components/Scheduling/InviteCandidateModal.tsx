import { useState, useEffect } from 'react';
import { X, UserPlus, Send, Calendar } from 'lucide-react';
import { useApiClient } from '../../hooks/useApiClient';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';
import { INTERVIEW_TYPE_LABELS, type InterviewType, type SchedulingProvider } from '../../lib/scheduling/types';

interface InviteCandidateModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function InviteCandidateModal({
  onClose,
  onSuccess,
}: InviteCandidateModalProps): JSX.Element {
  const api = useApiClient();
  const { connection } = useSchedulingConnection();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType | ''>('VIDEO');
  const [scheduledAt, setScheduledAt] = useState('');
  const [schedulingMode, setSchedulingMode] = useState<'manual' | 'calendly'>('manual');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isValid = name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const hasCalendly = connection?.status === 'ACTIVE' && connection.providerId === 'CALENDLY';

  // Auto-select Calendly mode if Calendly is connected
  useEffect(() => {
    if (hasCalendly) {
      setSchedulingMode('calendly');
    }
  }, [hasCalendly]);

  const handleSubmit = async (): Promise<void> => {
    if (!isValid || isSending) return;
    setIsSending(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        skipEmail: true,
        ...(interviewType ? { interviewType } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      };

      if (schedulingMode === 'calendly' && hasCalendly) {
        payload.schedulingProvider = 'CALENDLY' as SchedulingProvider;
        // Use the first available event type from Calendly
        const eventTypes = connection.eventTypes || [];
        if (eventTypes.length > 0 && eventTypes[0]) {
          payload.schedulingUrl = eventTypes[0].schedulingUrl;
        }
      } else if (scheduledAt) {
        payload.scheduledAt = scheduledAt;
      }

      await api.post('/api/v1/candidates', payload);
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create interview';
      setError(msg);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        zIndex: 9999,
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--pipe-surface-solid)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          padding: 32,
          width: '100%',
          maxWidth: 480,
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserPlus size={18} color="var(--pipe-text)" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace', margin: 0 }}>
              NEW INTERVIEW
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pipe-text-dim)', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ color: '#4ade80', fontFamily: '"Space Mono", monospace', fontSize: 14, fontWeight: 700 }}>
              INTERVIEW CREATED
            </p>
            <p style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12, marginTop: 8 }}>
              {name} ({email}) has been added to interviews.
            </p>
          </div>
        ) : (
          <>
            {/* Name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                NAME *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-text)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                EMAIL *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-text)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Interview Type */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                INTERVIEW TYPE
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['VIDEO', 'TECHNICAL', 'SCREENING', 'CODE_REVIEW', 'DEV_CONTAINER_CHALLENGE'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setInterviewType(interviewType === type ? '' : type)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: `1px solid ${interviewType === type ? 'var(--pipe-accent-border)' : 'var(--pipe-border)'}`,
                      background: interviewType === type ? 'var(--pipe-accent-surface)' : 'transparent',
                      color: interviewType === type ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      fontSize: 11,
                      letterSpacing: '0.05em',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {INTERVIEW_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {/* Scheduling mode selector - only show if Calendly is connected */}
            {hasCalendly && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                  SCHEDULING MODE
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setSchedulingMode('calendly')}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: `1px solid ${schedulingMode === 'calendly' ? 'rgba(74,222,128,0.3)' : 'var(--pipe-border)'}`,
                      background: schedulingMode === 'calendly' ? 'rgba(74,222,128,0.08)' : 'transparent',
                      color: schedulingMode === 'calendly' ? '#4ade80' : 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      fontSize: 11,
                      letterSpacing: '0.05em',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Calendar size={14} />
                    Calendly Link
                  </button>
                  <button
                    onClick={() => setSchedulingMode('manual')}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: `1px solid ${schedulingMode === 'manual' ? 'var(--pipe-accent-border)' : 'var(--pipe-border)'}`,
                      background: schedulingMode === 'manual' ? 'var(--pipe-accent-surface)' : 'transparent',
                      color: schedulingMode === 'manual' ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      fontSize: 11,
                      letterSpacing: '0.05em',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    Manual Time
                  </button>
                </div>
                {schedulingMode === 'calendly' && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4 }}>
                    Guest will receive a Calendly link to self-schedule
                  </div>
                )}
              </div>
            )}

            {/* Scheduled At (optional) - only show in manual mode */}
            {schedulingMode === 'manual' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                  SCHEDULE FOR (OPTIONAL)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 6,
                    color: 'var(--pipe-text)',
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 13,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Custom message */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                MESSAGE (OPTIONAL)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a personal note to the interview invite..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-text)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 13,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <p style={{ color: '#f87171', fontFamily: '"Space Mono", monospace', fontSize: 12, marginBottom: 16 }}>
                {error}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 20px',
                  borderRadius: 6,
                  border: '1px solid var(--pipe-border)',
                  background: 'transparent',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isValid || isSending}
                style={{
                  padding: '10px 20px',
                  borderRadius: 6,
                  border: `1px solid ${isValid && !isSending ? 'var(--pipe-accent-border)' : 'var(--pipe-border)'}`,
                  background: isValid && !isSending ? 'var(--pipe-text)' : 'var(--pipe-surface)',
                  color: isValid && !isSending ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isValid && !isSending ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Send size={13} />
                {isSending ? 'CREATING...' : 'CREATE INTERVIEW'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
