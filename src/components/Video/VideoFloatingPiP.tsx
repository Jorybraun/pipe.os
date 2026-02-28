import { useEffect, useRef, useState } from 'react';
import { VideoControls } from './VideoControls';

// ============================================================================
// Types
// ============================================================================

interface VideoFloatingPiPProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
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
 * VideoFloatingPiP — A draggable picture-in-picture panel that floats over
 * the challenge workspace while a live video session is active.
 *
 * Layout: remote video (large) + local self-view (small, bottom-right corner)
 * + control bar below.
 */
export function VideoFloatingPiP({
  localStream,
  remoteStream,
  cameraEnabled,
  micEnabled,
  onToggleCamera,
  onToggleMic,
  onHangUp,
}: VideoFloatingPiPProps): JSX.Element {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Drag state — start top-right (adjusted in useEffect for actual viewport)
  const [position, setPosition] = useState({ x: 0, y: 24 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);

  // Set initial position to top-right on mount
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setPosition({ x: window.innerWidth - 280 - 24, y: 24 });
    }
  }, []);

  // Wire streams to video elements
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't start drag on the control bar buttons
    if ((e.target as HTMLElement).closest('button')) return;
    dragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onMouseUp = () => { dragging.current = false; };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        width: 280,
        background: '#0c0c0e',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 6,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        zIndex: 9000,
        cursor: 'grab',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Remote video (main view) */}
      <div style={{ position: 'relative', background: '#000', aspectRatio: '4/3' }}>
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <span
              style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.2)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.15em',
              }}
            >
              CONNECTING...
            </span>
          </div>
        )}

        {/* Local self-view (PiP within PiP) */}
        {localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              width: 72,
              height: 54,
              objectFit: 'cover',
              borderRadius: 3,
              border: '1px solid rgba(255,255,255,0.15)',
              background: '#000',
              transform: 'scaleX(-1)',
            }}
          />
        )}
      </div>

      {/* Controls */}
      <VideoControls
        cameraEnabled={cameraEnabled}
        micEnabled={micEnabled}
        onToggleCamera={onToggleCamera}
        onToggleMic={onToggleMic}
        onHangUp={onHangUp}
      />
    </div>
  );
}
