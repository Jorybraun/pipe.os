import { describe, expect, it } from 'vitest';
import {
  applyRoomChatRejection,
  applyRoomMediaControlEvent,
  applyRoomRecordingStateEvent,
  decideRoomSurfaceSnapshot,
  hasSourceBackedCodeServerFileEvidence,
  hasSourceBackedCursorEvidence,
  hasSourceBackedChatEvidence,
  hasSourceBackedClippyInteractionEvidence,
  hasSourceBackedClippyPromptEvidence,
  hasSourceBackedDesktopEventEvidence,
  hasSourceBackedMediaControlEvidence,
  hasSourceBackedMediaControlStateEvidence,
  hasSourceBackedRecordingStateEvidence,
  hasSourceBackedRecordingStateSnapshotEvidence,
  hasSourceBackedRoomFileSnapshotEvidence,
  hasSourceBackedRoomFileSystemEvidence,
  hasSourceBackedTerminalEvidence,
  mergePeerCursorPresence,
  mergeRoomChatMessage,
  ROOM_CURSOR_SEND_INTERVAL_MS,
  shouldSendCursorPresence,
  type RoomChatMessage,
  type RoomClippyInteractionEvent,
  type RoomClippyPrompt,
  type RoomCodeServerFileEvent,
  type RoomCursorPresence,
  type RoomDesktopEvent,
  type RoomFile,
  type RoomFileSystemEvent,
  type RoomMediaControlEvent,
  type RoomMediaControlState,
  type RoomRecordingState,
  type RoomRecordingStateEvent,
  type RoomTerminalEvent,
} from './useRoomConnection';
import { roomChatMessageFingerprint } from '../lib/chatEvidence';

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

describe('hasSourceBackedClippyPromptEvidence', () => {
  const prompt: RoomClippyPrompt = {
    id: 'prompt-1',
    clientId: 'host-client',
    createdAt: 1700000001000,
    source: 'system',
    text: 'Would you like to start recording?',
    promptEventSource: 'browser_proactive_clippy_prompt',
    promptTrigger: 'recording_start_suggestion',
    surface: 'win95',
    roomPhase: 'connected',
    workspaceStatus: 'running',
    workspaceSessionId: 'workspace-1',
    agentResponseClaimed: false,
  };

  it('accepts host-authored proactive Clippy prompts with room provenance', () => {
    expect(hasSourceBackedClippyPromptEvidence(prompt, 'HOST')).toBe(true);
  });

  it('rejects guest-authored or source-thin Clippy prompts', () => {
    expect(hasSourceBackedClippyPromptEvidence(prompt, 'GUEST')).toBe(false);
    expect(hasSourceBackedClippyPromptEvidence({
      ...prompt,
      promptEventSource: undefined,
    }, 'HOST')).toBe(false);
  });
});

describe('hasSourceBackedClippyInteractionEvidence', () => {
  it('accepts source-backed user chat submitted to the real Clippy/Devin bridge', () => {
    const text = 'Can you inspect the task?';
    const event: RoomClippyInteractionEvent = {
      id: 'clippy-interaction-1',
      clientId: 'guest-client',
      createdAt: 1700000002000,
      eventType: 'ai_chat_user',
      actor: 'guest',
      text,
      evidence: {
        source: 'clippy_agent_chat_client_submit',
        agentChatEventSource: 'browser_clippy_chat_window',
        actor: 'guest',
        bridgeMessageType: 'CHAT',
        bridgeProtocol: 'clippy_dev_container_ws',
        bridgeDeliveryStatus: 'queued',
        promptId: 'workspace-1:guest:prompt:1700000002000:clippy_0123abcd',
        promptFingerprint: 'clippy_0123abcd',
        promptLength: text.length,
        promptTimestamp: 1700000002000,
        browserQueuedBridgeMessage: true,
        bridgeDeliveryConfirmed: false,
        deliveredToAgentBridge: false,
        agent: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        repoUrl: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedClippyInteractionEvidence(event, 'GUEST')).toBe(true);
    expect(hasSourceBackedClippyInteractionEvidence(event, 'HOST')).toBe(false);
  });

  it('accepts real agent response evidence without fabricating a local Devin reply', () => {
    const text = 'I found the repository task context.';
    const event: RoomClippyInteractionEvent = {
      id: 'clippy-interaction-2',
      clientId: 'host-client',
      createdAt: 1700000003000,
      eventType: 'ai_chat_agent',
      actor: 'agent',
      text,
      evidence: {
        source: 'clippy_agent_bridge',
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
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        messageTimestamp: 1700000003000,
        agentResponseClaimed: true,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedClippyInteractionEvidence(event, 'HOST')).toBe(true);
  });

  it('accepts source-backed Clippy UI actions and rejects source-less events', () => {
    const action: RoomClippyInteractionEvent = {
      id: 'clippy-interaction-3',
      clientId: 'host-client',
      createdAt: 1700000004000,
      eventType: 'clippy_action',
      actor: 'host',
      text: 'Clippy chat opened from the Win95 taskbar tray',
      evidence: {
        source: 'clippy_tray_ui',
        actionId: 'open-clippy-chat',
        origin: 'tray',
        executedBy: 'host',
        actionSource: 'win95_taskbar_tray',
        executionStatus: 'opened',
        capturedAtMs: 1700000004000,
        clippyActionEventId: 'clippy-action:host:1700000004000:clippy_tray_ui:tray:opened:open-clippy-chat',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'running',
        workspaceSessionId: 'workspace-1',
        agent: null,
        agentResponseClaimed: false,
        durableObjectReplayExpected: true,
      },
    };

    expect(hasSourceBackedClippyInteractionEvidence(action, 'HOST')).toBe(true);
    expect(hasSourceBackedClippyInteractionEvidence({
      ...action,
      evidence: {
        source: 'clippy_tray_ui',
      },
    }, 'HOST')).toBe(false);
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
  const openWindowEvent: RoomDesktopEvent = {
    id: 'open-window-1',
    clientId: 'guest-client',
    createdAt: 1700000003500,
    kind: 'OPEN_WINDOW',
    window: {
      id: 'chat',
      windowType: 'chat',
      title: 'Room Chat',
    },
    evidence: {
      source: 'window_lifecycle_client_submit',
      lifecycleSource: 'win95_desktop_ui',
      lifecycleKind: 'open',
      actor: 'guest',
      windowId: 'chat',
      windowType: 'chat',
      windowTitle: 'Room Chat',
      windowLifecycleId: 'window-lifecycle:guest:1700000003500:open:chat',
      capturedAtMs: 1700000003500,
      surface: 'win95',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    },
  };
  const closeWindowEvent: RoomDesktopEvent = {
    id: 'close-window-1',
    clientId: 'guest-client',
    createdAt: 1700000003600,
    kind: 'CLOSE_WINDOW',
    windowId: 'chat',
    evidence: {
      source: 'window_lifecycle_client_submit',
      lifecycleSource: 'win95_window_chrome',
      lifecycleKind: 'close',
      actor: 'guest',
      windowId: 'chat',
      windowType: 'chat',
      windowTitle: 'Room Chat',
      windowLifecycleId: 'window-lifecycle:guest:1700000003600:close:chat',
      capturedAtMs: 1700000003600,
      surface: 'win95',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    },
  };
  const windowDataEvent: RoomDesktopEvent = {
    id: 'window-data-event-1',
    clientId: 'guest-client',
    createdAt: 1700000004000,
    kind: 'UPDATE_WINDOW_DATA',
    windowId: 'notepad',
    data: { text: 'Candidate writes a replay test plan.' },
    evidence: {
      source: 'window_data_client_submit',
      dataSource: 'win95_window_data_sync',
      actor: 'guest',
      windowId: 'notepad',
      action: 'edit_text',
      windowDataUpdateId: 'window-data:guest:1700000004000:notepad:edit_text',
      capturedAtMs: 1700000004000,
      surface: 'win95',
      roomPhase: 'connected',
      dataKeys: ['text'],
      dataValueFingerprints: { text: 'data_81a94acf' },
      durableObjectReplayExpected: true,
    },
  };
  const browserNavigationEvent: RoomDesktopEvent = {
    id: 'browser-navigation-event-1',
    clientId: 'host-client',
    createdAt: 1700000005000,
    kind: 'UPDATE_WINDOW_DATA',
    windowId: 'browser',
    data: { currentUrl: 'https://example.com/review?step=1' },
    evidence: {
      source: 'room_browser_window',
      navigationSource: 'browser_window_client_submit',
      actor: 'host',
      windowId: 'browser',
      navigationTrigger: 'go_button',
      browserNavigationId: 'browser-navigation:host:1700000005000:browser:go_button:nav_54d2c495',
      capturedAtMs: 1700000005000,
      urlFingerprint: 'nav_54d2c495',
      url: 'https://example.com/review?step=1',
      surface: 'win95',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    },
  };
  const windowStateEvent: RoomDesktopEvent = {
    id: 'window-state-event-1',
    clientId: 'guest-client',
    createdAt: 1700000006000,
    kind: 'UPDATE_WINDOW_STATE',
    windowId: 'workspace',
    x: 120,
    y: 80,
    evidence: {
      source: 'window_state_client_submit',
      stateSource: 'win95_window_chrome',
      actor: 'guest',
      windowId: 'workspace',
      action: 'move',
      windowStateChangeId: 'window-state:guest:1700000006000:workspace:move',
      capturedAtMs: 1700000006000,
      surface: 'win95',
      roomPhase: 'connected',
      statePatch: { x: 120, y: 80 },
      stateKeys: ['x', 'y'],
      durableObjectReplayExpected: true,
    },
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

  it('rejects room surface evidence unless the timestamp and phase are deterministic', () => {
    expect(hasSourceBackedDesktopEventEvidence({
      ...surfaceEvent,
      capturedAtMs: 1700000001000.5,
      surfaceChangeId: 'surface:host:1700000001000.5:standard:win95',
    }, 'HOST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...surfaceEvent,
      roomPhase: 'hydrating' as never,
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

  it('accepts window lifecycle events only when evidence reconstructs the exact open or close event', () => {
    expect(hasSourceBackedDesktopEventEvidence(openWindowEvent, 'GUEST')).toBe(true);
    expect(hasSourceBackedDesktopEventEvidence(closeWindowEvent, 'GUEST')).toBe(true);
    expect(hasSourceBackedDesktopEventEvidence({
      ...openWindowEvent,
      window: {
        ...openWindowEvent.window,
        title: 'Chat',
      },
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...openWindowEvent,
      evidence: {
        ...openWindowEvent.evidence!,
        windowLifecycleId: 'window-lifecycle:guest:1700000003500:close:chat',
      },
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...closeWindowEvent,
      evidence: {
        ...closeWindowEvent.evidence!,
        lifecycleKind: 'open',
      },
    }, 'GUEST')).toBe(false);
  });

  it('accepts workspace state only when the observer event id and session provenance match', () => {
    expect(hasSourceBackedDesktopEventEvidence(workspaceEvent, 'HOST')).toBe(true);
  });

  it('accepts window data updates only when evidence reconstructs from the exact shared data patch', () => {
    expect(hasSourceBackedDesktopEventEvidence(windowDataEvent, 'GUEST')).toBe(true);
    expect(hasSourceBackedDesktopEventEvidence({
      ...windowDataEvent,
      data: { text: 'Candidate writes a replay test plan!' },
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...windowDataEvent,
      evidence: {
        ...windowDataEvent.evidence!,
        dataKeys: ['strokes'],
      },
    }, 'GUEST')).toBe(false);
  });

  it('accepts browser navigation updates only when URL evidence matches the shared browser URL', () => {
    expect(hasSourceBackedDesktopEventEvidence(browserNavigationEvent, 'HOST')).toBe(true);
    expect(hasSourceBackedDesktopEventEvidence({
      ...browserNavigationEvent,
      data: { currentUrl: 'https://example.com/review?step=2' },
    }, 'HOST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...browserNavigationEvent,
      evidence: {
        ...browserNavigationEvent.evidence!,
        browserNavigationId: 'browser-navigation:host:1700000005000:browser:reload_button:nav_54d2c495',
      },
    }, 'HOST')).toBe(false);
  });

  it('accepts window state updates only when evidence reconstructs from the exact shared state patch', () => {
    expect(hasSourceBackedDesktopEventEvidence(windowStateEvent, 'GUEST')).toBe(true);
    expect(hasSourceBackedDesktopEventEvidence({
      ...windowStateEvent,
      x: 121,
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...windowStateEvent,
      evidence: {
        ...windowStateEvent.evidence!,
        statePatch: { x: 120, y: 80, width: 640 },
        stateKeys: ['width', 'x', 'y'],
      },
    }, 'GUEST')).toBe(false);
    expect(hasSourceBackedDesktopEventEvidence({
      ...windowStateEvent,
      evidence: {
        ...windowStateEvent.evidence!,
        action: 'resize',
        windowStateChangeId: 'window-state:guest:1700000006000:workspace:resize',
      },
    }, 'GUEST')).toBe(false);
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
    surface: 'win95',
    roomPhase: 'connected',
    controlSurface: 'win95_video_window',
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
        chatEventSource: 'browser_room_chat_window',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint(text),
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
        messageFingerprint: roomChatMessageFingerprint(text),
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
        messageFingerprint: roomChatMessageFingerprint(text),
        deliveryStatus: 'accepted',
        surface: 'win95',
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
        chatEventSource: 'browser_room_chat_window',
        actor: 'host',
        roomMessageId: 'chat-1',
        clientId: 'host-client',
        messageCreatedAt: 1000,
        messageLength: text.length,
        messageFingerprint: roomChatMessageFingerprint('Can we see those?'),
        deliveryStatus: 'accepted',
        surface: 'win95',
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
        evidence: {
          source: 'video_room_media_controls',
        },
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
      mimeType: 'text/plain',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 4,
      durableObjectReplayExpected: true,
      action: 'upsert',
      contentLength: 'Candidate asked about testing strategy.'.length,
      contentHash: 'content_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      contentExactText: 'Candidate asked about testing strategy.',
      fileCreatedAt: 4,
      fileUpdatedAt: 4,
    },
  };
  const sourceBackedDelete: RoomFileSystemEvent = {
    id: 'fs-delete-notes',
    clientId: 'host-client',
    createdAt: 5,
    kind: 'DELETE_FILE',
    fileId: 'desktop-notes',
    file: sourceBackedUpsert.file,
    evidence: {
      source: 'win95_shared_file_system',
      fileEventSource: 'browser_client_submit',
      fileChangeId: 'file:host:5:delete:desktop-notes',
      actor: 'host',
      operation: 'delete',
      fileId: 'desktop-notes',
      fileName: 'notes.txt',
      fileKind: 'text',
      mimeType: 'text/plain',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 5,
      durableObjectReplayExpected: true,
      action: 'delete',
      deletedContentLength: 'Candidate asked about testing strategy.'.length,
      deletedContentHash: 'content_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deletedContentExactText: 'Candidate asked about testing strategy.',
      deletedFileCreatedAt: 4,
      deletedFileUpdatedAt: 4,
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

  it('rejects file mutations when exact saved content evidence is missing or stale', () => {
    expect(hasSourceBackedRoomFileSystemEvidence({
      ...sourceBackedUpsert,
      evidence: {
        ...sourceBackedUpsert.evidence!,
        contentExactText: undefined,
      },
    }, 'HOST')).toBe(false);
    expect(hasSourceBackedRoomFileSystemEvidence({
      ...sourceBackedUpsert,
      evidence: {
        ...sourceBackedUpsert.evidence!,
        contentExactText: 'Candidate asked about testing strategy!',
      },
    }, 'HOST')).toBe(false);
  });

  it('accepts file deletes only when the deleted file content is carried as exact evidence', () => {
    expect(hasSourceBackedRoomFileSystemEvidence(sourceBackedDelete, 'HOST')).toBe(true);
    expect(hasSourceBackedRoomFileSystemEvidence({
      ...sourceBackedDelete,
      file: undefined,
    }, 'HOST')).toBe(false);
    expect(hasSourceBackedRoomFileSystemEvidence({
      ...sourceBackedDelete,
      evidence: {
        ...sourceBackedDelete.evidence!,
        deletedContentExactText: 'Candidate asked about testing strategy!',
      },
    }, 'HOST')).toBe(false);
  });

  it('accepts file snapshots only when metadata carries source-backed upsert projection evidence', () => {
    const file: RoomFile = {
      ...sourceBackedUpsert.file,
      metadata: {
        roomFileProjectionEvidence: {
          ...sourceBackedUpsert.evidence,
        },
      },
    };

    expect(hasSourceBackedRoomFileSnapshotEvidence(file)).toBe(true);
  });

  it('rejects source-thin or content-mismatched file snapshot projections', () => {
    const sourceThinFile: RoomFile = {
      ...sourceBackedUpsert.file,
    };
    const contentMismatchedFile: RoomFile = {
      ...sourceBackedUpsert.file,
      content: 'Different content should not hydrate.',
      metadata: {
        roomFileProjectionEvidence: {
          ...sourceBackedUpsert.evidence,
        },
      },
    };
    const exactContentMismatchedFile: RoomFile = {
      ...sourceBackedUpsert.file,
      content: 'Candidate asked about testing strategy!',
      metadata: {
        roomFileProjectionEvidence: {
          ...sourceBackedUpsert.evidence,
        },
      },
    };

    expect(hasSourceBackedRoomFileSnapshotEvidence(sourceThinFile)).toBe(false);
    expect(hasSourceBackedRoomFileSnapshotEvidence(contentMismatchedFile)).toBe(false);
    expect(hasSourceBackedRoomFileSnapshotEvidence(exactContentMismatchedFile)).toBe(false);
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
        surface: 'win95',
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
      observedBy: 'clippy_agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      codeServerFileChangeId: 'code-server-file:workspace-session-1:1782561600000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
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

  it('rejects code-server file events whose event id does not match the source-backed file change id', () => {
    expect(hasSourceBackedCodeServerFileEvidence({
      ...sourceBackedSave,
      id: 'code-file-random-transport-id',
    })).toBe(false);
  });
});
