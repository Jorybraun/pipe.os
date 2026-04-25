import { Video, VideoOff, Mic, MicOff, PhoneOff } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface VideoControlsProps {
  cameraEnabled: boolean;
  micEnabled: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onHangUp: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * VideoControls — Horizontal bar with camera toggle, mic toggle, and hang-up button.
 * Used inside VideoFloatingPiP and can be reused in other video layouts.
 */
export function VideoControls({
  cameraEnabled,
  micEnabled,
  onToggleCamera,
  onToggleMic,
  onHangUp,
}: VideoControlsProps): JSX.Element {
  const iconButtonStyle = (active: boolean): React.CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: `1px solid ${active ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.4)'}`,
    background: active ? 'rgba(255,255,255,0.05)' : 'rgba(239,68,68,0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'rgba(0,0,0,0.6)',
        borderTop: '1px solid var(--pipe-border)',
      }}
    >
      {/* Microphone */}
      <button
        onClick={onToggleMic}
        style={iconButtonStyle(micEnabled)}
        aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        title={micEnabled ? 'Mute mic' : 'Unmute mic'}
      >
        {micEnabled ? (
          <Mic size={15} color="var(--pipe-text-dim)" />
        ) : (
          <MicOff size={15} color="#ef4444" />
        )}
      </button>

      {/* Hang up */}
      <button
        onClick={onHangUp}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: '#ef4444',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
        onMouseOver={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.opacity = '0.8')
        }
        onMouseOut={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.opacity = '1')
        }
        aria-label="End call"
        title="End call"
      >
        <PhoneOff size={16} color="#fff" />
      </button>

      {/* Camera */}
      <button
        onClick={onToggleCamera}
        style={iconButtonStyle(cameraEnabled)}
        aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
        title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
      >
        {cameraEnabled ? (
          <Video size={15} color="var(--pipe-text-dim)" />
        ) : (
          <VideoOff size={15} color="#ef4444" />
        )}
      </button>
    </div>
  );
}
