import { useState } from 'react';
import { X, Mail, Check } from 'lucide-react';
import type { ScheduledInterview } from '../../lib/scheduling/types';

interface InviteToCallModalProps {
  interview: ScheduledInterview;
  candidateEmail?: string | null | undefined;
  onSend: (interviewId: string, email: string, message?: string) => Promise<void>;
  onClose: () => void;
}

export function InviteToCallModal({
  interview,
  candidateEmail,
  onSend,
  onClose,
}: InviteToCallModalProps): JSX.Element {
  const [email, setEmail] = useState(candidateEmail ?? '');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSend = async () => {
    if (!isValidEmail || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await onSend(interview.id, email, message || undefined);
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setIsSending(false);
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
              INVITE_TO_CALL
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={16} color="var(--pipe-text-dim)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pipe-text)' }}>
                Send Video Call Invite
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Check size={40} color="#4ade80" style={{ marginBottom: 16 }} />
            <p style={{ fontSize: 14, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
              Invite sent to <strong>{email}</strong>
            </p>
            <p style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              They'll receive a link to join the video call.
            </p>
            <button
              onClick={onClose}
              style={{
                marginTop: 24,
                padding: '10px 24px',
                background: 'rgba(96,165,250,0.15)',
                border: '1px solid rgba(96,165,250,0.3)',
                color: '#60a5fa',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              DONE
            </button>
          </div>
        ) : (
          <>
            {/* Email field */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
                EMAIL ADDRESS
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="candidate@example.com"
                autoFocus
                style={inputStyle}
              />
            </div>

            {/* Optional message */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
                MESSAGE (OPTIONAL)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Add a personal note to the invitation..."
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {sendError && (
              <p style={{ color: '#f87171', fontSize: 12, fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
                {sendError}
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
                onClick={handleSend}
                disabled={!isValidEmail || isSending}
                style={{
                  padding: '10px 20px',
                  background: isValidEmail ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
                  border: `1px solid ${isValidEmail ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                  color: isValidEmail ? '#60a5fa' : 'var(--pipe-text-dim)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: isValidEmail ? 'pointer' : 'default',
                  borderRadius: 4,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Mail size={12} />
                {isSending ? 'SENDING...' : 'SEND INVITE'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
