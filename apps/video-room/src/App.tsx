import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CameraOff,
  Circle,
  Loader2,
  Mic,
  MicOff,
  PanelRightClose,
  PhoneOff,
  RefreshCcw,
  ShieldCheck,
  SquareTerminal,
  Users,
  Video,
} from 'lucide-react';
import { Window, WindowHeader, WindowContent, Button as Win95Button } from 'react95';
import { ThemeProvider, createGlobalStyle } from 'styled-components';
import original from 'react95/dist/themes/original';
import {
  getRoomWorkspace,
  launchRoomWorkspace,
  loadRoom,
  postRoomEvent,
  roomWorkspaceProxyUrl,
  uploadRecording,
} from './lib/api';
import {
  createCompositeRecording,
  preferredAudioRecordingOptions,
  preferredRecordingOptions,
} from './lib/recording';
import { useRoomConnection } from './hooks/useRoomConnection';
import type { IceServerProvider, RoomMetadata, RoomWorkspace } from './types';

type RecordingState = 'idle' | 'starting' | 'recording' | 'uploading' | 'saved' | 'failed';

const pipeWin95Theme = {
  ...original,
  headerBackground: '#0a2135',
  headerText: '#b9e2ff',
  headerNotActiveBackground: '#061625',
  headerNotActiveText: 'rgba(185, 226, 255, 0.5)',
  desktopBackground: '#008080',
  canvas: '#03101d',
  canvasText: '#f4f8ff',
  material: '#0a2135',
  materialText: '#f4f8ff',
  materialDark: '#061625',
  materialTextInvert: '#b9e2ff',
  anchor: '#7fc7ff',
  anchorVisited: '#7fc7ff',
  progress: '#7fc7ff',
  hoverBackground: 'rgba(127, 199, 255, 0.12)',
};

const Win95GlobalStyles = createGlobalStyle`
  .win95-font { font-family: 'MS Sans Serif', 'Segoe UI', Tahoma, sans-serif; }
`;

function PipeMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 1000 1000"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M 740 500 L 740 752 A 120 120 0 0 1 500 752 L 500 248 A 120 120 0 0 0 260 248 L 260 500"
        stroke="currentColor"
        strokeWidth="192"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
      <rect x="615" y="450" width="250" height="100" fill="currentColor" />
      <rect x="135" y="450" width="250" height="100" fill="currentColor" />
    </svg>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? 'brand compact' : 'brand'} aria-label="PIPE room">
      <span className="brand-logo-shell">
        <PipeMark className="brand-logo" />
      </span>
      <span className="brand-word">PIPE</span>
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
        <span>Camera ready</span>
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

function isSyntheticMedia(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getTracks().some((track) => /fake|synthetic|virtual/i.test(track.label));
}

function Room({ token, metadata }: { token: string; metadata: RoomMetadata }): JSX.Element {
  const [enteredRoom, setEnteredRoom] = useState(false);
  const room = useRoomConnection(token, metadata.role, enteredRoom);
  const [workspace, setWorkspace] = useState<RoomWorkspace | null>(metadata.workspace ?? null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceRepoInput, setWorkspaceRepoInput] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [deviceState, setDeviceState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionChunksRef = useRef<Blob[]>([]);
  const recordingDisposeRef = useRef<(() => Promise<void>) | null>(null);
  const autoAcceptingRef = useRef(false);
  const endingRef = useRef(false);
  const deviceRequestRef = useRef(0);
  const callStartedRef = useRef(false);
  const recordingStartedRef = useRef(false);

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
      callStartedRef.current ||
      room.phase !== 'connected' ||
      !room.localStream ||
      !room.remoteStream
    ) return;
    callStartedRef.current = true;
    void postRoomEvent(token, 'STARTED');
  }, [metadata.role, room.localStream, room.phase, room.remoteStream, token]);

  useEffect(() => {
    setWorkspace(metadata.workspace ?? null);
  }, [metadata.workspace]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (!workspace?.canLaunch) return;
    try {
      setWorkspace(await getRoomWorkspace(token));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Workspace status failed.');
    }
  }, [token, workspace?.canLaunch]);

  const launchWorkspace = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const repoUrl = workspace?.repoUrl ?? (workspaceRepoInput.trim() || undefined);
      setWorkspace(await launchRoomWorkspace(token, repoUrl));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Workspace launch failed.');
    } finally {
      setWorkspaceLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!workspace?.canLaunch) return undefined;
    const status = workspace.session?.status;
    if (status !== 'LAUNCHING') return undefined;
    const timer = window.setInterval(() => {
      void refreshWorkspace();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspace, workspace?.canLaunch, workspace?.session?.status]);

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

  const startRecording = useCallback(async (): Promise<void> => {
    if (
      metadata.role !== 'HOST' ||
      room.phase !== 'connected' ||
      !room.localStream ||
      !room.remoteStream ||
      recorderRef.current
    ) return;

    let dispose: (() => Promise<void>) | null = null;
    setRecordingError(null);
    setRecordingState('starting');
    setRecordingNotice('Starting recording...');
    try {
      const composite = await createCompositeRecording(room.localStream, room.remoteStream);
      dispose = composite.dispose;
      const recorder = new MediaRecorder(composite.stream, preferredRecordingOptions());
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      const transcriptionTracks = composite.transcriptionStream.getAudioTracks();
      let transcriptionRecorder: MediaRecorder | null = null;
      if (transcriptionTracks.length > 0) {
        transcriptionRecorder = new MediaRecorder(
          composite.transcriptionStream,
          preferredAudioRecordingOptions(),
        );
        transcriptionRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) transcriptionChunksRef.current.push(event.data);
        };
        transcriptionRecorder.start(1000);
      }

      recorder.start(1000);
      recorderRef.current = recorder;
      transcriptionRecorderRef.current = transcriptionRecorder;
      recordingDisposeRef.current = composite.dispose;
      recordingStartedRef.current = true;
      setRecordingNotice('Recording started. Transcript processing begins after the host ends the call.');
      setRecordingState('recording');
      void postRoomEvent(token, 'RECORDING_STARTED').catch(() => {
        setRecordingNotice('Recording started. Status will sync when the call ends.');
      });
    } catch (error) {
      await dispose?.().catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Recording could not start.';
      setRecordingState('failed');
      setRecordingError(message);
    }
  }, [metadata.role, room.localStream, room.phase, room.remoteStream, token]);

  const stopRecorder = async (recorder: MediaRecorder | null): Promise<void> => {
    if (!recorder || recorder.state === 'inactive') return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
  };

  const stopAndUploadRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      await recordingDisposeRef.current?.();
      recorderRef.current = null;
      transcriptionRecorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
      if (metadata.role === 'HOST') {
        setRecordingNotice('No recording was captured because the call never reached an active recorded state.');
      }
      return;
    }
    setRecordingState('uploading');
    setRecordingError(null);
    setRecordingNotice('Saving recording and starting transcript processing...');
    try {
      await Promise.all([
        stopRecorder(recorder),
        stopRecorder(transcriptionRecorderRef.current),
      ]);
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      const transcriptionRecorder = transcriptionRecorderRef.current;
      const transcriptionAudio = transcriptionChunksRef.current.length > 0
        ? new Blob(transcriptionChunksRef.current, {
            type: transcriptionRecorder?.mimeType || 'audio/webm',
          })
        : undefined;
      console.log('[room] Uploading recording', {
        token,
        recordingBytes: blob.size,
        recordingType: blob.type,
        hasTranscriptionAudio: Boolean(transcriptionAudio),
        transcriptionBytes: transcriptionAudio?.size ?? 0,
        iceProvider: room.iceProvider,
      });
      const result = await uploadRecording(token, blob, transcriptionAudio);
      console.log('[room] Recording upload succeeded', {
        accepted: result.accepted,
        transcriptStatus: result.transcriptStatus,
      });
      setRecordingState('saved');
      setRecordingNotice(
        result.transcriptStatus === 'PROCESSING'
          ? 'Recording saved. Transcript processing has started.'
          : 'Recording saved.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording upload failed.';
      console.error('[room] Recording upload failed', {
        token,
        message,
        stack: error instanceof Error ? error.stack : undefined,
        iceProvider: room.iceProvider,
        recordingChunks: recordingChunksRef.current.length,
        transcriptionChunks: transcriptionChunksRef.current.length,
      });
      setRecordingState('failed');
      setRecordingError(message);
      throw error;
    } finally {
      await recordingDisposeRef.current?.().catch(() => undefined);
      recorderRef.current = null;
      transcriptionRecorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
    }
  };

  const endCall = async (): Promise<void> => {
    if (endingRef.current) return;
    endingRef.current = true;
    if (
      metadata.role === 'HOST' &&
      !recordingStartedRef.current &&
      !window.confirm('End this call without a recording? No transcript will be generated.')
    ) {
      endingRef.current = false;
      return;
    }
    room.hangUp();
    if (metadata.role === 'HOST') {
      let failed = false;
      try {
        await postRoomEvent(token, 'ENDED');
      } catch {
        failed = true;
      }
      try {
        if (recordingStartedRef.current) {
          await stopAndUploadRecording();
        } else {
          setRecordingNotice('Call ended without a recording.');
        }
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
  const previewIsSynthetic = isSyntheticMedia(preview);
  const localIsSynthetic = isSyntheticMedia(room.localStream);
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
        ? 'Preparing your camera and microphone preview.'
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
            <span>Private link · host controls recording after everyone connects</span>
          </div>
        </section>
        <section className="device-panel" data-testid="device-check">
          <div className="device-brand">
            <span>Room prejoin</span>
          </div>
          <div className="preview-shell">
            {preview && <StreamVideo stream={preview} muted className="preview-video" testId="preview-video" />}
            {!preview && <DevicePlaceholder state={deviceState} />}
            {previewIsSynthetic && (
              <span className="media-watermark" data-testid="synthetic-media-label">
                Test camera
              </span>
            )}
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

  const canStartCall = metadata.role === 'HOST' && (
    room.phase === 'peer_connected' || room.phase === 'peer_disconnected'
  );
  const hasConnectedMedia = room.phase === 'connected' && Boolean(room.localStream && room.remoteStream);
  const canStartRecording = metadata.role === 'HOST'
    && hasConnectedMedia
    && !recorderRef.current
    && (recordingState === 'idle' || recordingState === 'failed');
  const canAccept = metadata.role === 'GUEST' && room.phase === 'offer_received';
  const isConnecting = room.phase === 'connecting';
  const isOpening = room.phase === 'disconnected';
  const isRecovering = room.phase === 'peer_disconnected';
  const isRoomError = room.phase === 'error';
  const canRetry = room.phase === 'peer_disconnected' || room.phase === 'error';
  const recordingLabel = {
    idle: 'Not recording',
    starting: 'Starting',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Save failed',
  }[recordingState];
  const visibleRecordingNotice = recordingError ?? recordingNotice;
  const recordingButtonLabel = {
    idle: 'Start recording',
    starting: 'Starting',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Retry recording',
  }[recordingState];
  const workspaceSession = workspace?.session ?? null;
  const workspaceReady = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';
  const workspaceUrl = workspaceReady && workspaceSession
    ? roomWorkspaceProxyUrl(token, workspaceSession.sessionId)
    : null;
  const canLaunchWorkspace = metadata.role === 'HOST'
    && Boolean(workspace?.canLaunch)
    && !workspaceLoading
    && (!workspaceSession || ['ERROR', 'STOPPED', 'EXPIRED'].includes(workspaceSession.status));
  const showWorkspacePanel = Boolean(workspace?.canLaunch);
  const needsRepoUrl = canLaunchWorkspace && !workspace?.repoUrl;
  const hasActiveWorkspace = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';

  return (
    <main className="call-stage" data-testid="call-stage" data-room-phase={room.phase}>
      <StreamVideo stream={room.remoteStream} className="remote-video" testId="remote-video" />
      {showWorkspacePanel && (
        <>
          <button
            className={`workspace-toggle${workspaceOpen ? ' is-open' : ''}${hasActiveWorkspace ? ' is-active' : ''}`}
            onClick={() => setWorkspaceOpen((v) => !v)}
            aria-label={workspaceOpen ? 'Close workspace' : 'Open workspace'}
            data-testid="workspace-toggle"
          >
            {workspaceSession?.status === 'LAUNCHING'
              ? <Loader2 size={18} className="spin" />
              : <SquareTerminal size={18} />}
          </button>
          {workspaceOpen && (
            <div className="workspace-window-wrapper" data-testid="workspace-panel">
              <ThemeProvider theme={pipeWin95Theme}>
                <Win95GlobalStyles />
                <Window
                  className="workspace-win95-window"
                  shadow
                  style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
                >
                  <WindowHeader className="workspace-win95-header win95-font">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <SquareTerminal size={14} />
                      {workspace?.repoUrl ?? 'Repository not configured'}
                    </span>
                    <button
                      className="workspace-win95-close"
                      onClick={() => setWorkspaceOpen(false)}
                      aria-label="Close workspace"
                    >
                      <PanelRightClose size={14} />
                    </button>
                  </WindowHeader>
                  <WindowContent
                    className="workspace-win95-content"
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
                  >
                    {workspaceUrl ? (
                      <iframe
                        src={workspaceUrl}
                        title="PIPE live implementation workspace"
                        className="workspace-iframe"
                        data-testid="workspace-iframe"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
                      />
                    ) : (
                      <div className="workspace-empty">
                        <SquareTerminal size={26} />
                        <h3>
                          {workspaceSession?.status === 'LAUNCHING'
                            ? 'Starting workspace...'
                            : workspaceSession?.status === 'ERROR'
                              ? 'Workspace failed'
                              : 'Workspace ready to launch'}
                        </h3>
                        <p>
                          {workspaceSession?.status === 'LAUNCHING'
                            ? 'The container is warming up. This can take 20-30 seconds.'
                            : workspaceSession?.errorMessage
                              ? workspaceSession.errorMessage
                            : workspaceError
                              ? workspaceError
                              : metadata.role === 'HOST'
                                ? 'Launch a repo into a live code-server workspace for this call.'
                                : 'The host can launch the live code workspace.'}
                        </p>
                        {needsRepoUrl && canLaunchWorkspace && (
                          <input
                            type="url"
                            className="workspace-repo-input"
                            placeholder="https://github.com/org/repo"
                            value={workspaceRepoInput}
                            onChange={(e) => setWorkspaceRepoInput(e.target.value)}
                            data-testid="workspace-repo-input"
                          />
                        )}
                        {canLaunchWorkspace && (
                          <Win95Button
                            className="workspace-launch-btn win95-font"
                            onClick={() => void launchWorkspace()}
                            disabled={needsRepoUrl && !workspaceRepoInput.trim()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}
                          >
                            {workspaceLoading ? <Loader2 size={16} className="spin" /> : <SquareTerminal size={16} />}
                            Launch workspace
                          </Win95Button>
                        )}
                        {workspaceSession?.status === 'LAUNCHING' && (
                          <Win95Button
                            className="workspace-refresh-btn win95-font"
                            onClick={() => void refreshWorkspace()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}
                          >
                            <RefreshCcw size={14} />
                            Refresh
                          </Win95Button>
                        )}
                      </div>
                    )}
                  </WindowContent>
                </Window>
              </ThemeProvider>
            </div>
          )}
        </>
      )}
      {!room.remoteStream && (
        <div className="waiting-state" data-testid="waiting-state">
          <RoomStateMark
            loading={isConnecting}
            variant={isRoomError ? 'error' : 'default'}
            icon={!isConnecting ? <Users size={24} /> : undefined}
          />
          <h2>
            {isRoomError
              ? 'Connection interrupted'
              : isRecovering
              ? 'Reconnecting...'
              : isOpening
              ? 'Opening room...'
              : isConnecting
              ? 'Connecting...'
              : metadata.role === 'HOST'
                ? 'Waiting for your guest'
                : 'Waiting for the host'}
          </h2>
          <p>
            {isRoomError
              ? 'The room kept your call open. Retry the connection when you are ready.'
              : isRecovering
              ? 'The room is trying to recover the connection without ending the call.'
              : isOpening
              ? 'Connecting to the private room.'
              : 'The room stays ready while the other participant joins.'}
          </p>
          {canRetry && (
            <button className="primary" onClick={room.retryConnection} data-testid="retry-connection">
              <RefreshCcw size={17} /> Retry connection
            </button>
          )}
          {!canRetry && canStartCall && (
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

      {room.remoteStream && isRecovering && (
        <div className="recovery-banner" data-testid="recovery-banner">
          <span>
            <RefreshCcw size={14} />
            Connection recovering
          </span>
          <button onClick={room.retryConnection}>Retry</button>
        </div>
      )}

      {metadata.role === 'HOST' && visibleRecordingNotice && (recordingState === 'uploading' || recordingState === 'saved' || recordingState === 'failed') && (
        <div className={`save-banner is-${recordingState}`} data-testid="recording-save-status">
          <span>
            {recordingState === 'failed' ? <AlertCircle size={14} /> : <Circle size={9} fill="currentColor" />}
            {visibleRecordingNotice}
          </span>
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
        {localIsSynthetic && <em>Test camera</em>}
      </div>

      <div className="controls">
        <button onClick={room.toggleMic} aria-label="Toggle microphone">
          {room.micEnabled ? <Mic /> : <MicOff />}
        </button>
        {metadata.role === 'HOST' && (
          <button
            className={`record-control is-${recordingState}`}
            onClick={() => void startRecording()}
            disabled={!canStartRecording}
            aria-label={recordingButtonLabel}
            title={hasConnectedMedia ? recordingButtonLabel : 'Recording is available after the guest connects'}
            data-testid="start-recording"
          >
            <Circle size={15} fill={recordingState === 'recording' ? 'currentColor' : 'none'} />
            <span>{recordingButtonLabel}</span>
          </button>
        )}
        <button className="hangup" onClick={() => void endCall()} aria-label="End call" data-testid="end-call">
          <PhoneOff />
        </button>
        <button onClick={room.toggleCamera} aria-label="Toggle camera">
          {room.cameraEnabled ? <Camera /> : <CameraOff />}
        </button>
      </div>

      {room.phase === 'ended' && (
        <div className="ended-overlay">
          <RoomStateMark />
          <h2>Call ended</h2>
          <p>
            {metadata.role === 'HOST' && recordingState === 'uploading'
              ? 'Saving the recording and starting transcription...'
              : metadata.role === 'HOST' && recordingState === 'saved'
                ? (recordingNotice ?? 'Recording saved. Transcript processing has started.')
                : metadata.role === 'HOST' && recordingState === 'failed'
                  ? `Recording was not saved: ${recordingError ?? 'unknown error'}`
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
        <RoomStateMark variant="error" />
        <h1>Room unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!metadata) {
    return (
      <main className="center-message is-loading">
        <RoomStateMark loading />
        <h1>Opening room...</h1>
        <p>Connecting to the private room.</p>
      </main>
    );
  }
  return <Room token={token} metadata={metadata} />;
}
