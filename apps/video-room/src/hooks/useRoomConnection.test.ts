import { describe, expect, it } from 'vitest';
import {
  addLocalMediaToPeer,
  applyRoomChatRejection,
  applyRoomMediaControlEvent,
  applyRoomRecordingStateEvent,
  hasSourceBackedCodeServerFileEvidence,
  hasSourceBackedChatEvidence,
  hasSourceBackedAgentInteractionEvidence,
  hasSourceBackedMediaControlEvidence,
  hasSourceBackedMediaControlStateEvidence,
  hasSourceBackedRecordingStateEvidence,
  hasSourceBackedRecordingStateSnapshotEvidence,
  hasSourceBackedTerminalEvidence,
  mergeRoomChatMessage,
  type RoomChatMessage,
  type RoomAgentInteractionEvent,
  type RoomCodeServerFileEvent,
  type RoomMediaControlEvent,
  type RoomMediaControlState,
  type RoomRecordingState,
  type RoomRecordingStateEvent,
  type RoomTerminalEvent,
} from './useRoomConnection';
import { roomChatMessageFingerprint } from '../lib/chatEvidence';

function makePeerRecorder(): {
  peer: RTCPeerConnection;
  tracks: string[];
  transceivers: Array<{ kind: string; direction: RTCRtpTransceiverDirection | undefined }>;
} {
  const tracks: string[] = [];
  const transceivers: Array<{ kind: string; direction: RTCRtpTransceiverDirection | undefined }> = [];
  const peer = {
    addTrack(track: MediaStreamTrack): RTCRtpSender {
      tracks.push(track.kind);
      return {} as RTCRtpSender;
    },
    addTransceiver(kind: string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver {
      transceivers.push({ kind, direction: init?.direction });
      return {} as RTCRtpTransceiver;
    },
  } as unknown as RTCPeerConnection;
  return { peer, tracks, transceivers };
}

function mediaStreamWithTrackKinds(kinds: string[]): MediaStream {
  return {
    getTracks: () => kinds.map((kind) => ({ kind }) as MediaStreamTrack),
  } as unknown as MediaStream;
}

describe('addLocalMediaToPeer', () => {
  it('keeps the peer negotiable when no local camera or microphone is available', () => {
    const { peer, tracks, transceivers } = makePeerRecorder();

    addLocalMediaToPeer(peer, mediaStreamWithTrackKinds([]));

    expect(tracks).toEqual([]);
    expect(transceivers).toEqual([
      { kind: 'audio', direction: 'recvonly' },
      { kind: 'video', direction: 'recvonly' },
    ]);
  });

  it('adds missing receive lanes without duplicating local tracks', () => {
    const { peer, tracks, transceivers } = makePeerRecorder();

    addLocalMediaToPeer(peer, mediaStreamWithTrackKinds(['audio']));

    expect(tracks).toEqual(['audio']);
    expect(transceivers).toEqual([
      { kind: 'video', direction: 'recvonly' },
    ]);
  });
});

describe('hasSourceBackedAgentInteractionEvidence', () => {
  it('accepts source-backed user chat submitted to the real agent bridge', () => {
    const text = 'Can you inspect the task?';
    const event: RoomAgentInteractionEvent = {
      id: 'agent-interaction-1',
      clientId: 'guest-client',
      createdAt: 1700000002000,
      eventType: 'ai_chat_user',
      actor: 'guest',
      text,
      evidence: {
        source: 'agent_chat_client_submit',
        agentChatEventSource: 'browser_agent_chat_panel',
        actor: 'guest',
        bridgeMessageType: 'CHAT',
        bridgeProtocol: 'agent_dev_container_ws',
        bridgeDeliveryStatus: 'queued',
        promptId: 'workspace-1:guest:prompt:1700000002000:agent_0123abcd',
        promptFingerprint: 'agent_0123abcd',
        promptLength: text.length,
        promptTimestamp: 1700000002000,
        browserQueuedBridgeMessage: true,
        bridgeDeliveryConfirmed: false,
        deliveredToAgentBridge: false,
        agent: null,
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        repoUrl: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedAgentInteractionEvidence(event, 'GUEST')).toBe(true);
    expect(hasSourceBackedAgentInteractionEvidence(event, 'HOST')).toBe(false);
  });

  it('accepts real agent response evidence without fabricating a local Devin reply', () => {
    const text = 'I found the repository task context.';
    const event: RoomAgentInteractionEvent = {
      id: 'agent-interaction-2',
      clientId: 'host-client',
      createdAt: 1700000003000,
      eventType: 'ai_chat_agent',
      actor: 'agent',
      text,
      evidence: {
        source: 'agent_bridge',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-28T17:00:03.000Z',
        capturedAtMs: 1700000003000,
        agent: 'devin',
        responseFingerprint: 'agent_89abcdef',
        responseLength: text.length,
        agentChatResponseId: 'agent-chat:devin:1700000003000:CHAT_RESPONSE:agent_89abcdef',
        bridgePersisted: false,
        persistenceFallback: 'browser_after_bridge_persist_failed',
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        messageTimestamp: 1700000003000,
        agentResponseClaimed: true,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedAgentInteractionEvidence(event, 'HOST')).toBe(true);
  });

  it('accepts source-backed agent bridge UI actions and rejects source-less events', () => {
    const action: RoomAgentInteractionEvent = {
      id: 'agent-interaction-3',
      clientId: 'host-client',
      createdAt: 1700000004000,
      eventType: 'agent_action',
      actor: 'host',
      text: 'Agent bridge opened from the room controls',
      evidence: {
        source: 'agent_tray_ui',
        actionId: 'open-agent-chat',
        origin: 'tray',
        executedBy: 'host',
        actionSource: 'assessment_agent_tray',
        executionStatus: 'opened',
        capturedAtMs: 1700000004000,
        agentActionEventId: 'agent-action:host:1700000004000:agent_tray_ui:tray:opened:open-agent-chat',
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        agent: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedAgentInteractionEvidence(action, 'HOST')).toBe(true);
    expect(hasSourceBackedAgentInteractionEvidence({
      ...action,
      text: 'Agent bridge opened from the video call controls',
      actor: 'guest',
      evidence: {
        source: 'agent_call_controls_ui',
        actionId: 'open-agent-chat',
        origin: 'call',
        executedBy: 'guest',
        actionSource: 'video_call_controls',
        executionStatus: 'opened',
        capturedAtMs: 1700000005000,
        agentActionEventId: 'agent-action:guest:1700000005000:agent_call_controls_ui:call:opened:open-agent-chat',
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: null,
        workspaceSessionId: null,
        agent: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    }, 'GUEST')).toBe(true);
    expect(hasSourceBackedAgentInteractionEvidence({
      ...action,
      text: 'Agent bridge opened from the video call controls',
      actor: 'guest',
      evidence: {
        source: 'agent_call_controls_ui',
        actionId: 'open-agent-chat',
        origin: 'tray',
        executedBy: 'guest',
        actionSource: 'assessment_agent_tray',
        executionStatus: 'opened',
        capturedAtMs: 1700000005000,
        agentActionEventId: 'agent-action:guest:1700000005000:agent_call_controls_ui:tray:opened:open-agent-chat',
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: null,
        workspaceSessionId: null,
        agent: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedAgentInteractionEvidence({
      ...action,
      evidence: {
        source: 'agent_tray_ui',
      },
    }, 'HOST')).toBe(false);
  });
});

describe('applyRoomRecordingStateEvent', () => {
  it('stores the latest host recording state for guest-visible indicators', () => {
    expect(applyRoomRecordingStateEvent(null, {
      id: 'recording-state-1',
      clientId: 'host-client',
      createdAt: 3000,
      role: 'HOST',
      lifecycleKind: 'start',
      status: 'recording',
      active: true,
      evidence: {
        source: 'video_room_recording',
        recordingStateEventId: 'recording:host:3000:start:recording',
      },
    })).toEqual({
      role: 'HOST',
      status: 'recording',
      active: true,
      updatedAt: 3000,
      evidence: {
        source: 'video_room_recording',
        recordingStateEventId: 'recording:host:3000:start:recording',
      },
    });
  });
});

describe('hasSourceBackedMediaControlEvidence', () => {
  const sourceBackedMediaEvidence = {
    source: 'video_room_media_controls',
    mediaControlEventSource: 'browser_video_control_button',
    actor: 'guest',
    mediaControlId: 'media:guest:microphone:1700000001000:disabled',
    capturedAtMs: 1700000001000,
    control: 'microphone',
    previousEnabled: true,
    enabled: false,
    action: 'disabled',
    surface: 'standard',
    roomPhase: 'connected',
    controlSurface: 'standard_video_call',
    controlAction: 'toggle',
    mediaSource: 'local_media_stream',
    rawMediaStreamPersisted: false,
  };
  const sourceBackedMediaControl: RoomMediaControlEvent = {
    id: 'media:guest:microphone:1700000001000:disabled',
    clientId: 'guest-client',
    createdAt: 1700000001000,
    role: 'GUEST',
    control: 'microphone',
    previousEnabled: true,
    enabled: false,
    evidence: sourceBackedMediaEvidence,
  };

  it('accepts media-control updates only when browser button evidence matches the room actor and control', () => {
    expect(hasSourceBackedMediaControlEvidence(sourceBackedMediaControl, 'GUEST')).toBe(true);
  });

  it('rejects source-less media-control updates before optimistic state can change', () => {
    expect(hasSourceBackedMediaControlEvidence({
      ...sourceBackedMediaControl,
      evidence: undefined,
    }, 'GUEST')).toBe(false);
  });

  it('rejects media-control updates when the event id does not match the source-backed control id', () => {
    expect(hasSourceBackedMediaControlEvidence({
      ...sourceBackedMediaControl,
      id: 'media:guest:microphone:1700000001000:enabled',
    }, 'GUEST')).toBe(false);
  });

  it('rejects media-control updates attributed to the wrong room actor', () => {
    expect(hasSourceBackedMediaControlEvidence(sourceBackedMediaControl, 'HOST')).toBe(false);
  });

  it('accepts media-control snapshot state only when the projection carries source-backed event evidence', () => {
    expect(hasSourceBackedMediaControlStateEvidence({
      role: 'GUEST',
      microphoneEnabled: false,
      cameraEnabled: true,
      updatedAt: 1700000001001,
      evidence: sourceBackedMediaEvidence,
    })).toBe(true);
  });

  it('rejects media-control snapshot state without evidence for the changed control', () => {
    expect(hasSourceBackedMediaControlStateEvidence({
      role: 'GUEST',
      microphoneEnabled: true,
      cameraEnabled: true,
      updatedAt: 1700000001001,
      evidence: sourceBackedMediaEvidence,
    })).toBe(false);
    expect(hasSourceBackedMediaControlStateEvidence({
      role: 'GUEST',
      microphoneEnabled: false,
      updatedAt: 1700000001001,
    })).toBe(false);
  });
});

describe('hasSourceBackedRecordingStateEvidence', () => {
  const sourceBackedRecordingStart: RoomRecordingStateEvent = {
    id: 'recording:host:1700000003000:start:recording',
    clientId: 'host-client',
    createdAt: 1700000003000,
    role: 'HOST',
    lifecycleKind: 'start',
    status: 'recording',
    active: true,
    evidence: {
      source: 'video_room_recording',
      recordingEventSource: 'browser_media_recorder',
      recordingStateEventSource: 'browser_media_recorder_state_sync',
      actor: 'host',
      recordingLifecycleKind: 'start',
      recordingStateEventId: 'recording:host:1700000003000:start:recording',
      capturedAtMs: 1700000003000,
      surface: 'standard',
      roomPhase: 'connected',
      recordingStatus: 'recording',
      recordingActive: true,
      durableObjectReplayExpected: true,
      iceProvider: 'cloudflare',
      hasTranscriptionAudio: true,
      speakerMetadataVersion: 1,
      speakerChannelLayout: 'host-local-guest-remote-v1',
      speakerChannelCount: 2,
      speakerChannels: [
        { channel: 0, role: 'host', source: 'local' },
        { channel: 1, role: 'guest', source: 'remote' },
      ],
    },
  };

  it('accepts host recording state only when MediaRecorder evidence preserves speaker/source metadata', () => {
    expect(hasSourceBackedRecordingStateEvidence(sourceBackedRecordingStart, 'HOST')).toBe(true);
  });

  it('rejects source-less recording state before optimistic state can change', () => {
    expect(hasSourceBackedRecordingStateEvidence({
      ...sourceBackedRecordingStart,
      evidence: undefined,
    }, 'HOST')).toBe(false);
  });

  it('rejects recording state when the event id does not match the source-backed recording id', () => {
    expect(hasSourceBackedRecordingStateEvidence({
      ...sourceBackedRecordingStart,
      id: 'recording:host:1700000003000:stop:saved',
    }, 'HOST')).toBe(false);
  });

  it('rejects vague failed recording state without concrete failure provenance', () => {
    expect(hasSourceBackedRecordingStateEvidence({
      ...sourceBackedRecordingStart,
      id: 'recording:host:1700000003000:stop:failed',
      lifecycleKind: 'stop',
      status: 'failed',
      active: false,
      evidence: {
        ...sourceBackedRecordingStart.evidence!,
        recordingLifecycleKind: 'stop',
        recordingStateEventId: 'recording:host:1700000003000:stop:failed',
        recordingStatus: 'failed',
        recordingActive: false,
      },
    }, 'HOST')).toBe(false);
  });

  it('accepts recording snapshot state only when it reconstructs to source-backed MediaRecorder evidence', () => {
    const snapshot: RoomRecordingState = {
      role: 'HOST',
      status: 'recording',
      active: true,
      updatedAt: 1700000003000,
      evidence: sourceBackedRecordingStart.evidence,
    };

    expect(hasSourceBackedRecordingStateSnapshotEvidence(snapshot)).toBe(true);
  });

  it('rejects recording snapshot state without matching source evidence', () => {
    expect(hasSourceBackedRecordingStateSnapshotEvidence({
      role: 'HOST',
      status: 'recording',
      active: false,
      updatedAt: 1700000003000,
      evidence: sourceBackedRecordingStart.evidence,
    })).toBe(false);
    expect(hasSourceBackedRecordingStateSnapshotEvidence({
      role: 'HOST',
      status: 'recording',
      active: true,
      updatedAt: 1700000003000,
    })).toBe(false);
  });
});

describe('mergeRoomChatMessage', () => {
  it('accepts source-backed optimistic chat evidence before Durable Object ACK', () => {
    const text = 'Can you see this?';
    const pending: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text,
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint(text),
        deliveryStatus: 'pending',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedChatEvidence(pending, 'HOST', 'pending')).toBe(true);
  });

  it('accepts source-backed room chat messages after Durable Object ACK', () => {
    const text = 'Can you see this?';
    const accepted: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text,
      deliveryStatus: 'accepted',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint(text),
        deliveryStatus: 'accepted',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedChatEvidence(accepted, 'HOST')).toBe(true);
  });

  it('rejects room chat evidence missing stable message identity', () => {
    const text = 'Can you see this?';
    const accepted: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text,
      deliveryStatus: 'accepted',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'host',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint(text),
        deliveryStatus: 'accepted',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedChatEvidence(accepted, 'HOST')).toBe(false);
  });

  it('rejects room chat evidence when the text no longer matches the source fingerprint', () => {
    const text = 'Can you see this?';
    const accepted: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text,
      deliveryStatus: 'accepted',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint('Can we see those?'),
        deliveryStatus: 'accepted',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

    expect('Can we see those?').toHaveLength(text.length);
    expect(hasSourceBackedChatEvidence(accepted, 'HOST')).toBe(false);
  });

  it('rejects source-less room chat messages', () => {
    const accepted: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text: 'Can you see this?',
      deliveryStatus: 'accepted',
      evidence: {
        deliveryStatus: 'accepted',
      },
    };

    expect(hasSourceBackedChatEvidence(accepted, 'HOST')).toBe(false);
  });

  it('replaces a pending optimistic message with the accepted room message', () => {
    const pending: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text: 'Can you see this?',
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        deliveryStatus: 'pending',
        surface: 'standard',
        roomPhase: 'connected',
      },
    };

    const accepted: RoomChatMessage = {
      ...pending,
      deliveryStatus: 'accepted',
      evidence: {
        ...pending.evidence,
        deliveryStatus: 'accepted',
      },
    };

    expect(mergeRoomChatMessage([pending], accepted)).toEqual([accepted]);
  });

  it('keeps the Durable Object rejection reason on source-backed failed chat evidence', () => {
    const pending: RoomChatMessage = {
      id: 'chat-1',
      clientId: 'host-client',
      createdAt: 1000,
      role: 'HOST',
      text: 'Can you see this?',
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        deliveryStatus: 'pending',
        surface: 'standard',
        roomPhase: 'connected',
      },
    };

    expect(applyRoomChatRejection([pending], {
      clientMessageId: 'chat-1',
      reason: 'INVALID_EVIDENCE',
    })).toEqual([{
      ...pending,
      deliveryStatus: 'rejected',
      evidence: {
        ...pending.evidence,
        deliveryStatus: 'rejected',
        deliveryRejectionReason: 'INVALID_EVIDENCE',
      },
    }]);
  });
});

describe('applyRoomMediaControlEvent', () => {
  it('keeps one media state per role while preserving the other control state', () => {
    const previous: RoomMediaControlState[] = [
      {
        role: 'GUEST',
        microphoneEnabled: true,
        cameraEnabled: true,
        updatedAt: 1000,
      },
      {
        role: 'HOST',
        microphoneEnabled: true,
        cameraEnabled: true,
        updatedAt: 1000,
      },
    ];

    const next = applyRoomMediaControlEvent(previous, {
      id: 'media-guest-camera-off',
      clientId: 'guest-client',
      createdAt: 2000,
      role: 'GUEST',
      control: 'camera',
      previousEnabled: true,
      enabled: false,
      evidence: {
        source: 'video_room_media_controls',
      },
    });

    expect(next).toEqual([
      {
        role: 'HOST',
        microphoneEnabled: true,
        cameraEnabled: true,
        updatedAt: 1000,
      },
      {
        role: 'GUEST',
        microphoneEnabled: true,
        cameraEnabled: false,
        updatedAt: 2000,
        evidence: {
          source: 'video_room_media_controls',
        },
      },
    ]);
  });
});

describe('hasSourceBackedTerminalEvidence', () => {
  const sourceBackedCommand: RoomTerminalEvent = {
    id: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
    clientId: 'guest-client',
    createdAt: 1700000001000,
    kind: 'COMMAND',
    text: 'npm test',
    evidence: {
      source: 'container_terminal',
      terminalEventSource: 'browser_terminal_ws',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
      terminalCommandSequence: 1,
      actor: 'guest',
      capturedAtMs: 1700000001000,
      commandFingerprint: 'terminal_dc5964d6',
      commandLength: 8,
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      durableObjectReplayExpected: true,
    },
  };

  it('accepts terminal commands only when browser terminal evidence matches the event and actor', () => {
    expect(hasSourceBackedTerminalEvidence(sourceBackedCommand, 'GUEST')).toBe(true);
  });

  it('rejects source-less terminal events before optimistic local state can change', () => {
    expect(hasSourceBackedTerminalEvidence({
      ...sourceBackedCommand,
      evidence: undefined,
    }, 'GUEST')).toBe(false);
  });

  it('rejects terminal commands attributed to the wrong room actor', () => {
    expect(hasSourceBackedTerminalEvidence(sourceBackedCommand, 'HOST')).toBe(false);
  });

  it('rejects terminal commands whose event id does not match the source-backed command id', () => {
    expect(hasSourceBackedTerminalEvidence({
      ...sourceBackedCommand,
      id: 'terminal-random-transport-id',
    }, 'GUEST')).toBe(false);
  });

  it('rejects terminal output whose event id does not match the source-backed output chunk id', () => {
    const sourceBackedOutput: RoomTerminalEvent = {
      id: 'terminal-random-output-id',
      clientId: 'guest-client',
      createdAt: 1700000002000,
      kind: 'OUTPUT',
      text: 'PASS src/app.test.ts\n',
      evidence: {
        source: 'container_terminal',
        terminalEventSource: 'browser_terminal_ws',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
        terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
        terminalOutputSequence: 1,
        actor: 'system',
        capturedAtMs: 1700000002000,
        outputFingerprint: 'terminal_4f2d0d8f',
        outputLength: 21,
        surface: 'standard',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedTerminalEvidence(sourceBackedOutput, 'GUEST')).toBe(false);
    expect(hasSourceBackedTerminalEvidence({
      ...sourceBackedOutput,
      id: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
    }, 'GUEST')).toBe(true);
  });
});

describe('hasSourceBackedCodeServerFileEvidence', () => {
  const sourceBackedSave: RoomCodeServerFileEvent = {
    id: 'code-server-file:workspace-session-1:1782561600000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
    clientId: 'guest-client',
    createdAt: 1700000003000,
    eventType: 'code_editor_save',
    actor: 'system',
    text: 'src/app.ts',
    evidence: {
      source: 'code_server_workspace',
      observedBy: 'agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      codeServerFileChangeId: 'code-server-file:workspace-session-1:1782561600000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
      action: 'modified',
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      path: 'src/app.ts',
      observedAt: '2026-06-27T12:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 421,
      bridgePersisted: false,
      durableObjectReplayExpected: true,
    },
  };

  it('accepts code-server saves only when Agent bridge workspace evidence matches the event', () => {
    expect(hasSourceBackedCodeServerFileEvidence(sourceBackedSave)).toBe(true);
  });

  it('rejects source-less code-server events before optimistic local state can change', () => {
    expect(hasSourceBackedCodeServerFileEvidence({
      ...sourceBackedSave,
      evidence: undefined,
    })).toBe(false);
  });

  it('rejects code-server events without a SHA-256 content hash', () => {
    expect(hasSourceBackedCodeServerFileEvidence({
      ...sourceBackedSave,
      evidence: {
        ...sourceBackedSave.evidence!,
        contentHash: 'sha256-source-hash',
      },
    })).toBe(false);
  });

  it('rejects code-server evidence that names a different path than the room event', () => {
    expect(hasSourceBackedCodeServerFileEvidence({
      ...sourceBackedSave,
      text: 'src/other.ts',
    })).toBe(false);
  });

  it('rejects code-server file events whose event id does not match the source-backed file change id', () => {
    expect(hasSourceBackedCodeServerFileEvidence({
      ...sourceBackedSave,
      id: 'code-file-random-transport-id',
    })).toBe(false);
  });
});
