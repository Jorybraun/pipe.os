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
});
