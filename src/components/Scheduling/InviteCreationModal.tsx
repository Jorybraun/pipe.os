import { useState, useEffect } from 'react';
import { X, Copy, Check, Video, Calendar, Code2, SquareTerminal } from 'lucide-react';
import { INTERVIEW_TYPE_LABELS, type InterviewType, type MeetingType, type SchedulingProvider } from '../../lib/scheduling/types';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';

interface InviteCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateInvite: (data: {
    recipientName: string;
    recipientEmail: string;
    meetingType: MeetingType;
    interviewType: InterviewType;
    scheduledAt?: string;
    schedulingProvider?: SchedulingProvider;
    schedulingUrl?: string;
  }) => Promise<{ id: string }>;
  initialInterviewType?: InterviewType;
}

const INTERVIEW_MODES: Array<{
  value: InterviewType;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: 'VIDEO', label: INTERVIEW_TYPE_LABELS.VIDEO, icon: <Video size={16} /> },
  { value: 'CODE_REVIEW', label: INTERVIEW_TYPE_LABELS.CODE_REVIEW, icon: <Code2 size={16} /> },
  { value: 'TECHNICAL', label: INTERVIEW_TYPE_LABELS.TECHNICAL, icon: <SquareTerminal size={16} /> },
];

export function InviteCreationModal({
  isOpen,
  onClose,
  onCreateInvite,
  initialInterviewType = 'VIDEO',
}: InviteCreationModalProps): JSX.Element | null {
  const { connection } = useSchedulingConnection();
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType>(initialInterviewType);
  const [scheduledAt, setScheduledAt] = useState('');
  const [schedulingMode, setSchedulingMode] = useState<'manual' | 'calendly'>('manual');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInviteId, setCreatedInviteId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setInterviewType(initialInterviewType);
      setSchedulingMode('manual');
    }
  }, [isOpen, initialInterviewType]);

  // Auto-select Calendly mode if Calendly is connected
  useEffect(() => {
    if (isOpen && connection?.status === 'ACTIVE' && connection.providerId === 'CALENDLY') {
      setSchedulingMode('calendly');
    }
  }, [isOpen, connection]);

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
  const hasCalendly = connection?.status === 'ACTIVE' && connection.providerId === 'CALENDLY';

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const inviteData: {
        recipientName: string;
        recipientEmail: string;
        meetingType: MeetingType;
        interviewType: InterviewType;
        scheduledAt?: string;
        schedulingProvider?: SchedulingProvider;
        schedulingUrl?: string;
      } = {
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        meetingType: interviewType === 'VIDEO' ? 'DIRECT_VIDEO_CALL' : 'SCREENING_INTERVIEW',
        interviewType,
      };
      
      if (schedulingMode === 'calendly' && hasCalendly) {
        inviteData.schedulingProvider = 'CALENDLY';
        // Use the first available event type from Calendly
        const eventTypes = connection.eventTypes || [];
        if (eventTypes.length > 0 && eventTypes[0]) {
          inviteData.schedulingUrl = eventTypes[0].schedulingUrl;
        }
      } else if (scheduledAt) {
        inviteData.scheduledAt = scheduledAt;
      }
      
      const result = await onCreateInvite(inviteData);
      setCreatedInviteId(result.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = () => {
    if (createdInviteId) {
      const inviteUrl = `${window.location.origin}/interviews/${createdInviteId}`;
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setRecipientName('');
    setRecipientEmail('');
    setInterviewType('VIDEO');
    setScheduledAt('');
    setSchedulingMode('manual');
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
              INTERVIEW
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--pipe-text)' }}>
              {createdInviteId ? 'Interview Created' : 'New interview'}
            </h2>
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
                Interview created for <strong>{recipientName}</strong> ({recipientEmail})
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
                  {window.location.origin}/interviews/{createdInviteId}
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
              <a
                href={`/interviews/${createdInviteId}`}
                style={{
                  padding: '10px 20px',
                  background: '#ffffff',
                  border: '1px solid #ffffff',
                  color: '#0c0c0e',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 4,
                  textDecoration: 'none',
                }}
              >
                VIEW INTERVIEW
              </a>
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
              <label style={labelStyle}>INTERVIEW TYPE</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {INTERVIEW_MODES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setInterviewType(type.value)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 16px',
                      background: interviewType === type.value ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
                      border: `1px solid ${interviewType === type.value ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                      color: interviewType === type.value ? '#60a5fa' : 'var(--pipe-text-dim)',
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

            {/* Scheduling mode selector - only show if Calendly is connected */}
            {hasCalendly && (
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>SCHEDULING MODE</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setSchedulingMode('calendly')}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 16px',
                      background: schedulingMode === 'calendly' ? 'rgba(74,222,128,0.15)' : 'var(--pipe-surface)',
                      border: `1px solid ${schedulingMode === 'calendly' ? 'rgba(74,222,128,0.3)' : 'var(--pipe-border)'}`,
                      color: schedulingMode === 'calendly' ? '#4ade80' : 'var(--pipe-text-dim)',
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                      borderRadius: 4,
                      transition: 'all 0.2s',
                    }}
                  >
                    <Calendar size={16} />
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
                      padding: '12px 16px',
                      background: schedulingMode === 'manual' ? 'rgba(96,165,250,0.15)' : 'var(--pipe-surface)',
                      border: `1px solid ${schedulingMode === 'manual' ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
                      color: schedulingMode === 'manual' ? '#60a5fa' : 'var(--pipe-text-dim)',
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                      borderRadius: 4,
                      transition: 'all 0.2s',
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

            {/* Recipient name */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>PERSON NAME</label>
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
              <label style={labelStyle}>PERSON EMAIL</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="jane@example.com"
                style={inputStyle}
              />
            </div>

            {/* Optional scheduled time - only show in manual mode */}
            {schedulingMode === 'manual' && (
              <div style={{ marginBottom: 28 }}>
                <label style={labelStyle}>WHEN (OPTIONAL)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt ? scheduledAt.slice(0, 16) : ''}
                  onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  style={inputStyle}
                />
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4 }}>
                  Leave empty to create the interview now and schedule later.
                </div>
              </div>
            )}

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
                {isCreating ? 'CREATING...' : 'CREATE INTERVIEW'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
