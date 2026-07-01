import { describe, expect, it, vi } from 'vitest';
import { VideoRoom } from '../VideoRoom';

type Role = 'HOST' | 'GUEST';
const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

class FakeSocket {
  sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }
}

function makeState(entries: Array<[FakeSocket, Role]>): {
  state: DurableObjectState;
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
  const sockets = entries.map(([socket]) => socket as unknown as WebSocket);
  const roles = new Map<WebSocket, Role>(
    entries.map(([socket, role]) => [socket as unknown as WebSocket, role]),
  );

  const state = {
    blockConcurrencyWhile: (callback: () => Promise<void>) => {
      void callback();
    },
    getWebSockets: (tag?: string) => sockets.filter((socket) => (
      tag ? roles.get(socket) === tag : true
    )),
    getTags: (socket: WebSocket) => {
      const role = roles.get(socket);
      return role ? [role] : [];
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
      deleteAll: vi.fn(async () => {
        storage.clear();
      }),
      setAlarm: vi.fn(async (timestamp: number) => {
        storage.set('alarm', timestamp);
      }),
    },
  } as unknown as DurableObjectState;

  return { state, storage };
}

function parseSent(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
}

function roomChatMessageFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `chat_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

describe('VideoRoom Durable Object signaling lifecycle', () => {
  it('keeps offers and calling status across transient host socket closes', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'OFFER',
      payload: { type: 'offer', sdp: 'host-offer' },
    }));
    guest.sent = [];

    await room.webSocketClose(host as unknown as WebSocket, 1006, 'network lost');

    expect(storage.get('status')).toBe('CALLING');
    expect(storage.get('lastOffer')).toEqual(expect.any(String));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'PEER_DISCONNECTED',
      role: 'HOST',
    }));
  });

  it('does not notify peers or mutate state for stale socket replacement closes', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'OFFER',
      payload: { type: 'offer', sdp: 'host-offer' },
    }));
    guest.sent = [];

    await room.webSocketClose(host as unknown as WebSocket, 1000, 'Replaced by new connection');

    expect(storage.get('status')).toBe('CALLING');
    expect(storage.get('lastOffer')).toEqual(expect.any(String));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'PEER_DISCONNECTED',
    }));
  });

  it('only persists ENDED for explicit host hangup and treats guest LEFT as transient', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'OFFER',
      payload: { type: 'offer', sdp: 'host-offer' },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'STATUS_UPDATE',
      status: 'LEFT',
    }));

    expect(storage.get('status')).toBe('CALLING');
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'PEER_DISCONNECTED',
      role: 'GUEST',
    }));

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'HANGUP',
    }));

    expect(storage.get('status')).toBe('ENDED');
    expect(storage.get('endedByHost')).toBe(true);
    expect(storage.get('lastOffer')).toBeUndefined();
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'HANGUP',
      role: 'HOST',
    }));
  });

  it('stores and broadcasts room chat messages for participant replay', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CHAT_MESSAGE',
      payload: {
        id: 'chat-1',
        clientId: 'host-client',
        createdAt: 42,
        role: 'HOST',
        text: 'Can you see this message?',
        deliveryStatus: 'pending',
        evidence: {
          source: 'room_chat_client_submit',
          chatEventSource: 'browser_room_chat_panel',
          actor: 'host',
          surface: 'standard',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));

    const acceptedEvidence = {
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_panel',
      actor: 'host',
      roomMessageId: 'chat-1',
      clientId: 'host-client',
      messageCreatedAt: 42,
      messageLength: 'Can you see this message?'.length,
      messageFingerprint: roomChatMessageFingerprint('Can you see this message?'),
      deliveryStatus: 'accepted',
      surface: 'standard',
      roomPhase: 'connected',
      durableObjectReplayExpected: true,
    };

    expect(storage.get('chatMessages')).toEqual([
      {
        id: 'chat-1',
        clientId: 'host-client',
        createdAt: 42,
        role: 'HOST',
        text: 'Can you see this message?',
        deliveryStatus: 'accepted',
        evidence: acceptedEvidence,
      },
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'chat-1',
        role: 'HOST',
        text: 'Can you see this message?',
        deliveryStatus: 'accepted',
        evidence: acceptedEvidence,
      }),
    }));
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE_ACK',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'chat-1',
        role: 'HOST',
        text: 'Can you see this message?',
        deliveryStatus: 'accepted',
        evidence: acceptedEvidence,
      }),
    }));
    expect(storage.get('chatActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        message: expect.objectContaining({
          id: 'chat-1',
          text: 'Can you see this message?',
          deliveryStatus: 'accepted',
          evidence: acceptedEvidence,
        }),
      }),
    ]);
  });

  it('rejects room chat messages without browser source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CHAT_MESSAGE',
      payload: {
        id: 'chat-forged-evidence',
        clientId: 'host-client',
        createdAt: 42,
        role: 'HOST',
        text: 'This should not become evidence.',
        deliveryStatus: 'pending',
        evidence: {
          source: 'room_chat_claim',
          chatEventSource: 'manual_test_payload',
          actor: 'host',
          surface: 'standard',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(storage.get('chatMessages')).toBeUndefined();
    expect(storage.get('chatActivityLog')).toBeUndefined();
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE_REJECTED',
      reason: 'INVALID_EVIDENCE',
      payload: { clientMessageId: 'chat-forged-evidence' },
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE',
    }));
  });

  it('rejects invalid room chat messages with the client message id for reconciliation', async () => {
    const host = new FakeSocket();
    const { state, storage } = makeState([[host, 'HOST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CHAT_MESSAGE',
      payload: {
        id: 'chat-too-large',
        clientId: 'host-client',
        createdAt: 42,
        role: 'HOST',
        text: 'x'.repeat(2001),
      },
    }));

    expect(storage.get('chatMessages')).toBeUndefined();
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE_REJECTED',
      reason: 'INVALID_MESSAGE',
      payload: { clientMessageId: 'chat-too-large' },
    }));
  });

  it('stores and broadcasts source-backed media control state', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_MEDIA_CONTROL',
      payload: {
        id: 'media:host:microphone:1700000000000:disabled',
        clientId: 'host-client',
        createdAt: 1700000000000,
        role: 'HOST',
        control: 'microphone',
        previousEnabled: true,
        enabled: false,
        evidence: {
          source: 'video_room_media_controls',
          mediaControlEventSource: 'browser_video_control_button',
          actor: 'host',
          mediaControlId: 'media:host:microphone:1700000000000:disabled',
          capturedAtMs: 1700000000000,
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
        },
      },
    }));

    expect(storage.get('mediaControlStates')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        microphoneEnabled: false,
        updatedAt: 1700000000000,
        evidence: expect.objectContaining({
          source: 'video_room_media_controls',
          mediaControlEventSource: 'browser_video_control_button',
          mediaControlId: 'media:host:microphone:1700000000000:disabled',
          control: 'microphone',
          enabled: false,
        }),
      }),
    ]);
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL_ACK',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'media:host:microphone:1700000000000:disabled',
        control: 'microphone',
        enabled: false,
      }),
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'media:host:microphone:1700000000000:disabled',
        control: 'microphone',
        enabled: false,
        evidence: expect.objectContaining({
          source: 'video_room_media_controls',
          mediaControlId: 'media:host:microphone:1700000000000:disabled',
        }),
      }),
    }));
    expect(storage.get('mediaControlActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'media:host:microphone:1700000000000:disabled',
          evidence: expect.objectContaining({
            source: 'video_room_media_controls',
          }),
        }),
      }),
    ]);
  });

  it('rejects media control changes without browser source evidence', async () => {
    const guest = new FakeSocket();
    const { state, storage } = makeState([[guest, 'GUEST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_MEDIA_CONTROL',
      payload: {
        id: 'media-source-less',
        clientId: 'guest-client',
        createdAt: 1700000000000,
        role: 'GUEST',
        control: 'camera',
        previousEnabled: true,
        enabled: false,
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(storage.has('mediaControlStates')).toBe(false);
    expect(storage.has('mediaControlActivityLog')).toBe(false);
  });

  it('rejects media control changes when source evidence belongs to a different control event id', async () => {
    const guest = new FakeSocket();
    const { state, storage } = makeState([[guest, 'GUEST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_MEDIA_CONTROL',
      payload: {
        id: 'media:guest:camera:1700000000000:enabled',
        clientId: 'guest-client',
        createdAt: 1700000000000,
        role: 'GUEST',
        control: 'camera',
        previousEnabled: true,
        enabled: false,
        evidence: {
          source: 'video_room_media_controls',
          mediaControlEventSource: 'browser_video_control_button',
          actor: 'guest',
          mediaControlId: 'media:guest:camera:1700000000000:disabled',
          capturedAtMs: 1700000000000,
          control: 'camera',
          previousEnabled: true,
          enabled: false,
          action: 'disabled',
          surface: 'standard',
          roomPhase: 'connected',
          controlSurface: 'standard_video_call',
          controlAction: 'toggle',
          mediaSource: 'local_media_stream',
          rawMediaStreamPersisted: false,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(storage.has('mediaControlStates')).toBe(false);
    expect(storage.has('mediaControlActivityLog')).toBe(false);
  });

  it('stores and broadcasts source-backed host recording state', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_RECORDING_STATE',
      payload: {
        id: 'recording:host:1700000000500:start:recording',
        clientId: 'host-client',
        createdAt: 1700000000500,
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
          recordingStateEventId: 'recording:host:1700000000500:start:recording',
          capturedAtMs: 1700000000500,
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
      },
    }));

    expect(storage.get('roomRecordingState')).toEqual(expect.objectContaining({
      role: 'HOST',
      status: 'recording',
      active: true,
      updatedAt: 1700000000500,
      evidence: expect.objectContaining({
        recordingStateEventId: 'recording:host:1700000000500:start:recording',
      }),
    }));
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE_ACK',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'recording:host:1700000000500:start:recording',
        status: 'recording',
        active: true,
      }),
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'recording:host:1700000000500:start:recording',
        status: 'recording',
        evidence: expect.objectContaining({
          source: 'video_room_recording',
          recordingStateEventSource: 'browser_media_recorder_state_sync',
        }),
      }),
    }));
    expect(storage.get('recordingActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'recording:host:1700000000500:start:recording',
        }),
      }),
    ]);
  });

  it('stores failed recording state only when browser failure facts are present', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_RECORDING_STATE',
      payload: {
        id: 'recording:host:1700000000900:stop:failed',
        clientId: 'host-client',
        createdAt: 1700000000900,
        role: 'HOST',
        lifecycleKind: 'stop',
        status: 'failed',
        active: false,
        evidence: {
          source: 'video_room_recording',
          recordingEventSource: 'browser_media_recorder',
          recordingStateEventSource: 'browser_media_recorder_state_sync',
          actor: 'host',
          recordingLifecycleKind: 'stop',
          recordingStateEventId: 'recording:host:1700000000900:stop:failed',
          capturedAtMs: 1700000000900,
          surface: 'standard',
          roomPhase: 'connected',
          recordingStatus: 'failed',
          recordingActive: false,
          durableObjectReplayExpected: true,
          iceProvider: 'cloudflare',
          hasTranscriptionAudio: true,
          uploadStatus: 'failed',
          recordingFailureStage: 'upload_request',
          recordingFailureSource: 'recording_upload_exception',
          recordingFailureMessage: 'Request failed (500)',
          recordingBytes: 12345,
          recordingMimeType: 'video/webm',
          transcriptionBytes: 2345,
          transcriptionMimeType: 'audio/webm',
          speakerMetadataVersion: 1,
          speakerChannelLayout: 'host-local-guest-remote-v1',
          speakerChannelCount: 2,
          speakerChannels: [
            { channel: 0, role: 'host', source: 'local' },
            { channel: 1, role: 'guest', source: 'remote' },
          ],
        },
      },
    }));

    expect(storage.get('roomRecordingState')).toEqual(expect.objectContaining({
      role: 'HOST',
      status: 'failed',
      active: false,
      evidence: expect.objectContaining({
        uploadStatus: 'failed',
        recordingFailureStage: 'upload_request',
      }),
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'recording:host:1700000000900:stop:failed',
        status: 'failed',
        evidence: expect.objectContaining({
          recordingFailureSource: 'recording_upload_exception',
          recordingFailureMessage: 'Request failed (500)',
        }),
      }),
    }));
  });

  it('rejects recording state when source evidence belongs to a different recording event id', async () => {
    const host = new FakeSocket();
    const { state, storage } = makeState([[host, 'HOST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_RECORDING_STATE',
      payload: {
        id: 'recording:host:1700000000500:stop:saved',
        clientId: 'host-client',
        createdAt: 1700000000500,
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
          recordingStateEventId: 'recording:host:1700000000500:start:recording',
          capturedAtMs: 1700000000500,
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
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(storage.has('roomRecordingState')).toBe(false);
    expect(storage.has('recordingActivityLog')).toBe(false);
  });

  it('rejects vague failed recording state without storing evidence', async () => {
    const host = new FakeSocket();
    const { state, storage } = makeState([[host, 'HOST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_RECORDING_STATE',
      payload: {
        id: 'recording-state-vague-failed',
        clientId: 'host-client',
        createdAt: 1700000000900,
        role: 'HOST',
        lifecycleKind: 'stop',
        status: 'failed',
        active: false,
        evidence: {
          source: 'video_room_recording',
          recordingEventSource: 'browser_media_recorder',
          recordingStateEventSource: 'browser_media_recorder_state_sync',
          actor: 'host',
          recordingLifecycleKind: 'stop',
          recordingStateEventId: 'recording:host:1700000000900:stop:failed',
          capturedAtMs: 1700000000900,
          surface: 'standard',
          roomPhase: 'connected',
          recordingStatus: 'failed',
          recordingActive: false,
          durableObjectReplayExpected: true,
          iceProvider: 'cloudflare',
          hasTranscriptionAudio: false,
          speakerMetadataVersion: 1,
          speakerChannelLayout: 'host-local-guest-remote-v1',
          speakerChannelCount: 2,
          speakerChannels: [
            { channel: 0, role: 'host', source: 'local' },
            { channel: 1, role: 'guest', source: 'remote' },
          ],
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(storage.has('roomRecordingState')).toBe(false);
    expect(storage.has('recordingActivityLog')).toBe(false);
  });

  it('rejects guest recording state changes without storing evidence', async () => {
    const guest = new FakeSocket();
    const { state, storage } = makeState([[guest, 'GUEST']]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_RECORDING_STATE',
      payload: {
        id: 'recording-state-guest',
        clientId: 'guest-client',
        createdAt: 1700000000500,
        role: 'GUEST',
        lifecycleKind: 'start',
        status: 'recording',
        active: true,
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE_REJECTED',
      reason: 'ONLY_HOST_CAN_RECORD',
    }));
    expect(storage.has('roomRecordingState')).toBe(false);
    expect(storage.has('recordingActivityLog')).toBe(false);
  });

  it('broadcasts and records source-backed real agent interaction events', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-user-chat-1',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'agent_chat_client_submit',
          agentChatEventSource: 'browser_agent_chat_panel',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'agent_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:agent_0123abcd',
          promptFingerprint: 'agent_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          bridgeDeliveryStatus: 'queued',
          browserQueuedBridgeMessage: true,
          bridgeDeliveryConfirmed: false,
          agent: null,
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          agentResponseClaimed: false,
          actor: 'guest',
          durableObjectReplayExpected: true,
        },
      },
    }));

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-agent-status-1',
        clientId: 'guest-client',
        createdAt: 1782604000000,
        eventType: 'ai_agent_status',
        actor: 'agent',
        text: 'devin is ready.',
        evidence: {
          source: 'agent_bridge',
          agentStatusEventSource: 'browser_agent_ws',
          agent: 'devin',
          status: 'idle',
          diagnosticSource: null,
          bridgeMessageSource: 'agent_status',
          observedAt: '2026-06-27T20:00:00.000Z',
          capturedAtMs: 1782604000000,
          agentStatusEventId: 'agent-status:devin:1782604000000:agent_status:idle:none',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          messageTimestamp: 1782604000000,
          agentResponseClaimed: false,
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(host)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'ROOM_AGENT_INTERACTION',
        role: 'GUEST',
        payload: expect.objectContaining({
          eventType: 'ai_chat_user',
          actor: 'guest',
          text: 'Can you inspect the failing test?',
          evidence: expect.objectContaining({
            source: 'agent_chat_client_submit',
            promptId: 'workspace-session-1:guest:prompt:1782603900000:agent_0123abcd',
          }),
        }),
      }),
      expect.objectContaining({
        type: 'ROOM_AGENT_INTERACTION',
        role: 'GUEST',
        payload: expect.objectContaining({
          eventType: 'ai_agent_status',
          actor: 'agent',
          evidence: expect.objectContaining({
            source: 'agent_bridge',
            agentStatusEventId: 'agent-status:devin:1782604000000:agent_status:idle:none',
          }),
        }),
      }),
    ]));
    expect(storage.get('agentInteractionActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'agent-user-chat-1',
          eventType: 'ai_chat_user',
        }),
      }),
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'agent-agent-status-1',
          eventType: 'ai_agent_status',
        }),
      }),
    ]);
  });

  it('records blocked Agent prompts without claiming delivery to Devin', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);
    const promptText = 'Can you inspect this before the workspace starts?';

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-user-chat-blocked',
        clientId: 'guest-client',
        createdAt: 1782603950000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: promptText,
        evidence: {
          source: 'agent_chat_client_submit',
          agentChatEventSource: 'browser_agent_chat_panel',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'agent_dev_container_ws',
          bridgeDeliveryStatus: 'blocked',
          bridgeBlockedReason: 'workspace_required',
          promptId: 'none:guest:prompt:1782603950000:agent_89abcdef',
          promptFingerprint: 'agent_89abcdef',
          promptLength: promptText.length,
          promptTimestamp: 1782603950000,
          browserQueuedBridgeMessage: false,
          bridgeDeliveryConfirmed: false,
          agent: null,
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: null,
          workspaceSessionId: null,
          repoUrl: null,
          agentResponseClaimed: false,
          actor: 'guest',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION',
      role: 'GUEST',
      payload: expect.objectContaining({
        id: 'agent-user-chat-blocked',
        eventType: 'ai_chat_user',
        text: promptText,
        evidence: expect.objectContaining({
          bridgeDeliveryStatus: 'blocked',
          bridgeBlockedReason: 'workspace_required',
          browserQueuedBridgeMessage: false,
        }),
      }),
    }));
    expect(storage.get('agentInteractionActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'agent-user-chat-blocked',
          evidence: expect.objectContaining({
            bridgeDeliveryStatus: 'blocked',
            bridgeBlockedReason: 'workspace_required',
          }),
        }),
      }),
    ]);
  });

  it('redacts real agent bridge status diagnostics before broadcast and storage', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);
    const rawText = [
      'Auth failed with DEVIN_API_KEY=cog_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Bearer ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '/api/v1/meeting-rooms/live-room-token?token=raw-token',
    ].join(' ');

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-agent-status-redacted',
        clientId: 'guest-client',
        createdAt: 1782604100000,
        eventType: 'ai_agent_status',
        actor: 'agent',
        text: rawText,
        evidence: {
          source: 'agent_bridge',
          agentStatusEventSource: 'browser_agent_ws',
          agent: 'devin',
          status: 'auth_needed',
          diagnosticSource: 'agent_auth_check',
          bridgeMessageSource: 'bridge_diagnostic',
          observedAt: '2026-06-27T20:00:00.000Z',
          capturedAtMs: 1782604100000,
          agentStatusEventId: 'agent-status:devin:1782604100000:bridge_diagnostic:auth_needed:agent_auth_check',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          messageTimestamp: 1782604100000,
          agentResponseClaimed: false,
          durableObjectReplayExpected: true,
        },
      },
    }));

    const broadcast = parseSent(host).find((message) => (
      message.type === 'ROOM_AGENT_INTERACTION'
      && typeof message.payload === 'object'
      && message.payload !== null
      && 'id' in message.payload
      && message.payload.id === 'agent-agent-status-redacted'
    ));
    expect(broadcast).toMatchObject({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        text: 'Auth failed with DEVIN_API_KEY=[REDACTED_SECRET] Bearer [REDACTED_SECRET] /api/v1/meeting-rooms/[REDACTED_SECRET]',
      },
    });
    const log = storage.get('agentInteractionActivityLog');
    expect(log).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          id: 'agent-agent-status-redacted',
          text: 'Auth failed with DEVIN_API_KEY=[REDACTED_SECRET] Bearer [REDACTED_SECRET] /api/v1/meeting-rooms/[REDACTED_SECRET]',
        }),
      }),
    ]);
    expect(JSON.stringify(parseSent(host))).not.toContain('cog_aaaaaaaa');
    expect(JSON.stringify(log)).not.toContain('live-room-token');
    expect(JSON.stringify(log)).not.toContain('ghp_bbbbbbbb');
  });

  it('rejects real agent interaction events without source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-fake-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'This should not be saved.',
        evidence: {
          source: 'agent_chat',
          promptLength: 'This should not be saved.'.length,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION',
    }));
    expect(storage.has('agentInteractionActivityLog')).toBe(false);
  });

  it('rejects real agent output with malformed browser prompt refs', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-agent-chat-malformed-prompt-ref',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_agent',
        actor: 'agent',
        text: 'I inspected the failing test.',
        evidence: {
          source: 'agent_bridge',
          agent: 'devin',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_stdout',
          observedAt: '2026-06-27T21:05:00.000Z',
          capturedAtMs: 1782594300000,
          agentChatResponseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_314a13fc',
          responseFingerprint: 'agent_314a13fc',
          responseLength: 'I inspected the failing test.'.length,
          actionCount: 0,
          bridgePersisted: true,
          browserPromptId: 'source-less-prompt-ref',
          browserPromptFingerprint: 'agent_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 'Can you inspect the failing test?'.length,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION',
    }));
    expect(storage.has('agentInteractionActivityLog')).toBe(false);
  });

  it('rejects Agent user prompts that claim a Devin agent attribution', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-attributed-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'agent_chat_client_submit',
          agentChatEventSource: 'browser_agent_chat_panel',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'agent_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:agent_0123abcd',
          promptFingerprint: 'agent_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: 'devin',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          agentResponseClaimed: false,
          actor: 'guest',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION',
    }));
    expect(storage.has('agentInteractionActivityLog')).toBe(false);
  });

  it('rejects Agent user prompts that claim confirmed bridge delivery', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-delivered-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'agent_chat_client_submit',
          agentChatEventSource: 'browser_agent_chat_panel',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'agent_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:agent_0123abcd',
          promptFingerprint: 'agent_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: null,
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          agentResponseClaimed: false,
          actor: 'guest',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_AGENT_INTERACTION',
    }));
    expect(storage.has('agentInteractionActivityLog')).toBe(false);
  });

  it('broadcasts and records source-backed terminal command and output events', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
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
      },
    }));

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
        id: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
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
      },
    }));

    expect(parseSent(host)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'ROOM_TERMINAL_EVENT',
        role: 'GUEST',
        payload: expect.objectContaining({
          kind: 'COMMAND',
          text: 'npm test',
          evidence: expect.objectContaining({
            source: 'container_terminal',
            terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
          }),
        }),
      }),
      expect.objectContaining({
        type: 'ROOM_TERMINAL_EVENT',
        role: 'GUEST',
        payload: expect.objectContaining({
          kind: 'OUTPUT',
          text: 'PASS src/app.test.ts\n',
          evidence: expect.objectContaining({
            source: 'container_terminal',
            terminalOutputChunkId: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
          }),
        }),
      }),
    ]));
    expect(storage.get('terminalActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'terminal-workspace-session-1-guest:command:guest:1700000001000:1:terminal_dc5964d6',
          kind: 'COMMAND',
        }),
      }),
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'terminal-workspace-session-1-guest:output:system:1700000002000:1:terminal_4f2d0d8f',
          kind: 'OUTPUT',
        }),
      }),
    ]);
  });

  it('rejects terminal events without browser terminal source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
        id: 'terminal-source-less',
        clientId: 'guest-client',
        createdAt: 1700000001000,
        kind: 'COMMAND',
        text: 'npm test',
        evidence: {
          source: 'terminal_claim',
          terminalSessionId: 'terminal-workspace-session-1-guest',
          terminalCommandSequence: 1,
          commandLength: 8,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_TERMINAL_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_TERMINAL_EVENT',
    }));
    expect(storage.has('terminalActivityLog')).toBe(false);
  });

  it('rejects terminal events whose transport id does not match source-backed terminal evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
        id: 'terminal-random-transport-id',
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
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_TERMINAL_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_TERMINAL_EVENT',
    }));
    expect(storage.has('terminalActivityLog')).toBe(false);
  });

  it('broadcasts and records source-backed code-server file events', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
      payload: {
        id: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
        clientId: 'guest-client',
        createdAt: 1782604100000,
        eventType: 'code_editor_save',
        actor: 'system',
        text: 'src/app.ts',
        evidence: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          codeServerFileChangeId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
          action: 'modified',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          path: 'src/app.ts',
          observedAt: '2026-06-27T20:01:40.000Z',
          contentHash: 'a'.repeat(64),
          sizeBytes: 421,
          contentPreview: 'export const answer = 42;',
          bridgePersisted: false,
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        eventType: 'code_editor_save',
        actor: 'system',
        text: 'src/app.ts',
        evidence: expect.objectContaining({
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          contentHash: 'a'.repeat(64),
        }),
      }),
    }));
    expect(storage.get('codeServerFileActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
          eventType: 'code_editor_save',
          text: 'src/app.ts',
        }),
      }),
    ]);
  });

  it('rejects code-server file events whose transport id does not match source-backed file evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
      payload: {
        id: 'code-file-random-transport-id',
        clientId: 'guest-client',
        createdAt: 1782604100000,
        eventType: 'code_editor_save',
        actor: 'system',
        text: 'src/app.ts',
        evidence: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          codeServerFileChangeId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
          action: 'modified',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          path: 'src/app.ts',
          observedAt: '2026-06-27T20:01:40.000Z',
          contentHash: 'a'.repeat(64),
          sizeBytes: 421,
          contentPreview: 'export const answer = 42;',
          bridgePersisted: false,
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CODE_SERVER_FILE_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
    }));
    expect(storage.has('codeServerFileActivityLog')).toBe(false);
  });

  it('rejects code-server file events without source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
      payload: {
        id: 'code-file-fake',
        clientId: 'guest-client',
        createdAt: 1782604100000,
        eventType: 'code_editor_save',
        actor: 'system',
        text: 'src/app.ts',
        evidence: {
          source: 'editor_claim',
          path: 'src/app.ts',
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CODE_SERVER_FILE_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
    }));
    expect(storage.has('codeServerFileActivityLog')).toBe(false);
  });

  it('exposes replayable room activity logs for server-side evidence sync', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CHAT_MESSAGE',
      payload: {
        id: 'chat-guest-question',
        clientId: 'guest-client',
        createdAt: 2000,
        role: 'GUEST',
        text: 'I found the retry bug in the queue worker.',
        deliveryStatus: 'pending',
        evidence: {
          source: 'room_chat_client_submit',
          chatEventSource: 'browser_room_chat_panel',
          actor: 'guest',
          surface: 'standard',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_MEDIA_CONTROL',
      payload: {
        id: 'media:guest:camera:2200:disabled',
        clientId: 'guest-client',
        createdAt: 2200,
        role: 'GUEST',
        control: 'camera',
        previousEnabled: true,
        enabled: false,
        evidence: {
          source: 'video_room_media_controls',
          mediaControlEventSource: 'browser_video_control_button',
          actor: 'guest',
          mediaControlId: 'media:guest:camera:2200:disabled',
          capturedAtMs: 2200,
          control: 'camera',
          previousEnabled: true,
          enabled: false,
          action: 'disabled',
          surface: 'standard',
          roomPhase: 'connected',
          controlSurface: 'standard_video_call',
          controlAction: 'toggle',
          mediaSource: 'local_media_stream',
          rawMediaStreamPersisted: false,
        },
      },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_AGENT_INTERACTION',
      payload: {
        id: 'agent-user-chat-activity',
        clientId: 'guest-client',
        createdAt: 2400,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'agent_chat_client_submit',
          agentChatEventSource: 'browser_agent_chat_panel',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'agent_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:2400:agent_0123abcd',
          promptFingerprint: 'agent_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 2400,
          browserQueuedBridgeMessage: true,
          bridgeDeliveryConfirmed: false,
          agent: null,
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          agentResponseClaimed: false,
          actor: 'guest',
          durableObjectReplayExpected: true,
        },
      },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CODE_SERVER_FILE_EVENT',
      payload: {
        id: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
        clientId: 'guest-client',
        createdAt: 2450,
        eventType: 'code_editor_save',
        actor: 'system',
        text: 'src/app.ts',
        evidence: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          codeServerFileChangeId: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
          action: 'modified',
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          path: 'src/app.ts',
          observedAt: '2026-06-27T20:01:40.000Z',
          contentHash: 'a'.repeat(64),
          sizeBytes: 421,
          contentPreview: 'export const answer = 42;',
          bridgePersisted: false,
          durableObjectReplayExpected: true,
        },
      },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
        id: 'terminal-workspace-session-1-guest:command:guest:2500:1:terminal_dc5964d6',
        clientId: 'guest-client',
        createdAt: 2500,
        kind: 'COMMAND',
        text: 'npm test',
        evidence: {
          source: 'container_terminal',
          terminalEventSource: 'browser_terminal_ws',
          terminalSessionId: 'terminal-workspace-session-1-guest',
          terminalCommandId: 'terminal-workspace-session-1-guest:command:guest:2500:1:terminal_dc5964d6',
          terminalCommandSequence: 1,
          actor: 'guest',
          capturedAtMs: 2500,
          commandFingerprint: 'terminal_dc5964d6',
          commandLength: 8,
          surface: 'standard',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          durableObjectReplayExpected: true,
        },
      },
    }));
    const response = await room.fetch(new Request('https://do/activity-log'));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      chatActivityLog: unknown[];
      mediaControlActivityLog: unknown[];
      agentInteractionActivityLog: unknown[];
      codeServerFileActivityLog: unknown[];
      terminalActivityLog: unknown[];
    };

    expect(body.chatActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        message: expect.objectContaining({
          id: 'chat-guest-question',
          text: 'I found the retry bug in the queue worker.',
          deliveryStatus: 'accepted',
          evidence: expect.objectContaining({
            source: 'room_chat_client_submit',
            chatEventSource: 'browser_room_chat_panel',
            actor: 'guest',
            roomMessageId: 'chat-guest-question',
            clientId: 'guest-client',
            deliveryStatus: 'accepted',
            surface: 'standard',
            roomPhase: 'connected',
          }),
        }),
      }),
    ]);
    expect(body.mediaControlActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'media:guest:camera:2200:disabled',
          control: 'camera',
          enabled: false,
          evidence: expect.objectContaining({
            source: 'video_room_media_controls',
            mediaControlId: 'media:guest:camera:2200:disabled',
          }),
        }),
      }),
    ]);
    expect(body.agentInteractionActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'agent-user-chat-activity',
          eventType: 'ai_chat_user',
          text: 'Can you inspect the failing test?',
          evidence: expect.objectContaining({
            source: 'agent_chat_client_submit',
            agentChatEventSource: 'browser_agent_chat_panel',
          }),
        }),
      }),
    ]);
    expect(body.codeServerFileActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'code-server-file:workspace-session-1:1782590500000:modified:path_cb48a478:aaaaaaaaaaaaaaaa',
          eventType: 'code_editor_save',
          text: 'src/app.ts',
          evidence: expect.objectContaining({
            source: 'code_server_workspace',
            observedBy: 'agent_bridge',
          }),
        }),
      }),
    ]);
    expect(body.terminalActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'terminal-workspace-session-1-guest:command:guest:2500:1:terminal_dc5964d6',
          kind: 'COMMAND',
          text: 'npm test',
          evidence: expect.objectContaining({
            source: 'container_terminal',
            terminalEventSource: 'browser_terminal_ws',
          }),
        }),
      }),
    ]);
  });
});
