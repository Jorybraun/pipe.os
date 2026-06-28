import { describe, expect, it } from 'vitest';
import {
  applyRoomChatRejection,
  applyRoomMediaControlEvent,
  applyRoomRecordingStateEvent,
  decideRoomSurfaceSnapshot,
  hasSourceBackedCodeServerFileEvidence,
  hasSourceBackedCursorEvidence,
  hasSourceBackedChatEvidence,
  hasSourceBackedDesktopEventEvidence,
  hasSourceBackedMediaControlEvidence,
  hasSourceBackedRecordingStateEvidence,
  hasSourceBackedRoomFileSystemEvidence,
  hasSourceBackedTerminalEvidence,
  mergePeerCursorPresence,
  mergeRoomChatMessage,
  ROOM_CURSOR_SEND_INTERVAL_MS,
  shouldSendCursorPresence,
  type RoomChatMessage,
  type RoomCodeServerFileEvent,
  type RoomCursorPresence,
  type RoomDesktopEvent,
  type RoomFileSystemEvent,
  type RoomMediaControlEvent,
  type RoomMediaControlState,
  type RoomRecordingStateEvent,
  type RoomTerminalEvent,
} from './useRoomConnection';

describe('decideRoomSurfaceSnapshot', () => {
  it('applies the Durable Object snapshot on a new socket so missed surface changes resync', () => {
    expect(decideRoomSurfaceSnapshot({
      snapshotSurface: 'standard',
      surfaceEventSeenOnSocket: false,
      pendingLocalSurfaceEvent: null,
      nowMs: 10_000,
    })).toEqual({
      applySnapshot: true,
      clearPendingLocalSurface: false,
    });
  });

  it('does not let an older snapshot overwrite a fresh local surface toggle queued during reconnect', () => {
    expect(decideRoomSurfaceSnapshot({
      snapshotSurface: 'standard',
      surfaceEventSeenOnSocket: false,
      pendingLocalSurfaceEvent: {
        surface: 'win95',
        createdAt: 9_900,
      },
      nowMs: 10_000,
      guardMs: 5_000,
    })).toEqual({
      applySnapshot: false,
      clearPendingLocalSurface: false,
    });
  });

  it('ignores snapshots after a live surface event on the current socket', () => {
    expect(decideRoomSurfaceSnapshot({
      snapshotSurface: 'standard',
      surfaceEventSeenOnSocket: true,
      pendingLocalSurfaceEvent: null,
      nowMs: 10_000,
    })).toEqual({
      applySnapshot: false,
      clearPendingLocalSurface: false,
    });
  });

  it('clears a pending local marker when the authoritative snapshot catches up', () => {
    expect(decideRoomSurfaceSnapshot({
      snapshotSurface: 'win95',
      surfaceEventSeenOnSocket: false,
      pendingLocalSurfaceEvent: {
        surface: 'win95',
        createdAt: 9_900,
      },
      nowMs: 10_000,
      guardMs: 5_000,
    })).toEqual({
      applySnapshot: true,
      clearPendingLocalSurface: true,
    });
  });
});

describe('hasSourceBackedDesktopEventEvidence', () => {
  const surfaceEvent: RoomDesktopEvent = {
    id: 'surface-event-1',
    clientId: 'host-client',
    createdAt: 1700000001000,
    kind: 'SET_ROOM_SURFACE',
    surface: 'win95',
    previousSurface: 'standard',
    action: 'enter_desktop',
    source: 'room_surface_control',
    surfaceControlEventSource: 'browser_room_surface_toggle',
    surfaceChangeId: 'surface:host:1700000001000:standard:win95',
    capturedAtMs: 1700000001000,
    roomPhase: 'connected',
    durableObjectReplayExpected: true,
  };

  const startMenuEvent: RoomDesktopEvent = {
    id: 'start-menu-event-1',
    clientId: 'guest-client',
    createdAt: 1700000002000,
    kind: 'START_MENU_STATE',
    open: true,
    evidence: {
      source: 'win95_start_menu_control',
      menuEventSource: 'win95_start_button',
      actor: 'guest',
      menuId: 'start',
      action: 'open',
      open: true,
      startMenuEventId: 'start-menu:guest:1700000002000:open:win95_start_button',
      capturedAtMs: 1700000002000,
      surface: 'win95',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    },
  };

  const workspaceEvent: RoomDesktopEvent = {
    id: 'workspace-state-event-1',
    clientId: 'host-client',
    createdAt: 1700000003000,
    kind: 'WORKSPACE_STATE_CHANGED',
    actor: 'host',
    workspaceStateEventId: 'workspace-state:host:1700000003000:launch:workspace-session-1:READY',
    capturedAtMs: 1700000003000,
    status: 'READY',
    workspaceSessionId: 'workspace-session-1',
    repoUrl: 'https://github.com/cloudflare/workers-sdk',
    source: 'browser_workspace_state_observer',
    workspaceEventSource: 'browser_workspace_state_observer',
    workspaceStateSource: 'launch',
    workspaceTelemetryPersisted: true,
    proxyUrlPersisted: false,
  };

  it('accepts surface changes only when browser toggle evidence matches the room actor and transition', () => {
    expect(hasSourceBackedDesktopEventEvidence(surfaceEvent, 'HOST')).toBe(true);
  });

  it('rejects source-less surface changes before optimistic desktop mode can change', () => {
    expect(hasSourceBackedDesktopEventEvidence({
      ...surfaceEvent,
      source: undefined,
      surfaceChangeId: undefined,
    }, 'HOST')).toBe(false);
  });

  it('accepts Start menu changes with source-backed Win95 menu evidence', () => {
    expect(hasSourceBackedDesktopEventEvidence(startMenuEvent, 'GUEST')).toBe(true);
  });

  it('rejects window lifecycle events without source-backed window evidence', () => {
    expect(hasSourceBackedDesktopEventEvidence({
      id: 'open-window-1',
      clientId: 'guest-client',
      createdAt: 1700000002500,
      kind: 'OPEN_WINDOW',
      window: {
        id: 'chat',
        windowType: 'chat',
        title: 'Chat',
      },
    }, 'GUEST')).toBe(false);
  });

  it('accepts workspace state only when the observer event id and session provenance match', () => {
    expect(hasSourceBackedDesktopEventEvidence(workspaceEvent, 'HOST')).toBe(true);
  });
});

describe('mergePeerCursorPresence', () => {
  it('keeps one fresh cursor per role and uses receive time for presence expiry', () => {
    const previous: RoomCursorPresence[] = [
      {
        clientId: 'guest-stale',
        role: 'GUEST',
        x: 0.1,
        y: 0.1,
        updatedAt: 900,
      },
      {
        clientId: 'guest-reloaded',
        role: 'GUEST',
        x: 0.2,
        y: 0.2,
        updatedAt: 4900,
      },
      {
        clientId: 'host-live',
        role: 'HOST',
        x: 0.4,
        y: 0.5,
        updatedAt: 4900,
      },
    ];

    const next = mergePeerCursorPresence(
      previous,
      {
        clientId: 'guest-active',
        role: 'GUEST',
        x: 0.7,
        y: 0.8,
        updatedAt: 100,
      },
      5000,
      4000,
    );

    expect(next).toEqual([
      {
        clientId: 'host-live',
        role: 'HOST',
        x: 0.4,
        y: 0.5,
        updatedAt: 4900,
      },
      {
        clientId: 'guest-active',
        role: 'GUEST',
        x: 0.7,
        y: 0.8,
        updatedAt: 5000,
      },
    ]);
  });
});

describe('shouldSendCursorPresence', () => {
  it('rejects raw cursor moves while always preserving source-backed samples', () => {
    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000,
      lastSentAtMs: 0,
    })).toBe(false);

    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000 + ROOM_CURSOR_SEND_INTERVAL_MS - 1,
      lastSentAtMs: 1000,
    })).toBe(false);

    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000 + ROOM_CURSOR_SEND_INTERVAL_MS,
      lastSentAtMs: 1000,
    })).toBe(false);

    expect(shouldSendCursorPresence({
      hasEvidence: true,
      nowMs: 1001,
      lastSentAtMs: 1000,
    })).toBe(true);
  });
});

describe('hasSourceBackedCursorEvidence', () => {
  const sourceBackedCursor: RoomCursorPresence = {
    clientId: 'guest-client',
    role: 'GUEST',
    x: 0.42,
    y: 0.61,
    updatedAt: 1761592321000,
    evidence: {
      source: 'win95_cursor_presence_client_sample',
      cursorEventSource: 'browser_win95_desktop_pointermove',
      actor: 'guest',
      cursorSampleId: 'cursor:guest:1761592321000:420:610',
      sampledAtMs: 1761592321000,
      surface: 'win95',
      roomPhase: 'connected',
      normalizedX: 0.42,
      normalizedY: 0.61,
      previousNormalizedX: null,
      previousNormalizedY: null,
      distanceFromPrevious: null,
      evidenceSampling: 'presence_sample',
      sampleIntervalMs: 15000,
      movementThreshold: 0.03,
      rawCursorMovesPersisted: false,
    },
  };

  it('accepts cursor presence only when the Win95 browser sample evidence matches the payload', () => {
    expect(hasSourceBackedCursorEvidence(sourceBackedCursor, 'GUEST')).toBe(true);
  });

  it('rejects raw cursor presence before it can be sent or rendered', () => {
    expect(hasSourceBackedCursorEvidence({
      ...sourceBackedCursor,
      evidence: undefined,
    }, 'GUEST')).toBe(false);
  });

  it('rejects cursor samples attributed to the wrong room actor', () => {
    expect(hasSourceBackedCursorEvidence(sourceBackedCursor, 'HOST')).toBe(false);
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
  const sourceBackedMediaControl: RoomMediaControlEvent = {
    id: 'media-control-1',
    clientId: 'guest-client',
    createdAt: 1700000001000,
    role: 'GUEST',
    control: 'microphone',
    previousEnabled: true,
    enabled: false,
    evidence: {
      source: 'video_room_media_controls',
      mediaControlEventSource: 'browser_video_control_button',
      actor: 'guest',
      mediaControlId: 'media:guest:microphone:1700000001000:disabled',
      capturedAtMs: 1700000001000,
      control: 'microphone',
      previousEnabled: true,
      enabled: false,
      action: 'disabled',
      surface: 'win95',
      roomPhase: 'connected',
      controlSurface: 'win95_video_window',
      controlAction: 'toggle',
      mediaSource: 'local_media_stream',
      rawMediaStreamPersisted: false,
    },
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

  it('rejects media-control updates attributed to the wrong room actor', () => {
    expect(hasSourceBackedMediaControlEvidence(sourceBackedMediaControl, 'HOST')).toBe(false);
  });
});

describe('hasSourceBackedRecordingStateEvidence', () => {
  const sourceBackedRecordingStart: RoomRecordingStateEvent = {
    id: 'recording-state-1',
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
      surface: 'win95',
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

  it('rejects vague failed recording state without concrete failure provenance', () => {
    expect(hasSourceBackedRecordingStateEvidence({
      ...sourceBackedRecordingStart,
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
        chatEventSource: 'browser_room_chat_window',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        deliveryStatus: 'pending',
        surface: 'win95',
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
        chatEventSource: 'browser_room_chat_window',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        deliveryStatus: 'accepted',
        surface: 'win95',
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
        chatEventSource: 'browser_room_chat_window',
        actor: 'host',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        deliveryStatus: 'accepted',
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

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
        chatEventSource: 'browser_room_chat_window',
        deliveryStatus: 'pending',
        surface: 'win95',
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
        chatEventSource: 'browser_room_chat_window',
        deliveryStatus: 'pending',
        surface: 'win95',
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
      },
    ]);
  });
});

describe('hasSourceBackedRoomFileSystemEvidence', () => {
  const sourceBackedUpsert: RoomFileSystemEvent = {
    id: 'fs-save-notes',
    clientId: 'host-client',
    createdAt: 4,
    kind: 'UPSERT_FILE',
    file: {
      id: 'desktop-notes',
      name: 'notes.txt',
      kind: 'text',
      content: 'Candidate asked about testing strategy.',
      mimeType: 'text/plain',
      createdAt: 4,
      updatedAt: 4,
      updatedBy: 'HOST',
    },
    evidence: {
      source: 'win95_shared_file_system',
      fileEventSource: 'browser_client_submit',
      fileChangeId: 'file:host:4:upsert:desktop-notes',
      actor: 'host',
      operation: 'upsert',
      fileId: 'desktop-notes',
      fileName: 'notes.txt',
      fileKind: 'text',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 4,
      durableObjectReplayExpected: true,
    },
  };

  it('accepts Win95 file mutations only when browser evidence matches the event and actor', () => {
    expect(hasSourceBackedRoomFileSystemEvidence(sourceBackedUpsert, 'HOST')).toBe(true);
  });

  it('rejects source-less file mutations before optimistic local state can change', () => {
    expect(hasSourceBackedRoomFileSystemEvidence({
      ...sourceBackedUpsert,
      evidence: undefined,
    }, 'HOST')).toBe(false);
  });

  it('rejects file mutations attributed to the wrong room actor', () => {
    expect(hasSourceBackedRoomFileSystemEvidence(sourceBackedUpsert, 'GUEST')).toBe(false);
  });
});

describe('hasSourceBackedTerminalEvidence', () => {
  const sourceBackedCommand: RoomTerminalEvent = {
    id: 'terminal-command-1',
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
      surface: 'win95',
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
});

describe('hasSourceBackedCodeServerFileEvidence', () => {
  const sourceBackedSave: RoomCodeServerFileEvent = {
    id: 'code-file-save-1',
    clientId: 'guest-client',
    createdAt: 1700000003000,
    eventType: 'code_editor_save',
    actor: 'system',
    text: 'src/app.ts',
    evidence: {
      source: 'code_server_workspace',
      observedBy: 'clippy_agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      action: 'modified',
      surface: 'win95',
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

  it('accepts code-server saves only when Clippy bridge workspace evidence matches the event', () => {
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
});
