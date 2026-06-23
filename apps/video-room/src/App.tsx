import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Camera,
  CameraOff,
  Circle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import { loadRoom, postRoomEvent, uploadRecording } from './lib/api';
import { createCompositeRecording, preferredRecordingOptions } from './lib/recording';
import { useRoomConnection } from './hooks/useRoomConnection';
import type { IceServerProvider, RoomMetadata } from './types';

function PipeMark({ className }: { className?: string }): JSX.Element {
  return (
    <img
      className={className}
      src="/pipe-room-mark.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

function BrandMark({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? 'brand compact' : 'brand'} aria-label="PIPE room">
      <PipeMark className="brand-logo" />
      <span className="brand-word" data-text="PIPE">PIPE</span>
      <span className="brand-chip">Room</span>
    </div>
  );
}

function RoomStateMark({
  icon,
  loading = false,
  variant = 'default',
}: {
  icon?: JSX.Element;
  loading?: boolean;
  variant?: 'default' | 'error';
}): JSX.Element {
  return (
    <div
      className={`state-mark${loading ? ' is-loading' : ''}${variant === 'error' ? ' is-error' : ''}`}
      aria-hidden="true"
    >
      <span className="state-orbit" />
      <span className="state-scan" />
      <PipeMark className="state-logo" />
      {icon && <span className="state-icon">{icon}</span>}
    </div>
  );
}

function DevicePlaceholder({
  state,
}: {
  state: 'checking' | 'ready' | 'error';
}): JSX.Element {
  if (state === 'ready') {
    return (
      <div className="device-placeholder" aria-hidden="true">
        <PipeMark className="device-placeholder-logo" />
      </div>
    );
  }

  return (
    <div className="device-placeholder">
      <RoomStateMark
        loading={state === 'checking'}
        variant={state === 'error' ? 'error' : 'default'}
        icon={state === 'error' ? <CameraOff size={18} /> : undefined}
      />
      <span>{state === 'checking' ? 'Preparing camera and microphone' : 'Camera and microphone access needed'}</span>
    </div>
  );
}

function relayLabel(provider: IceServerProvider): string {
  switch (provider) {
    case 'cloudflare':
      return 'Relay Cloudflare';
    case 'metered':
      return 'Relay Metered';
    case 'fallback':
      return 'STUN fallback';
    case 'unknown':
    default:
      return 'Network pending';
  }
}

function StreamVideo({
  stream,
  muted = false,
  className,
  testId,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className: string;
  testId?: string;
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} data-testid={testId} />;
}

function Room({ token, metadata }: { token: string; metadata: RoomMetadata }): JSX.Element {
  const [enteredRoom, setEnteredRoom] = useState(false);
  const room = useRoomConnection(token, metadata.role, enteredRoom);
  const [deviceState, setDeviceState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'uploading' | 'saved' | 'failed'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingDisposeRef = useRef<(() => Promise<void>) | null>(null);
  const autoAcceptingRef = useRef(false);
  const endingRef = useRef(false);
  const deviceRequestRef = useRef(0);

  const requestDevices = useCallback(async (): Promise<void> => {
    const requestId = deviceRequestRef.current + 1;
    deviceRequestRef.current = requestId;
    setDeviceState('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (deviceRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setPreview(stream);
      setDeviceState('ready');
    } catch {
      if (deviceRequestRef.current === requestId) {
        setDeviceState('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = deviceRequestRef.current + 1;
    deviceRequestRef.current = requestId;
    setDeviceState('checking');
    void navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled || deviceRequestRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setPreview(stream);
        setDeviceState('ready');
      })
      .catch(() => {
        if (!cancelled && deviceRequestRef.current === requestId) {
          setDeviceState('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (
      metadata.role !== 'HOST' ||
      room.phase !== 'connected' ||
      !room.localStream ||
      !room.remoteStream ||
      recorderRef.current
    ) return;

    void createCompositeRecording(room.localStream, room.remoteStream).then((composite) => {
      const recorder = new MediaRecorder(composite.stream, preferredRecordingOptions());
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      recordingDisposeRef.current = composite.dispose;
      setRecordingState('recording');
      void postRoomEvent(token, 'STARTED');
    }).catch(() => setRecordingState('failed'));
  }, [metadata.role, room.localStream, room.phase, room.remoteStream, token]);

  useEffect(() => {
    if (metadata.role !== 'GUEST' || room.phase !== 'offer_received' || autoAcceptingRef.current) {
      return;
    }
    autoAcceptingRef.current = true;
    void room.acceptCall().finally(() => {
      autoAcceptingRef.current = false;
    });
  }, [metadata.role, room.acceptCall, room.phase]);

  const joinLobby = (): void => {
    if (!preview) return;
    room.setLocalStream(preview);
    setPreview(null);
    setEnteredRoom(true);
    void postRoomEvent(token, 'JOINED');
  };

  const stopAndUploadRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      await recordingDisposeRef.current?.();
      recorderRef.current = null;
      recordingDisposeRef.current = null;
      return;
    }
    setRecordingState('uploading');
    try {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      await uploadRecording(token, blob);
      setRecordingState('saved');
    } finally {
      await recordingDisposeRef.current?.().catch(() => undefined);
      recorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingChunksRef.current = [];
    }
  };

  const endCall = async (): Promise<void> => {
    if (endingRef.current) return;
    endingRef.current = true;
    room.hangUp();
    if (metadata.role === 'HOST') {
      let failed = false;
      try {
        await postRoomEvent(token, 'ENDED');
      } catch {
        failed = true;
      }
      try {
        await stopAndUploadRecording();
      } catch {
        failed = true;
      }
      if (failed) {
        setRecordingState('failed');
      }
    } else {
      await postRoomEvent(token, 'LEFT').catch(() => undefined);
    }
  };

  const inLobby = room.localStream === null;
  if (inLobby) {
    const isDeviceChecking = deviceState === 'checking';
    const hasDeviceError = deviceState === 'error';
    const joinButtonLabel = hasDeviceError
      ? 'Allow camera and microphone'
      : isDeviceChecking
        ? 'Preparing devices'
        : 'Enter room';
    const joinButtonHint = hasDeviceError
      ? 'Enable camera and microphone access in your browser, then try again.'
      : isDeviceChecking
        ? 'PIPE is preparing your camera and microphone preview.'
        : 'You will enter the private room with camera and microphone ready.';
    const joinButtonIcon = hasDeviceError
      ? <CameraOff size={17} />
      : isDeviceChecking
        ? <Loader2 size={17} className="spin" />
        : <Video size={17} />;

    return (
      <main className="lobby">
        <section className="lobby-copy">
          <BrandMark />
          <div className="brand-line" />
          <div className="eyebrow">{metadata.meetingType.replace(/_/g, ' ')}</div>
          <h1>{metadata.title}</h1>
          {metadata.description && <p>{metadata.description}</p>}
          <div className="privacy-line">
            <ShieldCheck size={16} />
            <span>Private link · recording begins after the call connects</span>
          </div>
        </section>
        <section className="device-panel" data-testid="device-check">
          <div className="device-brand">
            <PipeMark className="device-brand-logo" />
            <span>PIPE room prejoin</span>
          </div>
          <div className="preview-shell">
            {preview && <StreamVideo stream={preview} muted className="preview-video" testId="preview-video" />}
            {!preview && <DevicePlaceholder state={deviceState} />}
          </div>
          <div className="device-meta">
            <span>Camera preview</span>
            <span><ShieldCheck size={13} /> Private room</span>
          </div>
          <button
            className={`primary${hasDeviceError ? ' is-action-needed' : ''}`}
            onClick={hasDeviceError ? () => void requestDevices() : joinLobby}
            disabled={isDeviceChecking}
            data-testid="join-room"
          >
            {joinButtonIcon}
            {joinButtonLabel}
          </button>
          <p className="join-hint">{joinButtonHint}</p>
        </section>
      </main>
    );
  }

  const canStart = metadata.role === 'HOST' && (
    room.phase === 'peer_connected' || room.phase === 'peer_disconnected'
  );
  const canAccept = metadata.role === 'GUEST' && room.phase === 'offer_received';
  const isConnecting = room.phase === 'connecting';
  const isRoomError = room.phase === 'error';
  const recordingLabel = {
    idle: 'Ready',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Save issue',
  }[recordingState];

  return (
    <main className="call-stage" data-testid="call-stage" data-room-phase={room.phase}>
      <StreamVideo stream={room.remoteStream} className="remote-video" testId="remote-video" />
      {!room.remoteStream && (
        <div className="waiting-state" data-testid="waiting-state">
          <BrandMark />
          <RoomStateMark
            loading={isConnecting}
            variant={isRoomError ? 'error' : 'default'}
            icon={!isConnecting ? <Users size={24} /> : undefined}
          />
          <h2>
            {isRoomError
              ? 'Connection interrupted'
              : isConnecting
              ? 'Connecting...'
              : metadata.role === 'HOST'
                ? 'Waiting for your guest'
                : 'Waiting for the host'}
          </h2>
          <p>
            {isRoomError
              ? 'Refresh the room link when you are ready to try again.'
              : 'The room stays ready while the other participant joins.'}
          </p>
          {canStart && (
            <button className="primary" onClick={() => void room.startCall()} data-testid="start-call">
              <Video size={17} /> Start call
            </button>
          )}
          {canAccept && (
            <button className="primary" onClick={() => void room.acceptCall()} data-testid="accept-call">
              <Video size={17} /> Join call
            </button>
          )}
        </div>
      )}

      <header className="call-header">
        <div>
          <BrandMark compact />
          <strong>{metadata.title}</strong>
        </div>
        <div className="call-badges">
          <div className={`network is-${room.iceProvider}`} data-testid="network-provider">
            {relayLabel(room.iceProvider)}
          </div>
          <div className={`recording is-${recordingState}`} data-testid="recording-state">
            <Circle size={9} fill="currentColor" />
            {recordingLabel}
          </div>
        </div>
      </header>

      <div className="local-tile">
        <StreamVideo stream={room.localStream} muted className="local-video" testId="local-video" />
        <span>You</span>
      </div>

      <div className="controls">
        <button onClick={room.toggleMic} aria-label="Toggle microphone">
          {room.micEnabled ? <Mic /> : <MicOff />}
        </button>
        <button className="hangup" onClick={() => void endCall()} aria-label="End call" data-testid="end-call">
          <PhoneOff />
        </button>
        <button onClick={room.toggleCamera} aria-label="Toggle camera">
          {room.cameraEnabled ? <Camera /> : <CameraOff />}
        </button>
      </div>

      {room.phase === 'ended' && (
        <div className="ended-overlay">
          <BrandMark />
          <RoomStateMark />
          <h2>Call ended</h2>
          <p>
            {metadata.role === 'HOST' && recordingState === 'uploading'
              ? 'Saving the recording and starting transcription...'
              : 'You can close this window.'}
          </p>
        </div>
      )}
    </main>
  );
}

export default function App(): JSX.Element {
  const location = useLocation();
  const token = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [metadata, setMetadata] = useState<RoomMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This room link is invalid.');
      return;
    }
    void loadRoom(token).then(setMetadata).catch(() => {
      setError('This room link is expired or unavailable.');
    });
  }, [token]);

  if (error) {
    return (
      <main className="center-message is-error">
        <BrandMark />
        <RoomStateMark variant="error" />
        <h1>PIPE room unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!metadata) {
    return (
      <main className="center-message is-loading">
        <BrandMark />
        <RoomStateMark loading />
        <h1>Opening secure PIPE room</h1>
        <p>Checking room access.</p>
      </main>
    );
  }
  return <Room token={token} metadata={metadata} />;
}
