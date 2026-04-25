import { useReducer, useCallback, useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { VideoDeviceCheck } from './VideoDeviceCheck';
import { VideoFloatingPiP } from './VideoFloatingPiP';
import { useVideoRoom, type RoomPhase } from '../../hooks/useVideoRoom';
import { useSessionToken } from '../../contexts/SessionTokenContext';
import { useCandidateId } from '../../contexts/CandidateIdContext';
import type { SdpPayload } from '../../lib/video/types';

// ============================================================================
// State machine
// ============================================================================

type Phase =
  | { name: 'DEVICE_CHECK' }
  | { name: 'WAITING_FOR_HOST' }
  | { name: 'HOST_PREPARING' }
  | { name: 'HOST_CALLING'; offer: SdpPayload }
  | { name: 'ACCEPTING' }
  | { name: 'CONNECTED' }
  | { name: 'HOST_DISCONNECTED' }
  | { name: 'ENDED' };

type Event =
  | { type: 'DEVICES_READY' }
  | { type: 'PEER_CONNECTED' }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'OFFER_RECEIVED'; offer: SdpPayload }
  | { type: 'USER_ACCEPT' }
  | { type: 'USER_DECLINE' }
  | { type: 'WEBRTC_CONNECTED' }
  | { type: 'WEBRTC_FAILED' }
  | { type: 'HANGUP' };

function reducer(state: Phase, event: Event): Phase {
  const next = _reduce(state, event);
  if (next.name !== state.name) {
    console.log(`[VideoInterviewStep] ${state.name} → ${next.name} (event: ${event.type})`);
  }
  return next;
}

function _reduce(state: Phase, event: Event): Phase {
  switch (state.name) {
    case 'DEVICE_CHECK':
      if (event.type === 'DEVICES_READY') return { name: 'WAITING_FOR_HOST' };
      return state;

    case 'WAITING_FOR_HOST':
      if (event.type === 'PEER_CONNECTED') return { name: 'HOST_PREPARING' };
      if (event.type === 'OFFER_RECEIVED') return { name: 'HOST_CALLING', offer: event.offer };
      return state;

    case 'HOST_PREPARING':
      if (event.type === 'OFFER_RECEIVED') return { name: 'HOST_CALLING', offer: event.offer };
      if (event.type === 'PEER_DISCONNECTED') return { name: 'WAITING_FOR_HOST' };
      return state;

    case 'HOST_CALLING':
      if (event.type === 'USER_ACCEPT') return { name: 'ACCEPTING' };
      if (event.type === 'USER_DECLINE') return { name: 'ENDED' };
      if (event.type === 'PEER_DISCONNECTED') return { name: 'WAITING_FOR_HOST' };
      return state;

    case 'ACCEPTING':
      if (event.type === 'WEBRTC_CONNECTED') return { name: 'CONNECTED' };
      if (event.type === 'WEBRTC_FAILED') return { name: 'ENDED' };
      if (event.type === 'PEER_DISCONNECTED') return { name: 'WAITING_FOR_HOST' };
      return state;

    case 'CONNECTED':
      if (event.type === 'PEER_DISCONNECTED') return { name: 'HOST_DISCONNECTED' };
      if (event.type === 'HANGUP') return { name: 'ENDED' };
      return state;

    case 'HOST_DISCONNECTED':
      if (event.type === 'PEER_CONNECTED') return { name: 'HOST_PREPARING' };
      if (event.type === 'HANGUP') return { name: 'ENDED' };
      return state;

    case 'ENDED':
      return state;
  }
}

// ============================================================================
// Component
// ============================================================================

export function VideoInterviewStep(): JSX.Element {
  const sessionToken = useSessionToken();
  const ids = useCandidateId();
  const sessionId = ids ? `${ids.stageId}--${ids.candidateId}` : null;

  console.log('[VideoInterviewStep] ids:', ids, 'sessionId:', sessionId, 'sessionToken:', !!sessionToken);

  const [state, dispatch] = useReducer(reducer, { name: 'DEVICE_CHECK' });

  // Connect to DO only after device check passes
  const room = useVideoRoom({
    sessionId: state.name !== 'DEVICE_CHECK' ? sessionId : null,
    role: 'CANDIDATE',
    sessionToken,
  });

  // ONE effect: sync room.phase → state machine events
  useEffect(() => {
    const map: Partial<Record<RoomPhase, Event>> = {
      peer_connected: { type: 'PEER_CONNECTED' },
      peer_disconnected: { type: 'PEER_DISCONNECTED' },
      connected: { type: 'WEBRTC_CONNECTED' },
      error: { type: 'WEBRTC_FAILED' },
      ended: { type: 'HANGUP' },
    };

    // OFFER needs special handling (includes payload)
    if (room.phase === 'offer_received' && room.pendingOffer) {
      dispatch({ type: 'OFFER_RECEIVED', offer: room.pendingOffer });
      return;
    }

    const event = map[room.phase];
    if (event) dispatch(event);
  }, [room.phase, room.pendingOffer]);

  // Reuse the stream from VideoDeviceCheck (avoids double getUserMedia)
  const handleDevicesReady = useCallback((stream: MediaStream): void => {
    room.setExistingStream(stream);
    dispatch({ type: 'DEVICES_READY' });
  }, [room]);

  const handleAccept = useCallback((): void => {
    dispatch({ type: 'USER_ACCEPT' });
    void room.acceptCall();
  }, [room]);

  const handleDecline = useCallback((): void => {
    dispatch({ type: 'USER_DECLINE' });
    void room.hangUp();
  }, [room]);

  const handleHangUp = useCallback((): void => {
    dispatch({ type: 'HANGUP' });
    void room.hangUp();
  }, [room]);

  // ── Render: pure function of state ───────────────────────────────────

  switch (state.name) {
    case 'DEVICE_CHECK':
      return <VideoDeviceCheck onReady={handleDevicesReady} onError={() => {}} />;

    case 'WAITING_FOR_HOST':
      return (
        <StatusScreen
          stream={room.localStream}
          label="WAITING_FOR_HOST"
          message="Waiting for the interviewer to join."
          pulse
        />
      );

    case 'HOST_PREPARING':
      return (
        <StatusScreen
          stream={room.localStream}
          label="HOST_JOINED"
          message="The interviewer is preparing the session."
          color="rgba(96,165,250,0.8)"
          pulse
        />
      );

    case 'HOST_CALLING':
      return (
        <div style={CENTER}>
          <CameraPreview stream={room.localStream} glow />
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'rgba(96,165,250,0.9)', fontFamily: FONT, fontWeight: 700, animation: 'pulse 1.5s infinite' }}>
            INCOMING_VIDEO_CALL
          </div>
          <div style={{ fontSize: 13, color: DIM, fontFamily: FONT }}>
            The interviewer is calling you
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <button onClick={handleDecline} style={btn('#f87171', 'rgba(239,68,68,0.1)', 'rgba(239,68,68,0.3)')}>
              <PhoneOff size={14} /> DECLINE
            </button>
            <button onClick={handleAccept} style={btn('#34d399', 'rgba(16,185,129,0.15)', 'rgba(52,211,153,0.4)')}>
              <Phone size={14} /> ACCEPT
            </button>
          </div>
        </div>
      );

    case 'ACCEPTING':
      return (
        <StatusScreen
          stream={room.localStream}
          label="CONNECTING"
          message="Establishing secure connection..."
          color="rgba(52,211,153,0.8)"
          pulse
        />
      );

    case 'CONNECTED':
      return (
        <VideoFloatingPiP
          localStream={room.localStream}
          remoteStream={room.remoteStream}
          cameraEnabled={room.cameraEnabled}
          micEnabled={room.micEnabled}
          onToggleCamera={room.toggleCamera}
          onToggleMic={room.toggleMic}
          onHangUp={handleHangUp}
        />
      );

    case 'HOST_DISCONNECTED':
      return (
        <StatusScreen
          stream={room.localStream}
          label="HOST_DISCONNECTED"
          message="The interviewer disconnected. Waiting for them to rejoin..."
          color="rgba(251,191,36,0.8)"
          pulse
        />
      );

    case 'ENDED':
      return (
        <div style={CENTER}>
          <PhoneOff size={32} color="rgba(248,113,113,0.6)" />
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'rgba(248,113,113,0.7)', fontFamily: FONT, fontWeight: 700 }}>
            CALL_ENDED
          </div>
        </div>
      );
  }
}

// ============================================================================
// UI helpers
// ============================================================================

const FONT = '"Space Mono", monospace';
const DIM = 'var(--pipe-text-dim)';
const CENTER: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 24, padding: 48,
};

function StatusScreen({ stream, label, message, color, pulse }: {
  stream: MediaStream | null;
  label: string;
  message: string;
  color?: string;
  pulse?: boolean;
}): JSX.Element {
  return (
    <div style={CENTER}>
      <CameraPreview stream={stream} />
      <div style={{ fontSize: 11, letterSpacing: '0.15em', fontFamily: FONT, fontWeight: 700, color: color ?? 'rgba(52,211,153,0.8)' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: DIM, fontFamily: FONT, lineHeight: 1.6 }}>
        {message}
      </div>
      {pulse && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color ?? 'rgba(52,211,153,0.6)', animation: 'pulse 2s infinite' }} />
          STANDBY
        </div>
      )}
    </div>
  );
}

function CameraPreview({ stream, glow }: { stream: MediaStream | null; glow?: boolean }): JSX.Element | null {
  if (!stream) return null;
  return (
    <video
      autoPlay muted playsInline
      ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
      style={{
        width: 320, height: 240, borderRadius: 4, objectFit: 'cover',
        border: glow ? '1px solid rgba(96,165,250,0.4)' : '1px solid var(--pipe-border)',
        background: '#000', transform: 'scaleX(-1)',
        ...(glow ? { boxShadow: '0 0 20px rgba(96,165,250,0.15)' } : {}),
      }}
    />
  );
}

function btn(color: string, bg: string, border: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
    background: bg, border: `1px solid ${border}`, borderRadius: 4,
    color, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
    fontFamily: FONT, cursor: 'pointer',
  };
}
