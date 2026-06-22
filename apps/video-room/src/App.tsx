import { useEffect, useRef, useState } from 'react';
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
import { createCompositeRecording, preferredRecordingMimeType } from './lib/recording';
import { useRoomConnection } from './hooks/useRoomConnection';
import type { RoomMetadata } from './types';

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
  const room = useRoomConnection(token, metadata.role);
  const [deviceState, setDeviceState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'uploading' | 'saved' | 'failed'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingDisposeRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setPreview(stream);
        setDeviceState('ready');
      })
      .catch(() => setDeviceState('error'));
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
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(
        composite.stream,
        mimeType ? { mimeType } : undefined,
      );
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

  const joinLobby = (): void => {
    if (!preview) return;
    room.setLocalStream(preview);
    setPreview(null);
    void postRoomEvent(token, 'JOINED');
  };

  const stopAndUploadRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setRecordingState('uploading');
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
    const blob = new Blob(recordingChunksRef.current, {
      type: recorder.mimeType || 'video/webm',
    });
    await recordingDisposeRef.current?.();
    recorderRef.current = null;
    await uploadRecording(token, blob);
    setRecordingState('saved');
  };

  const endCall = async (): Promise<void> => {
    room.hangUp();
    if (metadata.role === 'HOST') {
      try {
        await stopAndUploadRecording();
        await postRoomEvent(token, 'ENDED');
      } catch {
        setRecordingState('failed');
      }
    } else {
      await postRoomEvent(token, 'LEFT').catch(() => undefined);
    }
  };

  const inLobby = room.localStream === null;
  if (inLobby) {
    return (
      <main className="lobby">
        <section className="lobby-copy">
          <div className="brand"><span>PIPE</span> ROOM</div>
          <div className="eyebrow">{metadata.meetingType.replace(/_/g, ' ')}</div>
          <h1>{metadata.title}</h1>
          <p>{metadata.description || 'A private video meeting hosted with Pipe.'}</p>
          <div className="privacy-line">
            <ShieldCheck size={16} />
            <span>Private link · recording begins after the call connects</span>
          </div>
        </section>
        <section className="device-panel" data-testid="device-check">
          <div className="preview-shell">
            {preview && <StreamVideo stream={preview} muted className="preview-video" testId="preview-video" />}
            {deviceState === 'checking' && <Loader2 className="spin" size={28} />}
            {deviceState === 'error' && <CameraOff size={32} />}
          </div>
          <div className="device-meta">
            <span>{metadata.role === 'HOST' ? 'HOST' : 'GUEST'}</span>
            <span><Users size={13} /> {metadata.participants.length + 1}</span>
          </div>
          <button
            className="primary"
            onClick={joinLobby}
            disabled={deviceState !== 'ready'}
            data-testid="join-room"
          >
            <Video size={17} />
            Enter room
          </button>
        </section>
      </main>
    );
  }

  const canStart = metadata.role === 'HOST' && (
    room.phase === 'peer_connected' || room.phase === 'peer_disconnected'
  );
  const canAccept = metadata.role === 'GUEST' && room.phase === 'offer_received';

  return (
    <main className="call-stage" data-testid="call-stage" data-room-phase={room.phase}>
      <StreamVideo stream={room.remoteStream} className="remote-video" testId="remote-video" />
      {!room.remoteStream && (
        <div className="waiting-state" data-testid="waiting-state">
          <div className="pulse"><Users size={30} /></div>
          <h2>
            {room.phase === 'connecting'
              ? 'Connecting...'
              : metadata.role === 'HOST'
                ? 'Waiting for your guest'
                : 'Waiting for the host'}
          </h2>
          <p>The call will stay ready while the other participant joins.</p>
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
          <div className="brand"><span>PIPE</span> ROOM</div>
          <strong>{metadata.title}</strong>
        </div>
        <div className={`recording ${recordingState}`} data-testid="recording-state">
          <Circle size={9} fill="currentColor" />
          {recordingState === 'recording' ? 'Recording' : recordingState}
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
    void loadRoom(token).then(setMetadata).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to open this room.');
    });
  }, [token]);

  if (error) {
    return (
      <main className="center-message">
        <div className="brand"><span>PIPE</span> ROOM</div>
        <h1>Room unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!metadata) {
    return (
      <main className="center-message">
        <Loader2 className="spin" size={30} />
        <p>Opening secure room...</p>
      </main>
    );
  }
  return <Room token={token} metadata={metadata} />;
}
