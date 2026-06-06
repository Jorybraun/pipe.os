import { FileText, AlertCircle, CheckCircle, Clock, X } from 'lucide-react';
import type { TranscriptArtifact, TranscriptEntry } from '../../lib/scheduling/types';

interface TranscriptViewerProps {
  interviewId: string;
  transcriptArtifact: TranscriptArtifact | null;
  onClose: () => void;
}

export function TranscriptViewer({ interviewId, transcriptArtifact, onClose }: TranscriptViewerProps): JSX.Element {
  // Parse transcript JSON if available
  const parsedTranscript = transcriptArtifact?.transcriptJson
    ? (JSON.parse(transcriptArtifact.transcriptJson) as TranscriptEntry[])
    : null;

  const status = transcriptArtifact?.status ?? 'PENDING';
  const errorMessage = transcriptArtifact?.errorMessage;

  const statusConfig = {
    PENDING: { icon: Clock, color: '#f59e0b', label: 'Processing' },
    COMPLETED: { icon: CheckCircle, color: '#10b981', label: 'Completed' },
    FAILED: { icon: AlertCircle, color: '#ef4444', label: 'Failed' },
  };

  const config = statusConfig[status as keyof typeof statusConfig];
  const StatusIcon = config.icon;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--pipe-surface-solid)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          width: '90%',
          maxWidth: 800,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px',
            borderBottom: '1px solid var(--pipe-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <FileText size={20} color="var(--pipe-text)" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pipe-text)' }}>
                Call Transcript
              </div>
              <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                {interviewId.slice(0, 8)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Status badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                fontSize: 10,
                letterSpacing: '0.05em',
                fontFamily: '"Space Mono", monospace',
                color: config.color,
                background: `${config.color}15`,
                border: `1px solid ${config.color}30`,
                borderRadius: 4,
              }}
            >
              <StatusIcon size={12} />
              {config.label}
            </div>
            <button
              onClick={onClose}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                background: 'transparent',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {status === 'FAILED' && errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: 16,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 8,
                marginBottom: 20,
              }}
            >
              <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>
                  Transcription Failed
                </div>
                <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', lineHeight: 1.5 }}>
                  {errorMessage}
                </div>
              </div>
            </div>
          )}

          {status === 'PENDING' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 48,
                textAlign: 'center',
              }}
            >
              <Clock size={48} color={config.color} style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: 'var(--pipe-text)', marginBottom: 8 }}>
                Transcript Processing
              </div>
              <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                The call transcript is being generated. Check back shortly.
              </div>
            </div>
          )}

          {status === 'COMPLETED' && parsedTranscript && parsedTranscript.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {parsedTranscript.map((entry, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: 12,
                    background: entry.role === 'model' ? 'rgba(96, 165, 250, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${entry.role === 'model' ? 'rgba(96, 165, 250, 0.2)' : 'var(--pipe-border)'}`,
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      minWidth: 60,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        fontFamily: '"Space Mono", monospace',
                        color: entry.role === 'model' ? '#60a5fa' : 'var(--pipe-text-dim)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {entry.role === 'model' ? 'AI' : 'USER'}
                    </div>
                    {entry.timestamp && (
                      <div
                        style={{
                          fontSize: 9,
                          color: 'var(--pipe-text-dim)',
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        {new Date(entry.timestamp).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--pipe-text)', lineHeight: 1.6 }}>
                      {entry.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : status === 'COMPLETED' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 48,
                textAlign: 'center',
              }}
            >
              <FileText size={48} color="var(--pipe-text-dim)" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: 'var(--pipe-text)', marginBottom: 8 }}>
                No Transcript Available
              </div>
              <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                The call completed but no transcript was generated.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
