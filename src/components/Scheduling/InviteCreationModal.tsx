import { useState, useEffect } from 'react';
import { X, Copy, Check, Video, User, Mail, Calendar } from 'lucide-react';
import type { MeetingType } from '../../lib/scheduling/types';

interface InviteCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateInvite: (data: {
    recipientName: string;
    recipientEmail: string;
    meetingType: MeetingType;
    scheduledAt?: string;
  }) => Promise<{ id: string }>;
  initialMeetingType?: MeetingType;
}

const MEETING_TYPES: Array<{ value: MeetingType; label: string; icon: React.ReactNode }> = [
  { value: 'DIRECT_VIDEO_CALL', label: 'Direct Video Call', icon: <Video size={16} /> },
  { value: 'SCREENING_INTERVIEW', label: 'Screening Interview', icon: <User size={16} /> },
];

export function InviteCreationModal({
  isOpen,
  onClose,
  onCreateInvite,
  initialMeetingType = 'DIRECT_VIDEO_CALL',
}: InviteCreationModalProps): JSX.Element | null {
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [meetingType, setMeetingType] = useState<MeetingType>(initialMeetingType);
  const [scheduledAt, setScheduledAt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInviteId, setCreatedInviteId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset meeting type when modal opens with new initial type
  useEffect(() => {
    if (isOpen) {
      setMeetingType(initialMeetingType);
    }
  }, [isOpen, initialMeetingType]);

  if (!isOpen) return null;

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

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    letterSpacing: '0.15em',
    color: 'var(--pipe-text-dim)',
    fontFamily: '"Space Mono", monospace',
    marginBottom: 8,
  };

  const canCreate = recipientName.trim().length > 0 && recipientEmail.trim().length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await onCreateInvite({
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        meetingType,
        scheduledAt: scheduledAt || undefined,
      });
      setCreatedInviteId(result.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = () => {
    if (createdInviteId) {
      const inviteUrl = `${window.location.origin}/invite/${createdInviteId}`;
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setRecipientName('');
    setRecipientEmail('');
    setMeetingType('DIRECT_VIDEO_CALL');
    setScheduledAt('');
    setCreateError(null);
    setCreatedInviteId(null);
    setCopied(false);
    onClose();
  };

  return (
    <div
      onClick={handleClose}
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
              CREATE_INVITE
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pipe-text)' }}>
              {createdInviteId ? 'Invite Created' : 'New Meeting Invite'}
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {createdInviteId ? (
          /* Success state with invite link */
          <div>
            <div
              style={{
                padding: 20,
                background: 'rgba(74,222,128,0.08)',
                border: '1px solid rgba(74,222,128,0.15)',
                borderRadius: 8,
                marginBottom: 24,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', marginBottom: 12, fontFamily: '"Space Mono", monospace' }}>
                Invite link created for <strong>{recipientName}</strong> ({recipientEmail})
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                }}
              >
                <div style={{ flex: 1, fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {window.location.origin}/invite/{createdInviteId}
                </div>
                <button
                  onClick={handleCopy}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
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
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'COPIED' : 'COPY'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
                style={{
                  padding: '10px 20px',
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
          </div>
        ) : (
          /* Form state */
          <div>
            {/* Meeting type selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>MEETING TYPE</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {MEETING_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setMeetingType(type.value)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 16px',
                      background: meetingType === type.value ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
                      border: `1px solid ${meetingType === type.value ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                      color: meetingType === type.value ? '#60a5fa' : 'var(--pipe-text-dim)',
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                      borderRadius: 4,
                      transition: 'all 0.2s',
                    }}
                  >
                    {type.icon}
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipient name */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>RECIPIENT NAME</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Jane Doe"
                style={inputStyle}
              />
            </div>

            {/* Recipient email */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>RECIPIENT EMAIL</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="jane@example.com"
                style={inputStyle}
              />
            </div>

            {/* Optional scheduled time */}
            <div style={{ marginBottom: 28 }}>
              <label style={labelStyle}>SCHEDULED TIME (OPTIONAL)</label>
              <input
                type="datetime-local"
                value={scheduledAt ? scheduledAt.slice(0, 16) : ''}
                onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
                style={inputStyle}
              />
              <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4 }}>
                Leave empty for instant invite
              </div>
            </div>

            {createError && (
              <p style={{ color: '#f87171', fontSize: 12, fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
                {createError}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={handleClose}
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
                onClick={handleCreate}
                disabled={!canCreate || isCreating}
                style={{
                  padding: '10px 20px',
                  background: canCreate ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
                  border: `1px solid ${canCreate ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                  color: canCreate ? '#60a5fa' : 'var(--pipe-text-dim)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: canCreate ? 'pointer' : 'default',
                  borderRadius: 4,
                  transition: 'all 0.2s',
                }}
              >
                {isCreating ? 'CREATING...' : 'CREATE INVITE'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
