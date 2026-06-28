import { describe, expect, it } from 'vitest';
import {
  applyRoomChatRejection,
  applyRoomMediaControlEvent,
  applyRoomRecordingStateEvent,
  decideRoomSurfaceSnapshot,
  hasSourceBackedRoomFileSystemEvidence,
  mergePeerCursorPresence,
  mergeRoomChatMessage,
  ROOM_CURSOR_SEND_INTERVAL_MS,
  shouldSendCursorPresence,
  type RoomChatMessage,
  type RoomCursorPresence,
  type RoomFileSystemEvent,
  type RoomMediaControlState,
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
  it('rate-limits raw cursor moves while always preserving source-backed samples', () => {
    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000,
      lastSentAtMs: 0,
    })).toBe(true);

    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000 + ROOM_CURSOR_SEND_INTERVAL_MS - 1,
      lastSentAtMs: 1000,
    })).toBe(false);

    expect(shouldSendCursorPresence({
      hasEvidence: false,
      nowMs: 1000 + ROOM_CURSOR_SEND_INTERVAL_MS,
      lastSentAtMs: 1000,
    })).toBe(true);

    expect(shouldSendCursorPresence({
      hasEvidence: true,
      nowMs: 1001,
      lastSentAtMs: 1000,
    })).toBe(true);
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

describe('mergeRoomChatMessage', () => {
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
