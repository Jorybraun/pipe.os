import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bot,
  Camera,
  CameraOff,
  Circle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCcw,
  ShieldCheck,
  Square,
  SquareTerminal,
  Video,
} from 'lucide-react';
import {
  finalizeRoomWorkspaceAssessment,
  getRoomWorkspace,
  launchRoomWorkspace,
  loadRoom,
  postRoomEvent,
  roomWorkspaceProxyUrl,
  roomAgentWsUrl,
  roomTerminalWsUrl,
  submitRoomAssessmentCommit,
  uploadRecording,
} from './lib/api';
import {
  createCompositeRecording,
  preferredAudioRecordingOptions,
  preferredRecordingOptions,
} from './lib/recording';
import {
  buildRecordingLifecycleEvidence,
  type RecordingFailureSource,
  type RecordingFailureStage,
} from './lib/recordingEvidence';
import {
  buildAgentMessageSessionEvidence,
  buildAgentStatusEvidence,
  buildAgentRoomActionExecutionEvidence,
  buildAgentUiActionEvidence,
  buildAgentUserChatEvidence,
} from './lib/agentEvidence';
import {
  buildCodeEditorOpenEvidence,
  buildCodeServerFileChangeEvidence,
  buildWorkspaceStateEvidence,
} from './lib/workspaceEvidence';
import {
  buildMediaControlEvidence,
  type MediaControlKind,
} from './lib/mediaControlEvidence';
import { buildRoomChatEvidence } from './lib/chatEvidence';
import { routeAgentRoomAction } from './lib/agentRoomActionRouting';
import {
  useRoomConnection,
  type RoomChatMessage,
  type RoomMediaControlState,
  type RoomSurface,
} from './hooks/useRoomConnection';
import { useAssessmentProgressPolling } from './hooks/useAssessmentProgressPolling';
import { useToolSurfaceManager } from './hooks/useToolSurfaceManager';
import { StandardLayout } from './components/StandardLayout';
import { ChatPanel, type ChatMessage } from './components/ChatPanel';
import { AgentAssistant } from './components/AgentAssistant';
import {
  agentStatusEvidenceText,
  type AgentChatMessage,
  type AgentFileChangeEvent,
  type AgentRoomAction,
  type AgentStatus,
} from './hooks/useAgentConnection';
import { TerminalPanel } from './components/TerminalPanel';
import {
  buildTerminalCommandEvidence,
  buildTerminalOutputEvidence,
  type TerminalEvidenceContext,
} from './lib/terminalProtocol';
import { CommitSubmissionPanel } from './components/CommitSubmissionPanel';
import { AssessmentTaskBrief } from './components/AssessmentTaskBrief';
import {
  AssessmentStatusStrip,
  assessmentModeForRoom,
  assessmentModeLabel,
} from './components/AssessmentStatusStrip';
import { defaultRoomSurfaceConfigs } from './lib/defaultRoomSurfaces';
import { useSessionEvents } from './hooks/useSessionEvents';
import { API_BASE } from './lib/api';
import type { OpenToolSurfaceConfig, ToolSurfaceState } from './hooks/useToolSurfaceManager';
import type {
  IceServerProvider,
  RecordingSpeakerMetadata,
  RoomMetadata,
  RoomPhase,
  RoomWorkspace,
  RoomAssessmentProgressSnapshot,
  RoomCommitSubmissionRequest,
  RoomCommitSubmissionResponse,
  RoomWorkspaceFinalizeRequest,
  RoomWorkspaceFinalizeResponse,
} from './types';

type RecordingState = 'idle' | 'starting' | 'recording' | 'uploading' | 'saved' | 'failed';
const DEVIN_AUTH_TERMINAL_COMMAND = 'devin auth login --force-manual-token-flow';
type AssistantTrayStatus = AgentStatus | 'unavailable';

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
  state: DeviceState;
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
      <span>{state === 'checking' ? 'Preparing camera and microphone' : 'Camera and microphone unavailable'}</span>
    </div>
  );
}

type DeviceState = 'checking' | 'ready' | 'error';

async function requestUserMediaPreview(): Promise<MediaStream> {
  if (
    typeof navigator === 'undefined'
    || !navigator.mediaDevices
    || typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new Error('Browser media devices are unavailable.');
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

function createLocalRoomStream(preview: MediaStream | null): MediaStream {
  return preview ?? new MediaStream();
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

function mediaStatusLabel(state: Pick<RoomMediaControlState, 'microphoneEnabled' | 'cameraEnabled'>): string {
  const parts: string[] = [];
  if (state.microphoneEnabled === false) parts.push('mic off');
  if (state.cameraEnabled === false) parts.push('camera off');
  return parts.join(', ');
}

function assistantStatusLabel(status: AssistantTrayStatus, hasWorkspaceFeature: boolean): string {
  switch (status) {
    case 'idle':
      return 'agent ready';
    case 'starting':
      return 'agent starting';
    case 'thinking':
      return 'agent thinking';
    case 'working':
      return 'agent working';
    case 'auth_needed':
      return 'agent authentication required';
    case 'disconnected':
      return hasWorkspaceFeature ? 'agent disconnected' : 'workspace required';
    case 'unavailable':
    default:
      return hasWorkspaceFeature ? 'agent unavailable' : 'workspace required';
  }
}

function Room({ token, metadata }: { token: string; metadata: RoomMetadata }): JSX.Element {
  const [enteredRoom, setEnteredRoom] = useState(false);
  const initialAssessmentMode = assessmentModeForRoom({
    meetingType: metadata.meetingType,
    workspaceEnabled: Boolean(metadata.workspace?.enabled || metadata.features?.workspaceEnabled),
  });
  const roomActor = metadata.role === 'HOST' ? 'host' : 'guest';
  const [assessmentProgress, setAssessmentProgress] = useState<RoomAssessmentProgressSnapshot | null>(null);
  const { capture: captureSessionEvent } = useSessionEvents({
    token,
    apiBase: API_BASE,
    onProgressChange: setAssessmentProgress,
  });
  const chatDeliveryEvidenceKeysRef = useRef<Set<string>>(new Set());
  const captureChatDeliveryEvidence = useCallback((message: RoomChatMessage): void => {
    const deliveryStatus = message.deliveryStatus ?? 'unknown';
    const evidenceKey = `${message.id}:${deliveryStatus}`;
    if (chatDeliveryEvidenceKeysRef.current.has(evidenceKey)) return;
    chatDeliveryEvidenceKeysRef.current.add(evidenceKey);
    const evidenceSurface = message.evidence?.surface;
    const surface: RoomSurface = evidenceSurface === 'standard' ? evidenceSurface : 'standard';
    const evidenceRoomPhase = message.evidence?.roomPhase;
    const roomPhase: RoomPhase = typeof evidenceRoomPhase === 'string' && evidenceRoomPhase.trim().length > 0
      ? evidenceRoomPhase as RoomPhase
      : 'connected';
    const evidence = buildRoomChatEvidence({
      message,
      actor: roomActor,
      surface,
      roomPhase,
    });
    captureSessionEvent('chat_message', evidence.text, roomActor, evidence.properties);
  }, [captureSessionEvent, roomActor]);
  const room = useRoomConnection(token, metadata.role, enteredRoom, {
    onChatDeliveryEvidence: captureChatDeliveryEvidence,
  });
  const publishTerminalEvent = room.publishTerminalEvent;
  const publishAgentInteractionEvent = room.publishAgentInteractionEvent;
  const publishCodeServerFileEvent = room.publishCodeServerFileEvent;
  const [workspace, setWorkspace] = useState<RoomWorkspace | null>(metadata.workspace ?? null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceRepoInput, setWorkspaceRepoInput] = useState('');
  const [workspaceAgentEnabled, setWorkspaceAgentEnabled] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const toolSurfaces = useToolSurfaceManager();
  const [deviceState, setDeviceState] = useState<DeviceState>('checking');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [agentChatOpen, setAgentChatOpen] = useState(false);
  const [agentChatRequest, setAgentChatRequest] = useState(0);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected');
  const [queuedTerminalCommand, setQueuedTerminalCommand] = useState<string | null>(null);
  const [queuedTerminalCommandRequest, setQueuedTerminalCommandRequest] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionChunksRef = useRef<Blob[]>([]);
  const recordingDisposeRef = useRef<(() => Promise<void>) | null>(null);
  const recordingSpeakerMetadataRef = useRef<RecordingSpeakerMetadata | null>(null);
  const autoAcceptingRef = useRef(false);
  const endingRef = useRef(false);
  const deviceRequestRef = useRef(0);
  const callStartedRef = useRef(false);
  const recordingStartedRef = useRef(false);
  const workspaceEditorOpenEvidenceKeysRef = useRef<Set<string>>(new Set());
  const publishedWorkspaceStateSignatureRef = useRef<string | null>(null);
  const terminalCommandSequenceRef = useRef(0);
  const terminalOutputSequenceRef = useRef(0);
  const activeTerminalCommandIdRef = useRef<string | null>(null);
  const queuedTerminalCommandRequestRef = useRef(0);

  const requestDevices = useCallback(async (): Promise<void> => {
    const requestId = deviceRequestRef.current + 1;
    deviceRequestRef.current = requestId;
    setDeviceState('checking');
    try {
      const stream = await requestUserMediaPreview();
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
    void requestUserMediaPreview()
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

  const publishWorkspaceStateEvent = useCallback((
    nextWorkspace: RoomWorkspace | null,
    source: 'initial_load' | 'launch' | 'refresh' | 'error',
    options: { errorMessage?: string | null; fallbackRepoUrl?: string | null } = {},
  ): void => {
    if (metadata.role !== 'HOST') return;
    if (!nextWorkspace && !options.errorMessage) return;
    if (
      nextWorkspace
      && !nextWorkspace.enabled
      && !nextWorkspace.session
      && !options.errorMessage
    ) return;
    const evidence = buildWorkspaceStateEvidence({
      workspace: nextWorkspace,
      actor: roomActor,
      source,
      capturedAtMs: Date.now(),
      fallbackRepoUrl: options.fallbackRepoUrl,
      errorMessage: options.errorMessage,
    });
    const signatureProperties: Record<string, unknown> = { ...evidence.properties };
    delete signatureProperties.workspaceStateEventId;
    delete signatureProperties.capturedAtMs;
    const signature = JSON.stringify(signatureProperties);
    if (publishedWorkspaceStateSignatureRef.current === signature) return;
    publishedWorkspaceStateSignatureRef.current = signature;
    captureSessionEvent('workspace_state', evidence.text, roomActor, evidence.properties);
  }, [captureSessionEvent, metadata.role, roomActor]);

  useEffect(() => {
    const initialWorkspace = metadata.workspace ?? null;
    setWorkspace(initialWorkspace);
    publishWorkspaceStateEvent(initialWorkspace, 'initial_load');
    // Always fetch fresh workspace data on room entry; metadata can be stale.
    void getRoomWorkspace(token).then((freshWorkspace) => {
      setWorkspace(freshWorkspace);
      publishWorkspaceStateEvent(freshWorkspace, 'refresh');
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Workspace status failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(initialWorkspace, 'error', { errorMessage: message });
    });
  }, [metadata.workspace, publishWorkspaceStateEvent, token]);

  useAssessmentProgressPolling({
    token,
    enabled: Boolean(workspace?.enabled),
    onProgressChange: setAssessmentProgress,
    onError: (error) => {
      console.error('[Room] Failed to load assessment progress:', {
        token,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    try {
      const nextWorkspace = await getRoomWorkspace(token);
      setWorkspace(nextWorkspace);
      publishWorkspaceStateEvent(nextWorkspace, 'refresh');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace status failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(workspace, 'error', { errorMessage: message });
    }
  }, [publishWorkspaceStateEvent, token, workspace]);

  const launchWorkspace = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const repoUrl = workspace?.repoUrl ?? (workspaceRepoInput.trim() || undefined);
      const launch = await launchRoomWorkspace(
        token,
        repoUrl,
        workspaceAgentEnabled ? 'devin' : null,
      );
      setWorkspace(launch.workspace);
      if (launch.progress) setAssessmentProgress(launch.progress);
      publishWorkspaceStateEvent(launch.workspace, 'launch', { fallbackRepoUrl: repoUrl ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace launch failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(workspace, 'error', {
        errorMessage: message,
        fallbackRepoUrl: workspace?.repoUrl ?? (workspaceRepoInput.trim() || null),
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }, [publishWorkspaceStateEvent, token, workspace, workspaceAgentEnabled, workspaceRepoInput]);

  useEffect(() => {
    if (!workspace?.enabled) return undefined;
    const status = workspace.session?.status;
    if (status !== 'LAUNCHING') return undefined;
    const timer = window.setInterval(() => {
      void refreshWorkspace();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspace, workspace?.enabled, workspace?.session?.status]);

  const chatMessages: ChatMessage[] = room.chatMessages.map((message) => ({
    id: message.id,
    role: message.role === 'HOST' ? 'host' : 'candidate',
    text: message.text,
    timestamp: message.createdAt,
    deliveryStatus: message.deliveryStatus,
    deliveryRejectionReason: typeof message.evidence?.deliveryRejectionReason === 'string'
      ? message.evidence.deliveryRejectionReason
      : undefined,
  }));
  const sendChatMessage = (text: string): void => {
    const message = room.publishChatMessage(text);
    if (!message) return;
    const evidence = buildRoomChatEvidence({
      message,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    captureSessionEvent('chat_message', evidence.text, roomActor, evidence.properties);
  };

  const openDefaultRoomSurfaces = useCallback((): void => {
    const defaultSurfaces = defaultRoomSurfaceConfigs({
      mode: assessmentModeForRoom({
        meetingType: metadata.meetingType,
        workspaceEnabled: Boolean(workspace?.enabled),
      }),
      workspaceEnabled: Boolean(workspace?.enabled),
      workspaceTitle: workspace?.repoUrl ?? 'VS Code',
    });
    for (const surfaceConfig of defaultSurfaces) {
      if (!toolSurfaces.surfaces.some((entry) => entry.id === surfaceConfig.id)) {
        toolSurfaces.openSurface(surfaceConfig);
      }
    }
  }, [metadata.meetingType, toolSurfaces, workspace?.enabled, workspace?.repoUrl]);

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
    const localRoomStream = createLocalRoomStream(preview);
    openDefaultRoomSurfaces();
    room.setLocalStream(localRoomStream);
    setPreview(null);
    setEnteredRoom(true);
    void postRoomEvent(token, 'JOINED');
  };

  useEffect(() => {
    if (!enteredRoom) return;
    openDefaultRoomSurfaces();
  }, [enteredRoom, openDefaultRoomSurfaces]);

  const openLocalPanel = useCallback((
    config: OpenToolSurfaceConfig & { id: string },
  ): void => {
    toolSurfaces.openSurface(config);
  }, [toolSurfaces]);

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
      recordingSpeakerMetadataRef.current = composite.speakerMetadata;
      recordingStartedRef.current = true;
      setRecordingNotice('Recording started. Transcript processing begins after the host ends the call.');
      setRecordingState('recording');
      const recordingStartEvidence = buildRecordingLifecycleEvidence({
        lifecycleKind: 'start',
        actor: 'host',
        capturedAtMs: Date.now(),
        surface: room.roomSurface,
        roomPhase: room.phase,
        recordingStatus: 'recording',
        recordingActive: true,
        speakerMetadata: composite.speakerMetadata,
        iceProvider: room.iceProvider,
        hasTranscriptionAudio: transcriptionTracks.length > 0,
      });
      room.publishRecordingStateEvent({
        lifecycleKind: 'start',
        status: 'recording',
        active: true,
        evidence: recordingStartEvidence,
      });
      void postRoomEvent(token, 'RECORDING_STARTED').catch(() => {
        setRecordingNotice('Recording started. Status will sync when the call ends.');
      });
      captureSessionEvent('recording_start', 'Recording started', 'host', recordingStartEvidence);
    } catch (error) {
      await dispose?.().catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Recording could not start.';
      setRecordingState('failed');
      setRecordingError(message);
    }
  }, [
    captureSessionEvent,
    metadata.role,
    room.iceProvider,
    room.localStream,
    room.phase,
    room.publishRecordingStateEvent,
    room.remoteStream,
    room.roomSurface,
    token,
  ]);

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
      recordingSpeakerMetadataRef.current = null;
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
    let recordingFailureStage: RecordingFailureStage = 'stop_recorder';
    let recordingFailureSource: RecordingFailureSource = 'browser_media_recorder_exception';
    let capturedRecordingBytes: number | null = null;
    let capturedRecordingMimeType: string | null = null;
    let capturedTranscriptionBytes: number | null = null;
    let capturedTranscriptionMimeType: string | null = null;
    let capturedHasTranscriptionAudio = false;
    try {
      await Promise.all([
        stopRecorder(recorder),
        stopRecorder(transcriptionRecorderRef.current),
      ]);
      recordingFailureStage = 'prepare_upload';
      recordingFailureSource = 'browser_blob_builder_exception';
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      const transcriptionRecorder = transcriptionRecorderRef.current;
      const transcriptionAudio = transcriptionChunksRef.current.length > 0
        ? new Blob(transcriptionChunksRef.current, {
            type: transcriptionRecorder?.mimeType || 'audio/webm',
          })
        : undefined;
      capturedRecordingBytes = blob.size;
      capturedRecordingMimeType = blob.type || null;
      capturedHasTranscriptionAudio = Boolean(transcriptionAudio);
      capturedTranscriptionBytes = transcriptionAudio?.size ?? 0;
      capturedTranscriptionMimeType = transcriptionAudio?.type ?? null;
      console.log('[room] Uploading recording', {
        token,
        recordingBytes: blob.size,
        recordingType: blob.type,
        hasTranscriptionAudio: Boolean(transcriptionAudio),
        transcriptionBytes: transcriptionAudio?.size ?? 0,
        iceProvider: room.iceProvider,
      });
      const recordingStopEvidence = buildRecordingLifecycleEvidence({
        lifecycleKind: 'stop',
        actor: 'host',
        capturedAtMs: Date.now(),
        surface: room.roomSurface,
        roomPhase: room.phase,
        recordingStatus: 'uploading',
        recordingActive: false,
        speakerMetadata: recordingSpeakerMetadataRef.current,
        iceProvider: room.iceProvider,
        hasTranscriptionAudio: Boolean(transcriptionAudio),
        recordingBytes: blob.size,
        recordingMimeType: blob.type || null,
        transcriptionBytes: transcriptionAudio?.size ?? 0,
        transcriptionMimeType: transcriptionAudio?.type ?? null,
        uploadStatus: 'attempting',
      });
      room.publishRecordingStateEvent({
        lifecycleKind: 'stop',
        status: 'uploading',
        active: false,
        evidence: recordingStopEvidence,
      });
      captureSessionEvent('recording_stop', 'Recording stopped', 'host', recordingStopEvidence);
      recordingFailureStage = 'upload_request';
      recordingFailureSource = 'recording_upload_exception';
      const result = await uploadRecording(
        token,
        blob,
        transcriptionAudio,
        recordingSpeakerMetadataRef.current ?? undefined,
      );
      console.log('[room] Recording upload succeeded', {
        accepted: result.accepted,
        transcriptStatus: result.transcriptStatus,
      });
      setRecordingState('saved');
      room.publishRecordingStateEvent({
        lifecycleKind: 'stop',
        status: 'saved',
        active: false,
        evidence: buildRecordingLifecycleEvidence({
          lifecycleKind: 'stop',
          actor: 'host',
          capturedAtMs: Date.now(),
          surface: room.roomSurface,
          roomPhase: room.phase,
          recordingStatus: 'saved',
          recordingActive: false,
          speakerMetadata: recordingSpeakerMetadataRef.current,
          iceProvider: room.iceProvider,
          hasTranscriptionAudio: Boolean(transcriptionAudio),
          recordingBytes: blob.size,
          recordingMimeType: blob.type || null,
          transcriptionBytes: transcriptionAudio?.size ?? 0,
          transcriptionMimeType: transcriptionAudio?.type ?? null,
          uploadStatus: 'accepted',
          transcriptStatus: result.transcriptStatus ?? null,
        }),
      });
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
      room.publishRecordingStateEvent({
        lifecycleKind: 'stop',
        status: 'failed',
        active: false,
        evidence: buildRecordingLifecycleEvidence({
          lifecycleKind: 'stop',
          actor: 'host',
          capturedAtMs: Date.now(),
          surface: room.roomSurface,
          roomPhase: room.phase,
          recordingStatus: 'failed',
          recordingActive: false,
          speakerMetadata: recordingSpeakerMetadataRef.current,
          iceProvider: room.iceProvider,
          hasTranscriptionAudio: capturedHasTranscriptionAudio || transcriptionChunksRef.current.length > 0,
          recordingBytes: capturedRecordingBytes,
          recordingMimeType: capturedRecordingMimeType,
          transcriptionBytes: capturedTranscriptionBytes,
          transcriptionMimeType: capturedTranscriptionMimeType,
          uploadStatus: 'failed',
          recordingFailureStage,
          recordingFailureSource,
          recordingFailureMessage: message,
        }),
      });
      setRecordingError(message);
      throw error;
    } finally {
      await recordingDisposeRef.current?.().catch(() => undefined);
      recorderRef.current = null;
      transcriptionRecorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingSpeakerMetadataRef.current = null;
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
    }
  };

  const stopRecording = async (): Promise<void> => {
    if (metadata.role !== 'HOST' || recordingState !== 'recording' || !recorderRef.current) return;
    try {
      await stopAndUploadRecording();
    } catch {
      // stopAndUploadRecording already surfaced the error in state.
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
        if (recordingStartedRef.current && recorderRef.current) {
          await stopAndUploadRecording();
        } else if (recordingStartedRef.current && recordingState === 'saved') {
          setRecordingNotice((notice) => notice ?? 'Recording saved. Transcript processing has started.');
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

  const workspaceSession = workspace?.session ?? null;
  const workspaceReady = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';
  const hasWorkspaceFeature = Boolean(workspace?.enabled);
  const workspaceUrl = workspaceReady && workspaceSession
    ? roomWorkspaceProxyUrl(token, workspaceSession.sessionId)
    : null;
  useEffect(() => {
    setIframeLoaded(false);
  }, [workspaceUrl]);
  const canLaunchWorkspace = metadata.role === 'HOST'
    && hasWorkspaceFeature
    && Boolean(workspace?.canLaunch)
    && !workspaceLoading
    && (!workspaceSession || ['ERROR', 'STOPPED', 'EXPIRED'].includes(workspaceSession.status));
  const canRelaunchWorkspace = Boolean(workspaceSession && ['ERROR', 'STOPPED', 'EXPIRED'].includes(workspaceSession.status));
  const workspaceLaunchActionLabel = canRelaunchWorkspace ? 'Relaunch workspace' : 'Launch workspace';
  const workspaceFailureReason = (workspaceSession?.errorMessage ?? workspaceError ?? 'container startup did not complete')
    .replace(/\.+$/, '');
  const workspaceRecoveryNotice = canRelaunchWorkspace
    ? workspaceSession?.status === 'ERROR'
      ? `The previous workspace failed: ${workspaceFailureReason}. Relaunch creates a fresh controlled workspace for this assessment.`
      : workspaceSession?.status === 'EXPIRED'
        ? 'The previous workspace expired. Relaunch creates a fresh controlled workspace for this assessment.'
        : 'The previous workspace was stopped. Relaunch creates a fresh controlled workspace for this assessment.'
    : null;
  const showWorkspacePanel = hasWorkspaceFeature;
  const needsRepoUrl = canLaunchWorkspace && !workspace?.repoUrl;
  const hasActiveWorkspace = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';
  const agentTrayStatus: AssistantTrayStatus = !hasWorkspaceFeature
    ? 'unavailable'
    : !hasActiveWorkspace
      ? workspaceSession?.status === 'LAUNCHING'
        ? 'starting'
        : 'unavailable'
      : agentStatus;
  const workspaceChallengeMessage = workspace?.challenge?.status === 'missing_reviewable_task'
    ? workspace.challenge.message
    : null;
  const workspaceChallengePacket = workspace?.challenge?.packet ?? null;
  const agentUnavailableMessage = !hasWorkspaceFeature
    ? 'This room was not configured with a dev workspace. Room chat still goes to people; AI assistant chat requires a real container workspace.'
    : workspaceSession?.status === 'LAUNCHING'
      ? 'The VS Code workspace is starting. The AI assistant will connect when the container bridge reports a real agent identity.'
      : workspaceSession?.status === 'ERROR'
        ? `The VS Code workspace failed: ${workspaceSession.errorMessage ?? workspaceError ?? 'container startup did not complete'}. AI assistant chat stays disabled until the workspace is relaunched.`
        : metadata.role === 'HOST' && canLaunchWorkspace
        ? 'Launch the VS Code workspace to connect a real agent. AI assistant chat stays disabled until the container bridge is connected.'
        : 'The host needs to launch the VS Code workspace before the AI assistant can connect to a real agent.';
  const canOpenAgentBridgePanel = metadata.features?.agentEnabled ?? true;
  const assistantCallStatus = assistantStatusLabel(agentTrayStatus, hasWorkspaceFeature);
  const roomAssessmentMode = assessmentModeForRoom({
    meetingType: metadata.meetingType,
    workspaceEnabled: hasWorkspaceFeature,
  });
  const roomAssessmentModeLabel = assessmentModeLabel(roomAssessmentMode);
  useEffect(() => {
    if (!canOpenAgentBridgePanel && agentChatOpen) {
      setAgentChatOpen(false);
    }
  }, [canOpenAgentBridgePanel, agentChatOpen]);
  useEffect(() => {
    if (!hasActiveWorkspace) {
      setAgentStatus('disconnected');
    }
  }, [hasActiveWorkspace, workspaceSession?.sessionId]);
  const captureAgentUiAction = (
    actionId: 'open-agent-chat' | 'close-agent-chat' | 'open-devin-auth-browser' | 'check-devin-auth',
    origin: 'tray' | 'chat' | 'call',
  ): void => {
    const evidence = buildAgentUiActionEvidence({
      actionId,
      origin,
      actor: roomActor,
      capturedAtMs: Date.now(),
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      agentWorkspaceReady: hasActiveWorkspace,
    });
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent('agent_action', evidence.text, roomActor, properties);
    publishAgentInteractionEvent({
      eventType: 'agent_action',
      actor: roomActor,
      text: evidence.text,
      evidence: properties,
    });
  };
  const openAgentChat = (origin: 'tray' | 'chat' | 'call' = 'tray'): void => {
    captureAgentUiAction('open-agent-chat', origin);
    setAgentChatOpen(canOpenAgentBridgePanel);
    setAgentChatRequest((request) => request + 1);
  };
  const closeAgentChat = (): void => {
    captureAgentUiAction('close-agent-chat', 'chat');
    setAgentChatOpen(false);
  };
  const checkDevinAuth = (): void => {
    captureAgentUiAction('check-devin-auth', 'chat');
  };
  const openDevinAuthBrowser = (): void => {
    captureAgentUiAction('open-devin-auth-browser', 'chat');
  };
  const terminalSessionId = `terminal-${workspaceSession?.sessionId ?? 'no-workspace'}-${metadata.role.toLowerCase()}`;
  const terminalEvidenceContext: TerminalEvidenceContext = useMemo(() => ({
    surface: room.roomSurface,
    roomPhase: room.phase,
    workspaceStatus: workspaceSession?.status ?? null,
    workspaceSessionId: workspaceSession?.sessionId ?? null,
    repoUrl: workspace?.repoUrl ?? null,
  }), [
    room.phase,
    room.roomSurface,
    workspace?.repoUrl,
    workspaceSession?.sessionId,
    workspaceSession?.status,
  ]);
  const captureTerminalCommand = useCallback((command: string): void => {
    const commandSequence = terminalCommandSequenceRef.current + 1;
    const evidence = buildTerminalCommandEvidence({
      command,
      terminalSessionId,
      commandSequence,
      actor: roomActor,
      capturedAtMs: Date.now(),
      context: terminalEvidenceContext,
    });
    if (!evidence) return;
    terminalCommandSequenceRef.current = commandSequence;
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    activeTerminalCommandIdRef.current = properties.terminalCommandId;
    captureSessionEvent('terminal_command', evidence.text, roomActor, properties);
    publishTerminalEvent({
      kind: 'COMMAND',
      text: evidence.text,
      evidence: properties,
    });
  }, [
    terminalEvidenceContext,
    terminalSessionId,
    captureSessionEvent,
    publishTerminalEvent,
    roomActor,
  ]);
  const captureTerminalOutput = useCallback((output: string): void => {
    const outputSequence = terminalOutputSequenceRef.current + 1;
    const evidence = buildTerminalOutputEvidence({
      output,
      terminalSessionId,
      outputSequence,
      activeCommandId: activeTerminalCommandIdRef.current,
      capturedAtMs: Date.now(),
      context: terminalEvidenceContext,
    });
    if (!evidence) return;
    terminalOutputSequenceRef.current = outputSequence;
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent('terminal_output', evidence.text, 'system', properties);
    publishTerminalEvent({
      kind: 'OUTPUT',
      text: evidence.text,
      evidence: properties,
    });
  }, [
    terminalEvidenceContext,
    terminalSessionId,
    captureSessionEvent,
    publishTerminalEvent,
  ]);

  const captureWorkspaceEditorOpen = useCallback((): void => {
    setIframeLoaded(true);
    const evidence = buildCodeEditorOpenEvidence({
      workspace,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
      capturedAtMs: Date.now(),
    });
    if (!evidence) return;
    const sessionId = typeof evidence.properties.workspaceSessionId === 'string'
      ? evidence.properties.workspaceSessionId
      : 'unknown-workspace-session';
    const evidenceKey = `${sessionId}:${roomActor}`;
    if (workspaceEditorOpenEvidenceKeysRef.current.has(evidenceKey)) return;
    workspaceEditorOpenEvidenceKeysRef.current.add(evidenceKey);
    captureSessionEvent('code_editor_open', evidence.text, roomActor, evidence.properties);
  }, [
    captureSessionEvent,
    room.phase,
    room.roomSurface,
    roomActor,
    workspace,
  ]);

  const canStartCall = metadata.role === 'HOST' && (
    room.phase === 'peer_connected' || room.phase === 'peer_disconnected'
  );
  const hasConnectedMedia = room.phase === 'connected' && Boolean(room.localStream && room.remoteStream);
  const canStartRecording = metadata.role === 'HOST'
    && hasConnectedMedia
    && !recorderRef.current
    && (recordingState === 'idle' || recordingState === 'failed');
  const canStopRecording = metadata.role === 'HOST'
    && recordingState === 'recording'
    && Boolean(recorderRef.current);
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
  const sharedRecordingLabel = room.recordingState
    ? {
        recording: 'Recording',
        uploading: 'Saving',
        saved: 'Saved',
        failed: 'Save failed',
      }[room.recordingState.status]
    : null;
  const visibleRecordingActive = recordingState === 'recording'
    || (metadata.role !== 'HOST' && room.recordingState?.active === true);
  const visibleRecordingLabel = metadata.role === 'HOST'
    ? recordingLabel
    : sharedRecordingLabel ?? recordingLabel;
  const visibleRecordingNotice = recordingError ?? recordingNotice;
  const inlineRecordingNotice = (
    recordingState === 'uploading'
    || recordingState === 'saved'
    || recordingState === 'failed'
  )
    ? visibleRecordingNotice
    : null;
  const recordingButtonLabel = {
    idle: 'Start recording',
    starting: 'Starting',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Retry recording',
  }[recordingState];

  const inLobby = room.localStream === null;
  const previewIsSynthetic = isSyntheticMedia(preview);
  const localIsSynthetic = isSyntheticMedia(room.localStream);
  const isDeviceChecking = deviceState === 'checking';
  const hasDeviceError = deviceState === 'error';
  const joinButtonLabel = hasDeviceError
    ? 'Enter without mic/camera'
    : isDeviceChecking
      ? 'Preparing devices'
      : 'Enter room';
  const joinButtonHint = hasDeviceError
    ? 'Camera and microphone are unavailable here. You can still enter, chat, use the workspace, and retry devices later.'
    : isDeviceChecking
      ? 'Preparing your camera and microphone preview.'
      : 'You will enter the private room with camera and microphone ready.';
  const joinButtonIcon = hasDeviceError
    ? <CameraOff size={17} />
    : isDeviceChecking
      ? <Loader2 size={17} className="spin" />
      : <Video size={17} />;
  const lobbySurface = (
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
          onClick={joinLobby}
          disabled={isDeviceChecking}
          data-testid="join-room"
        >
          {joinButtonIcon}
          {joinButtonLabel}
        </button>
        {hasDeviceError && (
          <button
            className="secondary"
            onClick={() => void requestDevices()}
            data-testid="retry-devices"
          >
            <RefreshCcw size={15} />
            Retry devices
          </button>
        )}
        <p className="join-hint">{joinButtonHint}</p>

        {metadata.role === 'HOST' && hasWorkspaceFeature && (
          <div className="prejoin-workspace" data-testid="prejoin-workspace">
            <div className="prejoin-workspace-header">
              <SquareTerminal size={14} />
              <span>WORKSPACE</span>
            </div>
            {workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING' ? (
              <p className="prejoin-workspace-ready">Container ready — editor will open when you enter.</p>
            ) : workspaceSession?.status === 'LAUNCHING' ? (
              <div className="prejoin-workspace-launching">
                <Loader2 size={14} className="spin" />
                <span>Starting container...</span>
                <button className="prejoin-refresh" onClick={() => void refreshWorkspace()}>
                  <RefreshCcw size={12} /> Refresh
                </button>
              </div>
            ) : (
              <>
                {needsRepoUrl && (
                  <input
                    type="url"
                    className="workspace-repo-input"
                    placeholder="https://github.com/org/repo"
                    value={workspaceRepoInput}
                    onChange={(e) => setWorkspaceRepoInput(e.target.value)}
                    data-testid="prejoin-repo-input"
                  />
                )}
                {canOpenAgentBridgePanel && (
                  <label className="workspace-agent-toggle">
                    <input
                      type="checkbox"
                      checked={workspaceAgentEnabled}
                      onChange={(e) => setWorkspaceAgentEnabled(e.target.checked)}
                      data-testid="prejoin-devin-agent-toggle"
                    />
                    <span>Start Devin bridge</span>
                  </label>
                )}
                <button
                  className="prejoin-launch-btn"
                  onClick={() => void launchWorkspace()}
                  disabled={needsRepoUrl && !workspaceRepoInput.trim() || workspaceLoading}
                  data-testid="prejoin-launch"
                >
                  {workspaceLoading ? <Loader2 size={14} className="spin" /> : <SquareTerminal size={14} />}
                  {workspaceLaunchActionLabel}
                </button>
                {workspaceRecoveryNotice && (
                  <p className="prejoin-workspace-diagnostic">{workspaceRecoveryNotice}</p>
                )}
                {workspaceChallengeMessage && (
                  <p className="prejoin-workspace-diagnostic">{workspaceChallengeMessage}</p>
                )}
                {workspaceError && <p className="prejoin-workspace-error">{workspaceError}</p>}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );

  const captureMediaControlChange = (
    control: MediaControlKind,
    previousEnabled: boolean,
    enabled: boolean,
  ): ReturnType<typeof buildMediaControlEvidence> => {
    const evidence = buildMediaControlEvidence({
      actor: roomActor,
      control,
      previousEnabled,
      enabled,
      surface: room.roomSurface,
      roomPhase: room.phase,
      capturedAtMs: Date.now(),
    });
    captureSessionEvent('media_control', evidence.text, roomActor, evidence.properties);
    return evidence;
  };

  const toggleMicrophone = (): void => {
    if (!room.hasLocalMicrophone) return;
    const previousEnabled = room.micEnabled;
    const enabled = !previousEnabled;
    room.toggleMic();
    const evidence = captureMediaControlChange('microphone', previousEnabled, enabled);
    room.publishMediaControlEvent({
      control: 'microphone',
      previousEnabled,
      enabled,
      evidence: evidence.properties,
    });
  };

  const toggleCamera = (): void => {
    if (!room.hasLocalCamera) return;
    const previousEnabled = room.cameraEnabled;
    const enabled = !previousEnabled;
    room.toggleCamera();
    const evidence = captureMediaControlChange('camera', previousEnabled, enabled);
    room.publishMediaControlEvent({
      control: 'camera',
      previousEnabled,
      enabled,
      evidence: evidence.properties,
    });
  };

  const openWorkspacePanel = (): void => {
    if (!showWorkspacePanel) return;
    openLocalPanel({
      id: 'workspace',
      surfaceType: 'workspace',
      title: workspace?.repoUrl ?? 'VS Code',
    });
  };

  const openBrowserTab = (url = ''): void => {
    const trimmed = url.trim();
    let currentUrl: string | null = null;
    try {
      const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        currentUrl = parsed.toString();
      }
    } catch {
      currentUrl = null;
    }
    if (!currentUrl) return;
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  const openTerminalPanel = (): void => {
    openLocalPanel({
      id: 'terminal',
      surfaceType: 'terminal',
      title: 'Container terminal',
    });
  };

  const openSubmissionPanel = (): void => {
    openLocalPanel({
      id: 'submission',
      surfaceType: 'submission',
      title: 'Submit Work',
    });
  };

  const captureAgentAction = (
    actionId: string,
    text: string,
    options: {
      origin: 'chat' | 'agent';
      agentAction?: AgentRoomAction;
    },
  ): boolean => {
    const evidence = buildAgentRoomActionExecutionEvidence({
      actionId,
      text,
      origin: options.origin,
      actor: roomActor,
      capturedAtMs: Date.now(),
      agentAction: options.agentAction,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
    });
    if (!evidence) {
      console.error('[captureAgentAction] rejected agent room action without source-backed bridge metadata:', {
        actionId,
        bridgeEventType: options.agentAction?.bridgeEventType ?? null,
        protocol: options.agentAction?.protocol ?? null,
        source: options.agentAction?.source ?? null,
      });
      return false;
    }
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent('agent_action', evidence.text, roomActor, properties);
    publishAgentInteractionEvent({
      eventType: 'agent_action',
      actor: roomActor,
      text: evidence.text,
      evidence: properties,
    });
    return true;
  };

  const executeRoomAction = (actionId: string, options: { url?: string; source?: 'chat' | 'agent'; agentAction?: AgentRoomAction } = {}): void => {
    const source = options.source ?? 'chat';
    const actionEvidence = { origin: source, agentAction: options.agentAction } as const;
    const actorLabel = source === 'agent' ? 'Agent' : 'Assistant';
    switch (actionId) {
      case 'start-recording':
        if (!captureAgentAction(actionId, `${actorLabel} action: start recording`, actionEvidence)) return;
        void startRecording();
        break;
      case 'stop-recording':
        if (!captureAgentAction(actionId, `${actorLabel} action: stop recording`, actionEvidence)) return;
        void stopRecording();
        break;
      case 'launch-workspace':
        if (!captureAgentAction(actionId, `${actorLabel} action: launch workspace`, actionEvidence)) return;
        openWorkspacePanel();
        void launchWorkspace();
        break;
      case 'open-workspace':
        if (!captureAgentAction(actionId, `${actorLabel} action: open workspace`, actionEvidence)) return;
        openWorkspacePanel();
        break;
      case 'open-terminal':
        if (!captureAgentAction(actionId, `${actorLabel} action: open terminal`, actionEvidence)) return;
        openTerminalPanel();
        break;
      case 'open-submission':
        if (!captureAgentAction(actionId, `${actorLabel} action: open submission`, actionEvidence)) return;
        openSubmissionPanel();
        break;
      case 'open-browser':
        if (!captureAgentAction(actionId, `${actorLabel} action: open browser`, actionEvidence)) return;
        openBrowserTab(options.url ?? '');
        break;
      default:
        break;
    }
  };

  const openDevinAuthTerminal = (): void => {
    if (!captureAgentAction(
      'open-devin-auth-terminal',
      'Assistant action: open terminal for Devin authentication',
      { origin: 'chat' },
    )) return;
    openTerminalPanel();
    queuedTerminalCommandRequestRef.current += 1;
    setQueuedTerminalCommand(DEVIN_AUTH_TERMINAL_COMMAND);
    setQueuedTerminalCommandRequest(queuedTerminalCommandRequestRef.current);
  };

  const submitCommitFromRoom = (
    payload: RoomCommitSubmissionRequest,
  ): Promise<RoomCommitSubmissionResponse> => submitRoomAssessmentCommit(token, payload)
    .then((response) => {
      setAssessmentProgress(response.progress);
      return response;
    });

  const finalizeCommitFromWorkspace = (
    payload: RoomWorkspaceFinalizeRequest,
  ): Promise<RoomWorkspaceFinalizeResponse> => {
    if (!workspaceSession || !hasActiveWorkspace) {
      return Promise.reject(new Error('Launch the workspace before finalizing the assessment commit.'));
    }
    return finalizeRoomWorkspaceAssessment(token, workspaceSession.sessionId, payload)
      .then((response) => {
        if (response.progress) setAssessmentProgress(response.progress);
        return response;
      });
  };

  const handleAgentAction = (actionId: string): void => {
    executeRoomAction(actionId);
  };

  const handleAgentRoomAction = (action: AgentRoomAction): void => {
    const route = routeAgentRoomAction(action);
    if (route.kind === 'reject') {
      console.error('[handleAgentRoomAction] rejected unsupported bridge room action:', {
        actionId: action.id,
        bridgeEventType: action.bridgeEventType ?? null,
        protocol: action.protocol ?? null,
        source: action.source ?? null,
        reason: route.reason,
      });
      return;
    }
    executeRoomAction(route.action.id, {
      url: route.action.url,
      source: route.source,
      agentAction: route.kind === 'agent' ? route.action : undefined,
    });
  };

  const captureAgentUserChatMessage = (message: AgentChatMessage): void => {
    const evidence = buildAgentUserChatEvidence({
      message,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      repoUrl: workspace?.repoUrl ?? null,
    });
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent('ai_chat_user', evidence.text, roomActor, properties);
    publishAgentInteractionEvent({
      eventType: 'ai_chat_user',
      actor: roomActor,
      text: evidence.text,
      evidence: properties,
    });
  };

  const captureAgentChatMessage = (message: AgentChatMessage): void => {
    const evidence = buildAgentMessageSessionEvidence({
      text: message.text,
      source: message.source,
      agentName: message.agentName ?? null,
      agentStatus: message.agentStatus ?? null,
      diagnosticSource: message.diagnosticSource ?? null,
      observedAt: message.observedAt ?? null,
      exitCode: message.exitCode ?? null,
      signal: message.signal ?? null,
      truncated: message.truncated ?? null,
      persisted: message.persisted ?? null,
      promptType: message.promptType ?? null,
      deliveredToAgent: message.deliveredToAgent ?? null,
      promptLength: message.promptLength ?? null,
      promptFingerprint: message.promptFingerprint ?? null,
      roomContextStatus: message.roomContextStatus ?? null,
      roomContextLength: message.roomContextLength ?? null,
      roomContextFingerprint: message.roomContextFingerprint ?? null,
      userMessageLength: message.userMessageLength ?? null,
      userMessageFingerprint: message.userMessageFingerprint ?? null,
      contextTruncated: message.contextTruncated ?? null,
      browserPromptId: message.browserPromptId ?? null,
      browserPromptFingerprint: message.browserPromptFingerprint ?? null,
      browserPromptTimestamp: message.browserPromptTimestamp ?? null,
      browserPromptLength: message.browserPromptLength ?? null,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      messageTimestamp: message.timestamp,
    });
    if (!evidence) return;
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent(evidence.eventType, evidence.text, 'agent', properties);
    publishAgentInteractionEvent({
      eventType: evidence.eventType,
      actor: 'agent',
      text: evidence.text,
      evidence: properties,
    });
  };

  const captureAgentStatus = (status: AgentStatus, agentName: string): void => {
    setAgentStatus(status);
    if (!agentName.trim()) return;
    const capturedAtMs = Date.now();
    const observedAt = new Date(capturedAtMs).toISOString();
    const text = agentStatusEvidenceText(status, agentName);
    if (!text) return;
    const evidence = buildAgentStatusEvidence({
      text,
      agentName,
      status,
      bridgeMessageSource: 'agent_status',
      observedAt,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      capturedAtMs,
      messageTimestamp: capturedAtMs,
    });
    if (!evidence) return;
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent('ai_agent_status', evidence.text, 'agent', properties);
    publishAgentInteractionEvent({
      eventType: 'ai_agent_status',
      actor: 'agent',
      text: evidence.text,
      evidence: properties,
    });
  };

  const captureAgentFileChange = (event: AgentFileChangeEvent): void => {
    const evidence = buildCodeServerFileChangeEvidence({
      filePath: event.filePath,
      actionName: event.actionName,
      source: event.source,
      observedAt: event.observedAt,
      sizeBytes: event.sizeBytes,
      contentHash: event.contentHash,
      contentPreview: event.contentPreview,
      persisted: event.persisted,
      workspace,
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    if (!evidence) return;
    const properties = {
      ...evidence.properties,
      durableObjectReplayExpected: true,
    };
    captureSessionEvent(evidence.eventType, evidence.text, 'system', properties);
    publishCodeServerFileEvent({
      eventType: evidence.eventType,
      actor: 'system',
      text: evidence.text,
      evidence: properties,
    });
  };

  const remoteParticipantLabel = metadata.role === 'HOST' ? 'Guest' : 'Host';
  const remoteParticipantRole = metadata.role === 'HOST' ? 'GUEST' : 'HOST';
  const remoteMediaState = room.mediaControlStates.find((state) => state.role === remoteParticipantRole);
  const remoteMediaStatus = remoteMediaState ? mediaStatusLabel(remoteMediaState) : '';
  const localMediaStatus = mediaStatusLabel({
    microphoneEnabled: room.micEnabled,
    cameraEnabled: room.cameraEnabled,
  });

  const renderAssessmentStatusStrip = (): JSX.Element => (
    <AssessmentStatusStrip
      meetingType={metadata.meetingType}
      workspace={workspace}
      workspaceLoading={workspaceLoading}
      workspaceError={workspaceError}
      canLaunchWorkspace={canLaunchWorkspace}
      assessmentProgress={assessmentProgress}
      onLaunchWorkspace={() => void launchWorkspace()}
      onOpenWorkspace={() => openWorkspacePanel()}
      onOpenSubmission={() => openSubmissionPanel()}
    />
  );

  const renderAssessmentTaskBrief = (): JSX.Element => (
    <AssessmentTaskBrief
      packet={workspaceChallengePacket}
      workspace={workspace}
      progress={assessmentProgress}
      workspaceReady={hasActiveWorkspace}
      onOpenWorkspace={() => openWorkspacePanel()}
      onOpenSubmission={() => openSubmissionPanel()}
    />
  );

  const renderSurfaceContent = (win: ToolSurfaceState): JSX.Element => {
    switch (win.surfaceType) {
      case 'video':
        return (
          <div className="room-video-content">
            <div className="room-video-grid">
              {/* Remote participant tile */}
              <div className="room-video-tile">
                {room.remoteStream ? (
                  <StreamVideo stream={room.remoteStream} className="room-video-tile-stream" testId="remote-video" />
                ) : (
                  <div className="room-video-tile-empty" data-testid="waiting-state">
                    <div className="room-video-tile-avatar">
                      {metadata.role === 'HOST' ? '👤' : '🏠'}
                    </div>
                    <span className="room-video-tile-label">
                      {isRoomError ? 'Connection interrupted'
                        : isRecovering ? 'Reconnecting...'
                        : isOpening ? 'Opening room...'
                        : isConnecting ? 'Connecting...'
                        : metadata.role === 'HOST' ? 'Waiting for guest'
                        : 'Waiting for host'}
                    </span>
                    {canRetry && (
                      <button onClick={room.retryConnection} data-testid="retry-connection" className="room-video-tile-btn">Retry</button>
                    )}
                    {!canRetry && canStartCall && (
                      <button onClick={() => void room.startCall()} data-testid="start-call" className="room-video-tile-btn">Start call</button>
                    )}
                    {canAccept && (
                      <button onClick={() => void room.acceptCall()} data-testid="accept-call" className="room-video-tile-btn">Join call</button>
                    )}
                  </div>
                )}
                <span className="room-video-tile-name">
                  <span>{remoteParticipantLabel}</span>
                  {remoteMediaStatus && (
                    <span className="room-video-tile-status">{remoteMediaStatus}</span>
                  )}
                </span>
              </div>

              {/* Local participant tile */}
              <div className="room-video-tile">
                {room.localStream ? (
                  <StreamVideo stream={room.localStream} muted className="room-video-tile-stream local-video" testId="local-video" />
                ) : (
                  <div className="room-video-tile-empty">
                    <div className="room-video-tile-avatar">📷</div>
                    <span className="room-video-tile-label">Camera off</span>
                  </div>
                )}
                <span className="room-video-tile-name">
                  <span>You</span>
                  {localMediaStatus && (
                    <span className="room-video-tile-status">{localMediaStatus}</span>
                  )}
                </span>
              </div>
            </div>

            {renderAssessmentStatusStrip()}

            <div className="room-video-controls">
              <button
                className="room-video-btn"
                onClick={toggleMicrophone}
                aria-label="Toggle microphone"
                disabled={!room.hasLocalMicrophone}
              >
                {room.micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
              <button
                className="room-video-btn"
                onClick={toggleCamera}
                aria-label="Toggle camera"
                disabled={!room.hasLocalCamera}
              >
                {room.cameraEnabled ? <Camera size={16} /> : <CameraOff size={16} />}
              </button>
              {(metadata.features?.agentEnabled ?? true) && (
                <button
                  className={`room-video-btn is-assistant${agentChatOpen ? ' is-active' : ''}`}
                  onClick={() => openAgentChat('call')}
                  aria-label={`Open AI assistant - ${assistantCallStatus}`}
                  title={`AI assistant - ${assistantCallStatus}`}
                  data-testid="open-ai-assistant"
                >
                  <Bot size={16} />
                  <span className={`room-video-btn-status ${agentTrayStatus}`} aria-hidden="true" />
                </button>
              )}
              {metadata.role === 'HOST' && (metadata.features?.recordingEnabled ?? true) && (
                recordingState === 'recording' ? (
                  <button
                    className="room-video-btn is-recording"
                    onClick={() => void stopRecording()}
                    disabled={!canStopRecording}
                    aria-label="Stop recording"
                    data-testid="stop-recording"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="room-video-btn"
                    onClick={() => void startRecording()}
                    disabled={!canStartRecording}
                    aria-label={recordingButtonLabel}
                    data-testid="start-recording"
                  >
                    <Circle size={14} fill="none" />
                  </button>
                )
              )}
              {(metadata.features?.recordingEnabled ?? true) && (metadata.role === 'HOST' || room.recordingState) && (
                <span
                  className={`room-recording-state${visibleRecordingActive ? ' is-recording' : ''}`}
                  data-testid="recording-state"
                >
                  {visibleRecordingLabel}
                </span>
              )}
              {metadata.role === 'HOST' && inlineRecordingNotice && (
                <span className="room-recording-state" data-testid="recording-save-status">
                  {inlineRecordingNotice}
                </span>
              )}
              <button className="room-video-btn is-hangup" onClick={() => void endCall()} aria-label="End call" data-testid="end-call">
                <PhoneOff size={16} />
              </button>
            </div>
          </div>
        );

      case 'workspace':
        return (
          <div className="room-workspace-content" style={{ position: 'relative' }}>
            {workspaceUrl ? (
              <>
                {!iframeLoaded && (
                  <div className="room-workspace-loader">
                    <Loader2 size={24} className="spin" />
                    <span>Loading editor...</span>
                  </div>
                )}
                <iframe
                  src={workspaceUrl}
                  title="VS Code workspace"
                  className="room-workspace-iframe"
                  data-testid="workspace-iframe"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
                  onLoad={captureWorkspaceEditorOpen}
                />
              </>
            ) : (
              <div className="room-workspace-empty">
                <SquareTerminal size={26} />
                <h3>
                  {workspaceSession?.status === 'LAUNCHING'
                    ? 'Starting workspace...'
                    : workspaceSession?.status === 'ERROR'
                      ? 'Workspace failed'
                      : canRelaunchWorkspace
                        ? 'Workspace needs relaunch'
                      : 'Workspace ready to launch'}
                </h3>
                <p>
                  {workspaceSession?.status === 'LAUNCHING'
                    ? 'The container is warming up. This can take 20-30 seconds.'
                    : workspaceRecoveryNotice
                      ? workspaceRecoveryNotice
                    : workspaceSession?.errorMessage
                      ? workspaceSession.errorMessage
                      : workspaceError
                      ? workspaceError
                      : workspaceChallengeMessage
                        ? workspaceChallengeMessage
                        : metadata.role === 'HOST'
                          ? 'Launch a repo into a live code-server workspace for this call.'
                          : 'The host can launch the live code workspace.'}
                </p>
                {needsRepoUrl && canLaunchWorkspace && (
                  <input
                    type="url"
                    className="room-workspace-repo-input"
                    placeholder="https://github.com/org/repo"
                    value={workspaceRepoInput}
                    onChange={(e) => setWorkspaceRepoInput(e.target.value)}
                    data-testid="workspace-repo-input"
                  />
                )}
                {canLaunchWorkspace && (
                  <>
                    {canOpenAgentBridgePanel && (
                      <label className="workspace-agent-toggle">
                        <input
                          type="checkbox"
                          checked={workspaceAgentEnabled}
                          onChange={(e) => setWorkspaceAgentEnabled(e.target.checked)}
                          data-testid="workspace-devin-agent-toggle"
                        />
                        <span>Start Devin bridge</span>
                      </label>
                    )}
                    <button
                      className="room-workspace-launch-btn"
                      onClick={() => void launchWorkspace()}
                      disabled={needsRepoUrl && !workspaceRepoInput.trim()}
                    >
                      {workspaceLoading ? <Loader2 size={14} className="spin" /> : <SquareTerminal size={14} />}
                      {workspaceLaunchActionLabel}
                    </button>
                  </>
                )}
                {workspaceSession?.status === 'LAUNCHING' && (
                  <button className="room-workspace-launch-btn" onClick={() => void refreshWorkspace()}>
                    <RefreshCcw size={14} /> Refresh
                  </button>
                )}
              </div>
            )}
          </div>
        );

      case 'chat':
        return (
          <ChatPanel
            messages={chatMessages}
            onSend={(text) => sendChatMessage(text)}
            currentUserRole={metadata.role}
            onAskAssistant={(metadata.features?.agentEnabled ?? true)
              ? () => openAgentChat('chat')
              : undefined}
          />
        );

      case 'terminal':
        return (
          <TerminalPanel
            wsUrl={workspaceSession && hasActiveWorkspace
              ? roomTerminalWsUrl(token, workspaceSession.sessionId)
              : ''}
            onCommand={captureTerminalCommand}
            onOutput={captureTerminalOutput}
            queuedCommand={queuedTerminalCommand}
            queuedCommandRequest={queuedTerminalCommandRequest}
            onQueuedCommandSent={() => setQueuedTerminalCommand(null)}
          />
        );

      case 'submission':
        return (
          <CommitSubmissionPanel
            defaultRepositoryUrl={workspace?.repoUrl ?? null}
            challengePacket={workspace?.challenge?.packet ?? null}
            assessmentProgress={assessmentProgress}
            disabledReason={workspace?.enabled
              ? null
              : 'Commit submission is only available for dev-container assessment rooms.'}
            onSubmit={submitCommitFromRoom}
            onProgressChange={setAssessmentProgress}
            workspaceFinalizeAvailable={Boolean(workspace?.enabled && hasActiveWorkspace)}
            workspaceFinalizeDisabledReason={workspace?.enabled && !hasActiveWorkspace
              ? 'Launch the workspace before finalizing the assessment commit.'
              : null}
            onFinalizeWorkspace={finalizeCommitFromWorkspace}
          />
        );

      default:
        return <div style={{ padding: '8px', color: '#000' }}>Surface content</div>;
    }
  };

  const roomSurface = (
    <StandardLayout
      toolSurfaces={toolSurfaces}
      renderSurfaceContent={renderSurfaceContent}
      assessmentHeader={roomAssessmentMode === 'dev_container_assessment'
        ? renderAssessmentStatusStrip()
        : undefined}
      assessmentAside={roomAssessmentMode === 'dev_container_assessment'
        ? renderAssessmentTaskBrief()
        : undefined}
      recordingLabel={visibleRecordingLabel}
      recordingActive={visibleRecordingActive}
      modeLabel={roomAssessmentModeLabel}
      primarySurface={roomAssessmentMode === 'dev_container_assessment' ? 'workspace' : 'video'}
    />
  );

  if (inLobby) {
    return lobbySurface;
  }

  return (
    <>
      <div
        className="call-stage"
        data-testid="call-stage"
        data-room-phase={room.phase}
        data-room-layout="standard"
      >
        {roomSurface}
      </div>
      {enteredRoom && (metadata.features?.agentEnabled ?? true) && (
        <AgentAssistant
          chatOpen={agentChatOpen}
          onChatOpen={() => setAgentChatOpen(true)}
          onChatClose={closeAgentChat}
          agentWsUrl={workspaceSession && hasActiveWorkspace
            ? roomAgentWsUrl(token, workspaceSession.sessionId)
            : null}
          agentEnabled={hasActiveWorkspace}
          agentUnavailableMessage={agentUnavailableMessage}
          canLaunchAgentWorkspace={canLaunchWorkspace}
          promptActor={roomActor}
          promptWorkspaceSessionId={workspaceSession?.sessionId ?? null}
          openChatRequest={agentChatRequest}
          onOpenBrowser={openBrowserTab}
          onOpenAuthBrowser={openDevinAuthBrowser}
          onOpenTerminal={openTerminalPanel}
          onOpenAuthTerminal={openDevinAuthTerminal}
          onCheckAuth={checkDevinAuth}
          onAction={handleAgentAction}
          onAgentRoomAction={handleAgentRoomAction}
          onUserChatMessage={captureAgentUserChatMessage}
          onAgentChatMessage={captureAgentChatMessage}
          onAgentStatus={captureAgentStatus}
          onAgentFileChange={captureAgentFileChange}
        />
      )}
      {room.phase === 'ended' && (
        <div className="ended-overlay" style={{ zIndex: 99999 }}>
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
    </>
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
