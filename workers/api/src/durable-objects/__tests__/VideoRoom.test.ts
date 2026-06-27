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

  it('persists host-controlled desktop surface changes and records activity', async () => {
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

    expect(storage.get('roomSurface')).toBeUndefined();
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason: 'ONLY_HOST_CAN_SET_SURFACE',
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
        status: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        githubPrNumber: 14435,
        matchedRepoId: 42,
        ttlSeconds: 3600,
        ttlSource: 'default',
        expiringSoon: false,
        source: 'launch',
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
        status: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        githubPrNumber: 14435,
        matchedRepoId: 42,
        source: 'launch',
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-workspace-ready',
          kind: 'WORKSPACE_STATE_CHANGED',
          status: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
          githubPrNumber: 14435,
          matchedRepoId: 42,
          ttlSeconds: 3600,
          ttlSource: 'default',
          expiringSoon: false,
          source: 'launch',
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
      },
    }));

    expect(storage.get('chatMessages')).toEqual([
      {
        id: 'chat-1',
        clientId: 'host-client',
        createdAt: 42,
        role: 'HOST',
        text: 'Can you see this message?',
      },
    ]);
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'chat-1',
        role: 'HOST',
        text: 'Can you see this message?',
      }),
    }));
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CHAT_MESSAGE_ACK',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'chat-1',
        role: 'HOST',
        text: 'Can you see this message?',
      }),
    }));
    expect(storage.get('chatActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        message: expect.objectContaining({
          id: 'chat-1',
          text: 'Can you see this message?',
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
        text: "It looks like you're starting an interview. Would you like to begin recording?",
      }),
    }));
    expect(storage.get('clippyPromptActivityLog')).toEqual([
      expect.objectContaining({
        role: 'HOST',
        prompt: expect.objectContaining({
          id: 'clippy-recording',
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
    ]);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT',
      payload: {
        id: 'fs-delete-notes',
        clientId: 'guest-client',
        createdAt: 5,
        kind: 'DELETE_FILE',
        fileId: 'desktop-notes',
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
        }),
      }),
    ]);
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
        }),
      }),
    ]);
    expect(body.fileSystemActivityLog).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'fs-notes-save',
          kind: 'UPSERT_FILE',
        }),
      }),
    ]);
  });
});
