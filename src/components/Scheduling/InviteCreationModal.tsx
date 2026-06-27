import { useState, useEffect } from 'react';
import { X, Copy, Check, Video, Calendar, Code2, GitBranch } from 'lucide-react';
import { INTERVIEW_TYPE_LABELS, type InterviewType, type MeetingType, type SchedulingProvider } from '../../lib/scheduling/types';
import { useSchedulingConnection } from '../../hooks/useSchedulingConnection';

interface InviteCreationData {
  recipientName: string;
  recipientEmail: string;
  meetingType: MeetingType;
  interviewType: InterviewType;
  scheduledAt?: string;
  schedulingProvider?: SchedulingProvider;
  schedulingUrl?: string;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
  features?: {
    videoEnabled: boolean;
    workspaceEnabled: boolean;
    recordingEnabled: boolean;
    clippyEnabled: boolean;
  };
  agentType?: string | null;
}

interface InviteCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateInvite: (data: InviteCreationData) => Promise<{
    id: string;
    meetingUrl?: string | null;
    emailSent?: boolean;
    provider?: string | undefined;
    emailError?: string | undefined;
  }>;
  initialInterviewType?: InterviewType;
}

interface CreatedInviteState {
  id: string;
  meetingUrl: string | null;
  emailSent: boolean | null;
  provider?: string | undefined;
  emailError?: string | undefined;
}

const INTERVIEW_MODES: Array<{
  value: InterviewType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: 'VIDEO',
    label: INTERVIEW_TYPE_LABELS.VIDEO,
    description: 'Live video call',
    icon: <Video size={16} />,
  },
  {
    value: 'CODE_REVIEW',
    label: INTERVIEW_TYPE_LABELS.CODE_REVIEW,
    description: 'Async pull request review',
    icon: <Code2 size={16} />,
  },
  {
    value: 'DEV_CONTAINER_CHALLENGE',
    label: INTERVIEW_TYPE_LABELS.DEV_CONTAINER_CHALLENGE,
    description: 'Live dev-container challenge (auto-matched or manual repo)',
    icon: <GitBranch size={16} />,
  },
];

function meetingTypeForInterviewType(interviewType: InterviewType): MeetingType {
  return interviewType === 'SCREENING' ? 'SCREENING_INTERVIEW' : 'DIRECT_VIDEO_CALL';
}

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
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubPrNumber, setGithubPrNumber] = useState('');
  const [manualRepoOverride, setManualRepoOverride] = useState(false);
  const [schedulingMode, setSchedulingMode] = useState<'manual' | 'calendly'>('manual');
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [workspaceEnabled, setWorkspaceEnabled] = useState(true);
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [clippyEnabled, setClippyEnabled] = useState(true);
  const [agentType, setAgentType] = useState<string>('none');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInviteState | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setInterviewType(initialInterviewType);
      setSchedulingMode('manual');
      setGithubRepoUrl('');
      setGithubPrNumber('');
    }
  }, [isOpen, initialInterviewType]);

  // Auto-select Calendly mode for live interviews when Calendly is connected.
  useEffect(() => {
    if (
      isOpen
      && interviewType !== 'CODE_REVIEW'
      && connection?.status === 'ACTIVE'
      && connection.providerId === 'CALENDLY'
    ) {
      setSchedulingMode('calendly');
    }
  }, [isOpen, connection, interviewType]);

  useEffect(() => {
    if (interviewType === 'CODE_REVIEW') {
      setSchedulingMode('manual');
    }
  }, [interviewType]);

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

  const hasCalendly = connection?.status === 'ACTIVE' && connection.providerId === 'CALENDLY';
  const calendlyEventTypes = connection?.eventTypes ?? [];
  const selectedCalendlyEventType = calendlyEventTypes[0] ?? null;
  const canUseCalendly = hasCalendly && Boolean(selectedCalendlyEventType?.schedulingUrl);
  const supportsManualRepoOverride = interviewType === 'CODE_REVIEW' || interviewType === 'DEV_CONTAINER_CHALLENGE';
  const showsRoomFeatures = interviewType !== 'CODE_REVIEW';
  const parsedPrNumber = githubPrNumber.trim().length > 0
    ? Number.parseInt(githubPrNumber.trim(), 10)
    : null;
  const hasManualRepoUrl = githubRepoUrl.trim().length > 0;
  const hasManualPrNumber = parsedPrNumber !== null && Number.isFinite(parsedPrNumber) && parsedPrNumber > 0;
  const manualRepoOverrideComplete = !manualRepoOverride || (hasManualRepoUrl && hasManualPrNumber);
  const canCreate = recipientName.trim().length > 0
    && recipientEmail.trim().length > 0
    && (parsedPrNumber === null || hasManualPrNumber)
    && (!supportsManualRepoOverride || manualRepoOverrideComplete)
    && (schedulingMode !== 'calendly' || canUseCalendly);
  const createButtonLabel = isCreating
    ? 'CREATING...'
    : interviewType === 'CODE_REVIEW'
      ? 'CREATE ASSESSMENT INVITE'
      : schedulingMode === 'calendly'
      ? 'SEND SCHEDULING LINK'
      : 'CREATE ROOM INVITE';
  const linkLabel = interviewType === 'CODE_REVIEW' ? 'Assessment link' : 'Guest link';

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const inviteData: InviteCreationData = {
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        meetingType: meetingTypeForInterviewType(interviewType),
        interviewType,
      };

      if (supportsManualRepoOverride && manualRepoOverride) {
        const trimmedRepoUrl = githubRepoUrl.trim();
        if (trimmedRepoUrl) {
          inviteData.githubRepoUrl = trimmedRepoUrl;
        }
        if (parsedPrNumber !== null) {
          inviteData.githubPrNumber = parsedPrNumber;
        }
      }

      inviteData.features = {
        videoEnabled,
        workspaceEnabled,
        recordingEnabled,
        clippyEnabled,
      };
      if (agentType !== 'none') {
        inviteData.agentType = agentType;
      }
      
      if (schedulingMode === 'calendly' && canUseCalendly && selectedCalendlyEventType) {
        inviteData.schedulingProvider = 'CALENDLY';
        inviteData.schedulingUrl = selectedCalendlyEventType.schedulingUrl;
      } else if (scheduledAt) {
        inviteData.scheduledAt = scheduledAt;
      }
      
      const result = await onCreateInvite(inviteData);
      setCreatedInvite({
        id: result.id,
        meetingUrl: result.meetingUrl ?? null,
        emailSent: typeof result.emailSent === 'boolean' ? result.emailSent : null,
        provider: result.provider,
        emailError: result.emailError,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = () => {
    if (createdInvite?.meetingUrl) {
      navigator.clipboard.writeText(createdInvite.meetingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setRecipientName('');
    setRecipientEmail('');
    setInterviewType('VIDEO');
    setScheduledAt('');
    setGithubRepoUrl('');
    setGithubPrNumber('');
    setSchedulingMode('manual');
    setCreateError(null);
    setCreatedInvite(null);
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
              {createdInvite ? 'Invite Ready' : 'New interview'}
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

        {createdInvite ? (
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
              <div style={{ fontSize: 11, color: createdInvite.emailSent ? '#4ade80' : 'var(--pipe-text-dim)', marginBottom: 12, fontFamily: '"Space Mono", monospace', lineHeight: 1.5 }}>
                {createdInvite.emailSent === true
                  ? `Invite email sent${createdInvite.provider ? ` via ${createdInvite.provider}` : ''}.`
                  : createdInvite.emailError
                    ? `${linkLabel} is ready, but email delivery failed. Copy and send it manually.`
                    : `${linkLabel} is ready. Copy it or send it from the interview page.`}
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
                  {createdInvite.meetingUrl ?? `Open the interview to prepare a ${linkLabel.toLowerCase()}.`}
                </div>
                <button
                  onClick={handleCopy}
                  disabled={!createdInvite.meetingUrl}
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
                    cursor: createdInvite.meetingUrl ? 'pointer' : 'default',
                    opacity: createdInvite.meetingUrl ? 1 : 0.45,
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
                href={`/interviews/${createdInvite.id}`}
                style={{
                  padding: '10px 20px',
                  background: 'var(--pipe-text)',
                  border: '1px solid var(--pipe-accent-border)',
                  color: 'var(--pipe-bg)',
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {INTERVIEW_MODES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setInterviewType(type.value)}
                    style={{
                      display: 'flex',
                      minHeight: 74,
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '12px 10px',
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
                    <span>{type.label}</span>
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.03em',
                        color: interviewType === type.value ? 'rgba(191,219,254,0.85)' : 'var(--pipe-text-muted)',
                        lineHeight: 1.35,
                        textAlign: 'center',
                      }}
                    >
                      {type.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>SCHEDULING</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <button
                  onClick={() => setSchedulingMode('manual')}
                  style={{
                    display: 'flex',
                    minHeight: 64,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '12px 14px',
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <Video size={15} />
                    {interviewType === 'CODE_REVIEW' ? 'Assessment invite' : 'Room invite'}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.03em' }}>
                    {interviewType === 'CODE_REVIEW' ? 'Send the assess link' : 'Send a private room link'}
                  </span>
                </button>
                <button
                  onClick={() => setSchedulingMode('calendly')}
                  style={{
                    display: 'flex',
                    minHeight: 64,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '12px 14px',
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <Calendar size={15} />
                    Calendly link
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--pipe-text-muted)', letterSpacing: '0.03em' }}>
                    Let them pick a time
                  </span>
                </button>
              </div>
              {schedulingMode === 'calendly' && (
                <div style={{ fontSize: 10, color: canUseCalendly ? '#4ade80' : '#fbbf24', fontFamily: '"Space Mono", monospace', marginTop: 6, lineHeight: 1.5 }}>
                  {canUseCalendly
                    ? `Will send ${selectedCalendlyEventType?.name ?? 'your Calendly event'} scheduling link.`
                    : hasCalendly
                      ? 'Calendly is connected, but no event type is available yet.'
                      : 'Calendly is not connected. Open Settings, then Integrations, to connect Calendly.'}
                </div>
              )}
            </div>

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

            {supportsManualRepoOverride && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>CHALLENGE REPO</label>
                  <button
                    type="button"
                    onClick={() => setManualRepoOverride(!manualRepoOverride)}
                    style={{
                      fontSize: 10,
                      fontFamily: '"Space Mono", monospace',
                      color: manualRepoOverride ? 'var(--pipe-text-dim)' : '#60a5fa',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {manualRepoOverride ? 'Use auto-match instead' : 'Specify repo manually'}
                  </button>
                </div>
                {manualRepoOverride ? (
                  <>
                    <input
                      type="url"
                      value={githubRepoUrl}
                      onChange={(e) => setGithubRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      style={inputStyle}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 8 }}>
                      <input
                        type="number"
                        min={1}
                        value={githubPrNumber}
                        onChange={(e) => setGithubPrNumber(e.target.value)}
                        placeholder="PR number"
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4, lineHeight: 1.5 }}>
                      Manual override — this assessment will use the specified repo/PR.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', lineHeight: 1.5, padding: '8px 0' }}>
                    The matcher will select a source-backed PR challenge based on candidate evidence.
                  </div>
                )}
              </div>
            )}

            {/* Feature flags */}
            {showsRoomFeatures && (
            <div style={{ marginBottom: 28 }}>
              <label style={labelStyle}>ROOM FEATURES</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={videoEnabled} onChange={(e) => setVideoEnabled(e.target.checked)} />
                  Video
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={workspaceEnabled} onChange={(e) => setWorkspaceEnabled(e.target.checked)} />
                  Workspace
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={recordingEnabled} onChange={(e) => setRecordingEnabled(e.target.checked)} />
                  Recording
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={clippyEnabled} onChange={(e) => setClippyEnabled(e.target.checked)} />
                  Clippy AI
                </label>
              </div>
            </div>
            )}

            {/* Agent selection */}
            {clippyEnabled && showsRoomFeatures && supportsManualRepoOverride && (
              <div style={{ marginBottom: 28 }}>
                <label style={labelStyle}>AI AGENT</label>
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  style={inputStyle}
                >
                  <option value="none">No agent</option>
                  <option value="devin">Devin CLI</option>
                </select>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4 }}>
                  Launches an AI pair programmer inside the dev container.
                </div>
              </div>
            )}

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
                {createButtonLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
