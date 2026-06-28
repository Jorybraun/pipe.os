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
        evidence: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'win95_start_menu',
          lifecycleKind: 'open',
          windowLifecycleId: 'window-lifecycle:host:1:open:browser',
          capturedAtMs: 1,
          actor: 'host',
          windowId: 'browser',
          windowType: 'browser',
          windowTitle: 'Microsoft Edge',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
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
        evidence: expect.objectContaining({ lifecycleSource: 'win95_start_menu' }),
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
          actor: 'host',
          windowId: 'browser',
          navigationTrigger: 'go_button',
          browserNavigationId: 'browser-navigation:host:1500:browser:go_button:nav_54d2c495',
          capturedAtMs: 1500,
          url: 'https://example.com/review?step=1',
          urlFingerprint: 'nav_54d2c495',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
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
        evidence: {
          source: 'window_lifecycle_client_submit',
          lifecycleSource: 'win95_window_chrome',
          lifecycleKind: 'close',
          windowLifecycleId: 'window-lifecycle:guest:2:close:browser',
          capturedAtMs: 2,
          actor: 'guest',
          windowId: 'browser',
          windowType: 'browser',
          windowTitle: 'Microsoft Edge',
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
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
        evidence: {
          source: 'window_state_client_submit',
          stateSource: 'win95_taskbar',
          actor: 'host',
          windowId: 'browser',
          action: 'restore_or_focus',
          windowStateChangeId: 'window-state:host:3:browser:restore_or_focus',
          capturedAtMs: 3,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
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
          evidence: expect.objectContaining({
            source: 'window_state_client_submit',
            stateSource: 'win95_taskbar',
            windowStateChangeId: 'window-state:host:3:browser:restore_or_focus',
          }),
        }),
      }),
    ]);
  });

  it('rejects shared desktop window events without browser source evidence', async () => {
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
        id: 'evt-source-less-open',
        clientId: 'host-client',
        createdAt: 3.5,
        kind: 'OPEN_WINDOW',
        window: {
          id: 'notepad',
          windowType: 'notepad',
          title: 'Notepad',
          x: 80,
          y: 60,
          width: 520,
          height: 420,
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
    }));
    expect(storage.has('desktopWindows')).toBe(false);
    expect(storage.has('desktopActivityLog')).toBe(false);
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
        surface: 'win95',
        previousSurface: 'standard',
        action: 'enter_desktop',
        source: 'room_surface_control',
        surfaceControlEventSource: 'browser_room_surface_toggle',
        surfaceChangeId: 'surface:guest:1:standard:win95',
        capturedAtMs: 1,
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    }));

    expect(storage.get('roomSurface')).toBe('win95');
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
        source: 'room_surface_control',
        surfaceChangeId: 'surface:guest:1:standard:win95',
      }),
    }));

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-host-surface',
        clientId: 'host-client',
        createdAt: 2,
        kind: 'SET_ROOM_SURFACE',
        surface: 'standard',
        previousSurface: 'win95',
        action: 'exit_desktop',
        source: 'room_surface_control',
        surfaceControlEventSource: 'browser_room_surface_toggle',
        surfaceChangeId: 'surface:host:2:win95:standard',
        capturedAtMs: 2,
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    }));

    expect(storage.get('roomSurface')).toBe('standard');
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'HOST',
      payload: expect.objectContaining({
        kind: 'SET_ROOM_SURFACE',
        surface: 'standard',
        source: 'room_surface_control',
        surfaceChangeId: 'surface:host:2:win95:standard',
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'evt-guest-surface',
          kind: 'SET_ROOM_SURFACE',
          surface: 'win95',
          surfaceChangeId: 'surface:guest:1:standard:win95',
        }),
      }),
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-host-surface',
          kind: 'SET_ROOM_SURFACE',
          surface: 'standard',
          surfaceChangeId: 'surface:host:2:win95:standard',
        }),
      }),
    ]);
  });

  it('persists and broadcasts source-backed Win95 Start menu state', async () => {
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
        id: 'evt-guest-start-menu-open',
        clientId: 'guest-client',
        createdAt: 3,
        kind: 'START_MENU_STATE',
        open: true,
        evidence: {
          source: 'win95_start_menu_control',
          menuEventSource: 'win95_start_button',
          actor: 'guest',
          menuId: 'start',
          action: 'open',
          open: true,
          startMenuEventId: 'start-menu:guest:3000:open:win95_start_button',
          capturedAtMs: 3000,
          surface: 'win95',
          roomPhase: 'connected',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(storage.get('desktopStartMenuOpen')).toBe(true);
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
      role: 'GUEST',
      payload: expect.objectContaining({
        kind: 'START_MENU_STATE',
        open: true,
        evidence: expect.objectContaining({
          source: 'win95_start_menu_control',
          startMenuEventId: 'start-menu:guest:3000:open:win95_start_button',
        }),
      }),
    }));
    expect(storage.get('desktopActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'evt-guest-start-menu-open',
          kind: 'START_MENU_STATE',
          open: true,
          evidence: expect.objectContaining({
            startMenuEventId: 'start-menu:guest:3000:open:win95_start_button',
          }),
        }),
      }),
    ]);
  });

  it('rejects Win95 Start menu state without source evidence', async () => {
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
        id: 'evt-source-less-start-menu',
        clientId: 'guest-client',
        createdAt: 3.5,
        kind: 'START_MENU_STATE',
        open: true,
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
      payload: expect.objectContaining({
        surface: 'standard',
        startMenuOpen: false,
        windows: [],
      }),
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
    }));
    expect(storage.has('desktopStartMenuOpen')).toBe(false);
    expect(storage.has('desktopActivityLog')).toBe(false);
  });

  it('rejects shared room surface changes without browser source evidence', async () => {
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
        id: 'evt-source-less-surface',
        clientId: 'guest-client',
        createdAt: 2.5,
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
    }));
    expect(storage.has('roomSurface')).toBe(false);
    expect(storage.has('desktopActivityLog')).toBe(false);
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

  it('rejects workspace state changes without browser observer evidence', async () => {
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
        id: 'evt-source-less-workspace',
        clientId: 'host-client',
        createdAt: 3,
        kind: 'WORKSPACE_STATE_CHANGED',
        actor: 'host',
        status: 'READY',
        workspaceSessionId: 'workspace-session-1',
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_DESKTOP_EVENT',
    }));
    expect(storage.has('desktopActivityLog')).toBe(false);
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
          surface: 'win95',
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
        id: 'media-event-1',
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
          surface: 'win95',
          roomPhase: 'connected',
          controlSurface: 'win95_video_window',
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
      }),
    ]);
    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL_ACK',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'media-event-1',
        control: 'microphone',
        enabled: false,
      }),
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_MEDIA_CONTROL',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'media-event-1',
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
          id: 'media-event-1',
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
        id: 'recording-state-1',
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
        id: 'recording-state-1',
        status: 'recording',
        active: true,
      }),
    }));
    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_RECORDING_STATE',
      role: 'HOST',
      payload: expect.objectContaining({
        id: 'recording-state-1',
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
          id: 'recording-state-1',
        }),
      }),
    ]);
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

  it('broadcasts raw cursor moves live without persisting cursor evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CURSOR',
      payload: {
        clientId: 'guest-client',
        role: 'GUEST',
        x: 0.42,
        y: 0.61,
        updatedAt: 1761592321000,
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CURSOR',
      role: 'GUEST',
      payload: expect.objectContaining({
        clientId: 'guest-client',
        x: 0.42,
        y: 0.61,
      }),
    }));
    expect(storage.has('cursorActivityLog')).toBe(false);
  });

  it('records source-backed sampled cursor evidence for replay', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CURSOR',
      payload: {
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
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CURSOR',
      role: 'GUEST',
      payload: expect.objectContaining({
        clientId: 'guest-client',
        evidence: expect.objectContaining({
          source: 'win95_cursor_presence_client_sample',
          cursorSampleId: 'cursor:guest:1761592321000:420:610',
        }),
      }),
    }));
    expect(storage.get('cursorActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        cursor: expect.objectContaining({
          clientId: 'guest-client',
          evidence: expect.objectContaining({
            source: 'win95_cursor_presence_client_sample',
            cursorSampleId: 'cursor:guest:1761592321000:420:610',
          }),
        }),
      }),
    ]);
  });

  it('rejects cursor samples with source-less evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CURSOR',
      payload: {
        clientId: 'guest-client',
        role: 'GUEST',
        x: 0.42,
        y: 0.61,
        updatedAt: 1761592321000,
        evidence: {
          source: 'room_cursor_claim',
          actor: 'guest',
          normalizedX: 0.42,
          normalizedY: 0.61,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CURSOR_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CURSOR',
    }));
    expect(storage.has('cursorActivityLog')).toBe(false);
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

  it('rejects Clippy prompts without browser prompt evidence', async () => {
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
        id: 'clippy-source-less',
        clientId: 'host-client',
        createdAt: 3,
        source: 'system',
        promptTrigger: 'missing_prompt_event_source',
        surface: 'win95',
        roomPhase: 'connected',
        agentResponseClaimed: false,
        text: 'This should not be saved as prompt evidence.',
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_PROMPT_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_PROMPT',
    }));
    expect(storage.has('currentClippyPrompt')).toBe(false);
    expect(storage.has('clippyPromptActivityLog')).toBe(false);
  });

  it('broadcasts and records source-backed Clippy/Devin interaction events', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-user-chat-1',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          browserQueuedBridgeMessage: true,
          bridgeDeliveryConfirmed: false,
          agent: null,
          surface: 'win95',
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
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-agent-status-1',
        clientId: 'guest-client',
        createdAt: 1782604000000,
        eventType: 'ai_agent_status',
        actor: 'agent',
        text: 'devin is ready.',
        evidence: {
          source: 'clippy_agent_bridge',
          agentStatusEventSource: 'browser_clippy_agent_ws',
          agent: 'devin',
          status: 'idle',
          diagnosticSource: null,
          bridgeMessageSource: 'agent_status',
          observedAt: '2026-06-27T20:00:00.000Z',
          capturedAtMs: 1782604000000,
          agentStatusEventId: 'agent-status:devin:1782604000000:agent_status:idle:none',
          surface: 'win95',
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
        type: 'ROOM_CLIPPY_INTERACTION',
        role: 'GUEST',
        payload: expect.objectContaining({
          eventType: 'ai_chat_user',
          actor: 'guest',
          text: 'Can you inspect the failing test?',
          evidence: expect.objectContaining({
            source: 'clippy_agent_chat_client_submit',
            promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          }),
        }),
      }),
      expect.objectContaining({
        type: 'ROOM_CLIPPY_INTERACTION',
        role: 'GUEST',
        payload: expect.objectContaining({
          eventType: 'ai_agent_status',
          actor: 'agent',
          evidence: expect.objectContaining({
            source: 'clippy_agent_bridge',
            agentStatusEventId: 'agent-status:devin:1782604000000:agent_status:idle:none',
          }),
        }),
      }),
    ]));
    expect(storage.get('clippyInteractionActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'clippy-user-chat-1',
          eventType: 'ai_chat_user',
        }),
      }),
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'clippy-agent-status-1',
          eventType: 'ai_agent_status',
        }),
      }),
    ]);
  });

  it('rejects Clippy/Devin interaction events without source evidence', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-fake-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'This should not be saved.',
        evidence: {
          source: 'clippy_agent_chat',
          promptLength: 'This should not be saved.'.length,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
  });

  it('rejects Clippy/Devin agent output with malformed browser prompt refs', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-agent-chat-malformed-prompt-ref',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_agent',
        actor: 'agent',
        text: 'I inspected the failing test.',
        evidence: {
          source: 'clippy_agent_bridge',
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
          browserPromptFingerprint: 'clippy_0123abcd',
          browserPromptTimestamp: 1782603900000,
          browserPromptLength: 'Can you inspect the failing test?'.length,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
  });

  it('rejects Clippy user prompts that claim a Devin agent attribution', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-attributed-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: 'devin',
          surface: 'win95',
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
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
  });

  it('rejects Clippy user prompts that claim confirmed bridge delivery', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-delivered-user-chat',
        clientId: 'guest-client',
        createdAt: 1782603900000,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:1782603900000:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 1782603900000,
          deliveredToAgentBridge: true,
          agent: null,
          surface: 'win95',
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
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
  });

  it('rejects Clippy/Devin room actions without the exact bridge tag protocol', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-legacy-agent-action',
        clientId: 'guest-client',
        createdAt: 1782594600000,
        eventType: 'clippy_action',
        actor: 'agent',
        text: 'devin suggested room action: open-terminal',
        evidence: {
          source: 'clippy_agent_bridge',
          origin: 'agent',
          executionStatus: 'suggested',
          actionId: 'open-terminal',
          actionSource: 'agent_stdout',
          actionProtocol: 'bridge_actions_field',
          bridgeEventType: 'ROOM_ACTION',
          agent: 'devin',
          observedAt: '2026-06-27T21:10:00.000Z',
          capturedAtMs: 1782594600000,
          clippyActionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
          bridgePersisted: true,
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(guest)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(host)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
  });

  it('rejects human Clippy UI actions that claim a Devin agent attribution', async () => {
    const host = new FakeSocket();
    const guest = new FakeSocket();
    const { state, storage } = makeState([
      [host, 'HOST'],
      [guest, 'GUEST'],
    ]);
    const room = new VideoRoom(state);

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-attributed-ui-action',
        clientId: 'host-client',
        createdAt: 1782594200000,
        eventType: 'clippy_action',
        actor: 'host',
        text: 'Clippy action: start recording',
        evidence: {
          source: 'clippy_prompt_ui',
          actionId: 'start-recording',
          origin: 'prompt',
          executedBy: 'host',
          actionSource: 'clippy_prompt_ui',
          executionStatus: 'executed',
          capturedAtMs: 1782594200000,
          clippyActionEventId: 'clippy-action:host:1782594200000:clippy_prompt_ui:prompt:executed:start-recording',
          agent: 'devin',
          agentResponseClaimed: false,
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          durableObjectReplayExpected: true,
        },
      },
    }));

    expect(parseSent(host)).toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
      reason: 'MISSING_SOURCE_EVIDENCE',
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_CLIPPY_INTERACTION',
    }));
    expect(storage.has('clippyInteractionActivityLog')).toBe(false);
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
    storage.set('roomFileSystem', [{
      id: 'accepted-notes',
      name: 'accepted-notes.txt',
      kind: 'text',
      content: 'Already accepted evidence.',
      mimeType: 'text/plain',
      createdAt: 5,
      updatedAt: 5,
      updatedBy: 'GUEST',
    }]);
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
      payload: {
        files: [
          expect.objectContaining({
            id: 'accepted-notes',
            content: 'Already accepted evidence.',
          }),
        ],
      },
    }));
    expect(parseSent(guest)).not.toContainEqual(expect.objectContaining({
      type: 'ROOM_FILE_SYSTEM_EVENT',
    }));
    expect(storage.get('roomFileSystem')).toEqual([
      expect.objectContaining({
        id: 'accepted-notes',
        content: 'Already accepted evidence.',
      }),
    ]);
    expect(storage.has('fileSystemActivityLog')).toBe(false);
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
      },
    }));

    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_TERMINAL_EVENT',
      payload: {
        id: 'terminal-output-1',
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
          id: 'terminal-command-1',
          kind: 'COMMAND',
        }),
      }),
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'terminal-output-1',
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
        id: 'code-file-save-1',
        clientId: 'guest-client',
        createdAt: 1782604100000,
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
          observedBy: 'clippy_agent_bridge',
          contentHash: 'a'.repeat(64),
        }),
      }),
    }));
    expect(storage.get('codeServerFileActivityLog')).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'code-file-save-1',
          eventType: 'code_editor_save',
          text: 'src/app.ts',
        }),
      }),
    ]);
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

    await room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT',
      payload: {
        id: 'evt-enter-95',
        clientId: 'host-client',
        createdAt: 1000,
        kind: 'SET_ROOM_SURFACE',
        surface: 'win95',
        previousSurface: 'standard',
        action: 'enter_desktop',
        source: 'room_surface_control',
        surfaceControlEventSource: 'browser_room_surface_toggle',
        surfaceChangeId: 'surface:host:1000:standard:win95',
        capturedAtMs: 1000,
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
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
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_MEDIA_CONTROL',
      payload: {
        id: 'media-camera-activity',
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
          surface: 'win95',
          roomPhase: 'connected',
          controlSurface: 'win95_video_window',
          controlAction: 'toggle',
          mediaSource: 'local_media_stream',
          rawMediaStreamPersisted: false,
        },
      },
    }));
    await room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({
      type: 'ROOM_CLIPPY_INTERACTION',
      payload: {
        id: 'clippy-user-chat-activity',
        clientId: 'guest-client',
        createdAt: 2400,
        eventType: 'ai_chat_user',
        actor: 'guest',
        text: 'Can you inspect the failing test?',
        evidence: {
          source: 'clippy_agent_chat_client_submit',
          agentChatEventSource: 'browser_clippy_chat_window',
          bridgeMessageType: 'CHAT',
          bridgeProtocol: 'clippy_dev_container_ws',
          promptId: 'workspace-session-1:guest:prompt:2400:clippy_0123abcd',
          promptFingerprint: 'clippy_0123abcd',
          promptLength: 'Can you inspect the failing test?'.length,
          promptTimestamp: 2400,
          browserQueuedBridgeMessage: true,
          bridgeDeliveryConfirmed: false,
          agent: null,
          surface: 'win95',
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
        id: 'code-file-activity',
        clientId: 'guest-client',
        createdAt: 2450,
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
        id: 'terminal-command-activity',
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
          surface: 'win95',
          roomPhase: 'connected',
          workspaceStatus: 'READY',
          workspaceSessionId: 'workspace-session-1',
          repoUrl: 'https://github.com/cloudflare/workers-sdk',
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
      mediaControlActivityLog: unknown[];
      clippyInteractionActivityLog: unknown[];
      codeServerFileActivityLog: unknown[];
      terminalActivityLog: unknown[];
      fileSystemActivityLog: unknown[];
    };

    expect(body.desktopActivityLog).toEqual([
      expect.objectContaining({
        role: 'HOST',
        event: expect.objectContaining({
          id: 'evt-enter-95',
          kind: 'SET_ROOM_SURFACE',
          surface: 'win95',
          source: 'room_surface_control',
          surfaceChangeId: 'surface:host:1000:standard:win95',
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
    expect(body.mediaControlActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'media-camera-activity',
          control: 'camera',
          enabled: false,
          evidence: expect.objectContaining({
            source: 'video_room_media_controls',
            mediaControlId: 'media:guest:camera:2200:disabled',
          }),
        }),
      }),
    ]);
    expect(body.clippyInteractionActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'clippy-user-chat-activity',
          eventType: 'ai_chat_user',
          text: 'Can you inspect the failing test?',
          evidence: expect.objectContaining({
            source: 'clippy_agent_chat_client_submit',
            agentChatEventSource: 'browser_clippy_chat_window',
          }),
        }),
      }),
    ]);
    expect(body.codeServerFileActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'code-file-activity',
          eventType: 'code_editor_save',
          text: 'src/app.ts',
          evidence: expect.objectContaining({
            source: 'code_server_workspace',
            observedBy: 'clippy_agent_bridge',
          }),
        }),
      }),
    ]);
    expect(body.terminalActivityLog).toEqual([
      expect.objectContaining({
        role: 'GUEST',
        event: expect.objectContaining({
          id: 'terminal-command-activity',
          kind: 'COMMAND',
          text: 'npm test',
          evidence: expect.objectContaining({
            source: 'container_terminal',
            terminalEventSource: 'browser_terminal_ws',
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
