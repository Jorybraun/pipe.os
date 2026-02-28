import { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, Video } from 'lucide-react';
import { requestMediaPermissions } from '../../lib/video/mediaPermissions';

// ============================================================================
// Types
// ============================================================================

interface VideoDeviceCheckProps {
  onReady: (stream: MediaStream) => void;
  onError: (type: 'denied' | 'notfound' | 'unknown') => void;
}

type CheckState = 'checking' | 'ready' | 'denied' | 'notfound' | 'unknown';

// ============================================================================
// Component
// ============================================================================

/**
 * VideoDeviceCheck — Shown before joining the video room.
 * Requests camera + mic permissions, shows a preview, and calls onReady
 * with the stream once the user confirms.
 */
export function VideoDeviceCheck({
  onReady,
  onError,
}: VideoDeviceCheckProps): JSX.Element {
  const [state, setState] = useState<CheckState>('checking');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function check(): Promise<void> {
      const result = await requestMediaPermissions(true, true);
      if (result.error) {
        setState(result.error);
        onError(result.error);
        return;
      }
      if (result.stream) {
        setStream(result.stream);
        setState('ready');
      }
    }
    void check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (previewRef.current && stream) {
      previewRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleJoin = () => {
    if (stream) onReady(stream);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        padding: 48,
        background: 'rgba(12,12,14,0.97)',
        border: '1px solid rgba(255,255,255,0.08)',
        maxWidth: 420,
        margin: '0 auto',
      }}
    >
      <Video size={32} color="rgba(255,255,255,0.3)" />

      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.5)',
          fontFamily: '"Space Mono", monospace',
          textAlign: 'center',
        }}
      >
        DEVICE_CHECK
      </div>

      {/* Status */}
      {state === 'checking' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} color="rgba(255,255,255,0.4)" className="animate-spin" />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
            Requesting camera &amp; mic access...
          </span>
        </div>
      )}

      {state === 'ready' && stream && (
        <>
          <video
            ref={previewRef}
            autoPlay
            muted
            playsInline
            style={{
              width: 240,
              height: 180,
              objectFit: 'cover',
              borderRadius: 3,
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#000',
              transform: 'scaleX(-1)',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} color="#10b981" />
            <span style={{ fontSize: 12, color: '#10b981', fontFamily: '"Space Mono", monospace' }}>
              Camera &amp; mic detected
            </span>
          </div>

          <button
            onClick={handleJoin}
            style={{
              padding: '12px 32px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(255,255,255,0.13)')
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                'rgba(255,255,255,0.08)')
            }
          >
            JOIN_INTERVIEW_ROOM
          </button>
        </>
      )}

      {(state === 'denied' || state === 'notfound' || state === 'unknown') && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} color="#ef4444" />
            <span style={{ fontSize: 12, color: '#ef4444', fontFamily: '"Space Mono", monospace' }}>
              {state === 'denied' && 'Camera/mic access was denied'}
              {state === 'notfound' && 'No camera or microphone found'}
              {state === 'unknown' && 'Could not access camera/mic'}
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.4)',
              textAlign: 'center',
              lineHeight: 1.6,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {state === 'denied'
              ? 'Please allow camera and microphone access in your browser settings and reload the page.'
              : 'Please connect a camera and microphone, then reload the page.'}
          </p>
        </>
      )}
    </div>
  );
}
