import { Phone, PhoneOff } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface VideoIncomingCallProps {
  onAccept: () => void;
  onDecline: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * VideoIncomingCall — full-screen overlay shown to the candidate when
 * the recruiter initiates a call. Phone-call-style accept / decline buttons.
 */
export function VideoIncomingCall({
  onAccept,
  onDecline,
}: VideoIncomingCallProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 40,
        zIndex: 9999,
      }}
    >
      {/* Pulsing ring */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: '50%',
            border: '2px solid rgba(16,185,129,0.4)',
            animation: 'pulse-ring 1.5s ease-out infinite',
          }}
        />
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(16,185,129,0.15)',
            border: '1px solid rgba(16,185,129,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Phone size={32} color="#10b981" />
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
            marginBottom: 8,
            letterSpacing: '-0.02em',
          }}
        >
          Incoming Interview Call
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          YOUR_INTERVIEWER_IS_CALLING
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 32 }}>
        {/* Decline */}
        <button
          onClick={onDecline}
          aria-label="Decline call"
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'rgba(239,68,68,0.3)')
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'rgba(239,68,68,0.15)')
          }
        >
          <PhoneOff size={24} color="#ef4444" />
        </button>

        {/* Accept */}
        <button
          onClick={onAccept}
          aria-label="Accept call"
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(16,185,129,0.2)',
            border: '1px solid rgba(16,185,129,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseOver={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'rgba(16,185,129,0.35)')
          }
          onMouseOut={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              'rgba(16,185,129,0.2)')
          }
        >
          <Phone size={24} color="#10b981" />
        </button>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
