import { describe, expect, it, vi } from 'vitest';
import { VideoRoom } from '../VideoRoom';

type Role = 'HOST' | 'GUEST';

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

  it('stores and broadcasts shared desktop window events', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-open-browser',
        clientId: 'host-client',
        createdAt: 1,
        kind: 'OPEN_WINDOW',
        window: {
          id: 'browser',
          windowType: 'browser',
          title: 'Microsoft Edge',
          x: 100,
          y: 60,
          width: 800,
          height: 560,
          data: { currentUrl: 'https://example.com' },
        },
      },
    }));

    expect(storage.get('desktopWindows')).toEqual([
      expect.objectContaining({
        id: 'browser',
        windowType: 'browser',
        title: 'Microsoft Edge',
        data: { currentUrl: 'https://example.com' },
      }),
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'OPEN_WINDOW',
        window: expect.objectContaining({ id: 'browser' }),
      }),
    }));

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-browser-nav',
        clientId: 'host-client',
        createdAt: 1.5,
        kind: 'UPDATE_WINDOW_DATA',
        windowId: 'browser',
        data: { currentUrl: 'https://example.com/review?step=1' },
        evidence: {
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          browserNavigationId: 'browser-navigation:host:1500:browser:go_button:nav_54d2c495',
        },
      },
    }));

    expect(storage.get('desktopWindows')).toEqual([
      expect.objectContaining({
        id: 'browser',
        data: { currentUrl: 'https://example.com/review?step=1' },
      }),
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'UPDATE_WINDOW_DATA',
        windowId: 'browser',
        evidence: expect.objectContaining({
          source: 'room_browser_window',
          navigationSource: 'browser_window_client_submit',
          browserNavigationId: 'browser-navigation:host:1500:browser:go_button:nav_54d2c495',
        }),
      }),
    }));

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-close-browser',
        clientId: 'guest-client',
        createdAt: 2,
        kind: 'CLOSE_WINDOW',
        windowId: 'browser',
      },
    }));

    expect(storage.get('desktopWindows')).toEqual([]);
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        kind: 'CLOSE_WINDOW',
        windowId: 'browser',
      }),
    }));
  });

  it('persists and broadcasts shared desktop window state changes', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    storage.set('desktopWindows', [
      {
        id: 'browser',
        windowType: 'browser',
        title: 'Microsoft Edge',
        x: 100,
        y: 60,
        width: 800,
        height: 560,
      },
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-move-browser',
        clientId: 'host-client',
        createdAt: 3,
        kind: 'UPDATE_WINDOW_STATE',
        windowId: 'browser',
        x: 260,
        y: 140,
        minimized: false,
        focused: true,
      },
    }));

    expect(storage.get('desktopWindows')).toEqual([
      expect.objectContaining({
        id: 'browser',
        x: 260,
        y: 140,
        minimized: false,
        focused: true,
      }),
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'UPDATE_WINDOW_STATE',
        windowId: 'browser',
        x: 260,
        y: 140,
        focused: true,
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-move-browser',
          kind: 'UPDATE_WINDOW_STATE',
          windowId: 'browser',
        }),
      }),
    ]);
  });

  it('persists participant-controlled desktop surface changes and records activity', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-guest-surface',
        clientId: 'guest-client',
        createdAt: 1,
        kind: 'SET_ROOM_SURFACE',
        surface: 'standard',
      },
    }));

    expect(storage.get('roomSurface')).toBe('standard');
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        kind: 'SET_ROOM_SURFACE',
        surface: 'standard',
      }),
    }));

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-host-surface',
        clientId: 'host-client',
        createdAt: 2,
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
      },
    }));

    expect(storage.get('roomSurface')).toBe('win95');
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'evt-guest-surface',
          kind: 'SET_ROOM_SURFACE',
          surface: 'standard',
        }),
      }),
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-host-surface',
          kind: 'SET_ROOM_SURFACE',
          surface: 'win95',
        }),
      }),
    ]);
  });

  it('broadcasts workspace state changes without changing shared windows', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    storage.set('desktopWindows', [
      {
        id: 'workspace',
        windowType: 'workspace',
        title: 'VS Code',
      },
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-workspace-ready',
        clientId: 'host-client',
        createdAt: 3,
        kind: 'WORKSPACE_STATE_CHANGED',
        actor: 'host',
        workspaceStateEventId: 'workspace-state:host:3:launch:workspace-session-1:READY',
        capturedAtMs: 3,
        status: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        githubPrNumber: 14435,
        matchedRepoId: 42,
        challengeStatus: 'github_pr_assigned',
        challengeKind: 'github_pr',
        challengeSource: 'scheduled_interview.github_pr_number',
        challengeMessage: null,
        ttlSeconds: 3600,
        ttlSource: 'default',
        expiringSoon: false,
        source: 'browser_workspace_state_observer',
        workspaceEventSource: 'browser_workspace_state_observer',
        workspaceStateSource: 'launch',
        workspaceTelemetryPersisted: true,
        proxyUrlPersisted: false,
      },
    }));

    expect(storage.get('desktopWindows')).toEqual([
      expect.objectContaining({
        id: 'workspace',
        windowType: 'workspace',
        title: 'VS Code',
      }),
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'WORKSPACE_STATE_CHANGED',
        actor: 'host',
        workspaceStateEventId: 'workspace-state:host:3:launch:workspace-session-1:READY',
        capturedAtMs: 3,
        status: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        githubPrNumber: 14435,
        matchedRepoId: 42,
        challengeStatus: 'github_pr_assigned',
        challengeKind: 'github_pr',
        challengeSource: 'scheduled_interview.github_pr_number',
        challengeMessage: null,
        source: 'browser_workspace_state_observer',
        workspaceEventSource: 'browser_workspace_state_observer',
        workspaceStateSource: 'launch',
        workspaceTelemetryPersisted: true,
        proxyUrlPersisted: false,
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-workspace-ready',
          kind: 'WORKSPACE_STATE_CHANGED',
          actor: 'host',
          workspaceStateEventId: 'workspace-state:host:3:launch:workspace-session-1:READY',
          capturedAtMs: 3,
          status: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          githubPrNumber: 14435,
          matchedRepoId: 42,
          challengeStatus: 'github_pr_assigned',
          challengeKind: 'github_pr',
          challengeSource: 'scheduled_interview.github_pr_number',
          challengeMessage: null,
          ttlSeconds: 3600,
          ttlSource: 'default',
          expiringSoon: false,
          source: 'browser_workspace_state_observer',
          workspaceEventSource: 'browser_workspace_state_observer',
          workspaceStateSource: 'launch',
          workspaceTelemetryPersisted: true,
          proxyUrlPersisted: false,
        }),
      }),
    ]);
  });

  it('broadcasts live room cursor presence without persisting activity', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CURSOR',
      payload: {
        clientId: 'host-client',
        x: 0.25,
        y: 0.4,
        updatedAt: 123,
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CURSOR',
      role: 'HOST',
      payload: {
        clientId: 'host-client',
        x: 0.25,
        y: 0.4,
        updatedAt: 123,
      },
    }));
    expect(storage.get('desktopActivityLog')).toBeUndefined();
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
          chatEventSource: 'browser_room_chat_window',
          actor: 'host',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));

    const acceptedEvidence = {
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_window',
      actor: 'host',
      roomMessageId: 'chat-1',
      clientId: 'host-client',
      messageCreatedAt: 42,
      messageLength: 'Can you see this message?'.length,
      deliveryStatus: 'accepted',
      surface: 'win95',
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

  it('stores and broadcasts shared Clippy prompts for proactive room guidance', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_PROMPT',
      payload: {
        id: 'clippy-recording',
        clientId: 'host-client',
        createdAt: 3,
        source: 'system',
        promptEventSource: 'browser_proactive_clippy_prompt',
        promptTrigger: 'recording_start_suggestion',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-session-1',
        agentResponseClaimed: false,
        targetRoles: ['HOST'],
        text: "It looks like you're starting an interview. Would you like to begin recording?",
        hold: true,
        actions: [
          { id: 'start-recording', label: 'Start recording' },
        ],
      },
    }));

    expect(storage.get('currentClippyPrompt')).toEqual(expect.objectContaining({
      id: 'clippy-recording',
      clientId: 'host-client',
      source: 'system',
      promptEventSource: 'browser_proactive_clippy_prompt',
      promptTrigger: 'recording_start_suggestion',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      agentResponseClaimed: false,
      targetRoles: ['HOST'],
      text: "It looks like you're starting an interview. Would you like to begin recording?",
      actions: [
        { id: 'start-recording', label: 'Start recording' },
      ],
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_PROMPT',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'clippy-recording',
        promptEventSource: 'browser_proactive_clippy_prompt',
        promptTrigger: 'recording_start_suggestion',
        text: "It looks like you're starting an interview. Would you like to begin recording?",
      }),
    }));
    expect(storage.get('clippyPromptActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        prompt: expect.objectContaining({
          id: 'clippy-recording',
          promptEventSource: 'browser_proactive_clippy_prompt',
          promptTrigger: 'recording_start_suggestion',
          agentResponseClaimed: false,
        }),
      }),
    ]);
  });

  it('stores, broadcasts, and records shared room filesystem edits', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      payload: {
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
          metadata: { app: 'notepad' },
          createdAt: 4,
          updatedAt: 4,
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
      },
    }));

    expect(storage.get('roomFileSystem')).toEqual([
      expect.objectContaining({
        id: 'desktop-notes',
        name: 'notes.txt',
        kind: 'text',
        content: 'Candidate asked about testing strategy.',
        mimeType: 'text/plain',
        metadata: { app: 'notepad' },
      }),
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'UPSERT_FILE',
        file: expect.objectContaining({
          id: 'desktop-notes',
          name: 'notes.txt',
        }),
        evidence: expect.objectContaining({
          source: 'win95_shared_file_system',
          fileChangeId: 'file:host:4:upsert:desktop-notes',
        }),
      }),
    }));
    expect(storage.get('fileSystemActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'fs-save-notes',
          kind: 'UPSERT_FILE',
          evidence: expect.objectContaining({
            source: 'win95_shared_file_system',
            fileChangeId: 'file:host:4:upsert:desktop-notes',
          }),
        }),
      }),
    ]);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      payload: {
        id: 'fs-delete-notes',
        clientId: 'guest-client',
        createdAt: 5,
        kind: 'DELETE_FILE',
        fileId: 'desktop-notes',
        evidence: {
          source: 'win95_shared_file_system',
          fileEventSource: 'browser_client_submit',
          fileChangeId: 'file:guest:5:delete:desktop-notes',
          actor: 'guest',
          operation: 'delete',
          fileId: 'desktop-notes',
          fileName: 'notes.txt',
          fileKind: 'text',
          surface: 'win95',
          roomPhase: 'connected',
          capturedAtMs: 5,
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(storage.get('roomFileSystem')).toEqual([]);
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        kind: 'DELETE_FILE',
        fileId: 'desktop-notes',
        file: expect.objectContaining({
          id: 'desktop-notes',
          name: 'notes.txt',
          content: 'Candidate asked about testing strategy.',
        }),
        evidence: expect.objectContaining({
          source: 'win95_shared_file_system',
          fileChangeId: 'file:guest:5:delete:desktop-notes',
        }),
      }),
    }));
    expect(storage.get('fileSystemActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'fs-save-notes',
          kind: 'UPSERT_FILE',
        }),
      }),
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'fs-delete-notes',
          kind: 'DELETE_FILE',
          fileId: 'desktop-notes',
          file: expect.objectContaining({
            id: 'desktop-notes',
            name: 'notes.txt',
            content: 'Candidate asked about testing strategy.',
          }),
          evidence: expect.objectContaining({
            source: 'win95_shared_file_system',
            fileChangeId: 'file:guest:5:delete:desktop-notes',
          }),
        }),
      }),
    ]);
  });

  it('rejects shared room filesystem edits without browser source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      payload: {
        id: 'fs-source-less-save',
        clientId: 'host-client',
        createdAt: 6,
        kind: 'UPSERT_FILE',
        file: {
          id: 'desktop-source-less-notes',
          name: 'source-less-notes.txt',
          kind: 'text',
          content: 'This should not become graph evidence.',
          mimeType: 'text/plain',
          metadata: { app: 'notepad' },
          createdAt: 6,
          updatedAt: 6,
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_FILE_SYSTEM_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_FILE_SYSTEM_EVENT',
    }));
    expect(storage.has('roomFileSystem')).toBe(false);
    expect(storage.has('fileSystemActivityLog')).toBe(false);
  });

  it('exposes replayable room activity logs for server-side evidence sync', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-enter-95',
        clientId: 'host-client',
        createdAt: 1000,
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
      },
    }));
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
          chatEventSource: 'browser_room_chat_window',
          actor: 'guest',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));
    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      payload: {
        id: 'fs-notes-save',
        clientId: 'host-client',
        createdAt: 3000,
        kind: 'UPSERT_FILE',
        file: {
          id: 'notepad',
          name: 'notes.txt',
          kind: 'text',
          content: 'Candidate identified retry bug evidence.',
          mimeType: 'text/plain',
          createdAt: 3000,
          updatedAt: 3000,
        },
        evidence: {
          source: 'win95_shared_file_system',
          fileEventSource: 'browser_client_submit',
          fileChangeId: 'file:host:3000:upsert:notepad',
          actor: 'host',
          operation: 'upsert',
          fileId: 'notepad',
          fileName: 'notes.txt',
          fileKind: 'text',
          surface: 'win95',
          roomPhase: 'connected',
          capturedAtMs: 3000,
          durableObjectReplayExpected: true,
        },
      },
    }));

    const response = await room.fetch(new Request('https://do/activity-log'));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      desktopActivityLog: unknown[];
      chatActivityLog: unknown[];
      fileSystemActivityLog: unknown[];
    };

    expect(body.desktopActivityLog).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-enter-95',
          kind: 'SET_ROOM_SURFACE',
          surface: 'win95',
        }),
      }),
    ]);
    expect(body.chatActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        message: expect.objectContaining({
          id: 'chat-guest-question',
          text: 'I found the retry bug in the queue worker.',
          deliveryStatus: 'accepted',
          evidence: expect.objectContaining({
            source: 'room_chat_client_submit',
            chatEventSource: 'browser_room_chat_window',
            actor: 'guest',
            roomMessageId: 'chat-guest-question',
            clientId: 'guest-client',
            deliveryStatus: 'accepted',
            surface: 'win95',
            roomPhase: 'connected',
          }),
        }),
      }),
    ]);
    expect(body.fileSystemActivityLog).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'fs-notes-save',
          kind: 'UPSERT_FILE',
          evidence: expect.objectContaining({
            source: 'win95_shared_file_system',
            fileChangeId: 'file:host:3000:upsert:notepad',
          }),
        }),
      }),
    ]);
  });
});
