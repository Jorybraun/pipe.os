import { useEffect, useRef } from 'react';
import { Loader2, Video, VideoOff } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface VideoWaitingRoomProps {
  /** Local camera preview stream */
  localStream: MediaStream | null;
  /** Whether the recruiter is ready (waiting for candidate to join the room) */
  isRecruiterWaiting: boolean;
  /** Whether the candidate has arrived in the room */
  isCandidatePresent: boolean;
  /** RECRUITER only: callback to initiate the call */
  onCall?: () => void;
  /** Role of the current user */
  role: 'RECRUITER' | 'CANDIDATE';
}

// ============================================================================
// Component
// ============================================================================

/**
 * VideoWaitingRoom — displayed before the call is initiated.
 *
 * RECRUITER sees: camera preview + "Call" button (enabled once candidate arrives).
 * CANDIDATE sees: camera preview + waiting indicator.
 */
export function VideoWaitingRoom({
  localStream,
  isRecruiterWaiting,
  isCandidatePresent,
  onCall,
  role,
}: VideoWaitingRoomProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: 48,
        minHeight: 400,
        background: 'rgba(12,12,14,0.95)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Camera preview */}
      <div style={{ position: 'relative' }}>
        {localStream ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: 280,
              height: 210,
              borderRadius: 4,
              objectFit: 'cover',
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#000',
              transform: 'scaleX(-1)', // Mirror for self-view
            }}
          />
        ) : (
          <div
            style={{
              width: 280,
              height: 210,
              borderRadius: 4,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <VideoOff size={32} color="rgba(255,255,255,0.2)" />
          </div>
        )}
      </div>

      {/* Status */}
      <div style={{ textAlign: 'center' }}>
        {role === 'RECRUITER' ? (
          <>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 24,
              }}
            >
              {isCandidatePresent
                ? 'CANDIDATE_IN_ROOM — READY_TO_CALL'
                : 'WAITING_FOR_CANDIDATE...'}
            </div>

            {!isCandidatePresent && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <Loader2
                  size={14}
                  color="rgba(255,255,255,0.3)"
                  className="animate-spin"
                />
                <span
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.3)',
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  CANDIDATE_NOT_YET_JOINED
                </span>
              </div>
            )}

            {isCandidatePresent && onCall && (
              <button
                onClick={onCall}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 32px',
                  background: '#10b981',
                  border: 'none',
                  borderRadius: 2,
                  color: '#000',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseOver={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')
                }
                onMouseOut={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.opacity = '1')
                }
              >
                <Video size={14} />
                CALL_CANDIDATE
              </button>
            )}
          </>
        ) : (
          // Candidate view
          <>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'rgba(255,255,255,0.4)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 16,
              }}
            >
              {isRecruiterWaiting
                ? 'INTERVIEWER_IS_READY — WAITING_FOR_CALL...'
                : 'CONNECTING_TO_INTERVIEW_ROOM...'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <Loader2
                size={14}
                color="rgba(255,255,255,0.3)"
                className="animate-spin"
              />
              <span
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.3)',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                STANDBY
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
