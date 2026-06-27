import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionEvents } from './useSessionEvents';

describe('useSessionEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requeues events when the session-events endpoint returns a non-OK response', async () => {
    vi.setSystemTime(new Date('2026-06-27T22:50:00.000Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSessionEvents({
      token: 'room-token',
      apiBase: 'https://api.test',
    }));

    act(() => {
      result.current.capture('chat_message', 'hello', 'guest', { source: 'room_chat_client_submit' });
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      properties: { clientEventId: string; clientCapturedAtMs: number };
    };

    await act(async () => {
      await result.current.flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      properties: { clientEventId: string; clientCapturedAtMs: number };
    };
    expect(secondBody.properties.clientEventId).toBe(firstBody.properties.clientEventId);
    expect(secondBody.properties.clientCapturedAtMs).toBe(1782600600000);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.test/api/v1/meeting-rooms/room-token/session-events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'chat_message',
          text: 'hello',
          actor: 'guest',
          properties: {
            source: 'room_chat_client_submit',
            clientEventId: firstBody.properties.clientEventId,
            clientCapturedAtMs: 1782600600000,
          },
        }),
      }),
    );
  });

  it('stamps repeated browser interactions with distinct source event ids', async () => {
    vi.setSystemTime(new Date('2026-06-27T22:51:00.000Z'));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSessionEvents({
      token: 'room-token',
      apiBase: 'https://api.test',
    }));

    act(() => {
      result.current.capture('window_update', 'Window state updated: browser', 'host', {
        source: 'window_state_client_submit',
        windowId: 'browser',
      });
      result.current.capture('window_update', 'Window state updated: browser', 'host', {
        source: 'window_state_client_submit',
        windowId: 'browser',
      });
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as {
      properties: { clientEventId: string; clientCapturedAtMs: number };
    });
    expect(bodies[0]?.properties.clientCapturedAtMs).toBe(1782600660000);
    expect(bodies[1]?.properties.clientCapturedAtMs).toBe(1782600660000);
    expect(bodies[0]?.properties.clientEventId).toEqual(expect.any(String));
    expect(bodies[1]?.properties.clientEventId).toEqual(expect.any(String));
    expect(bodies[0]?.properties.clientEventId).not.toBe(bodies[1]?.properties.clientEventId);
  });

  it('sends queued evidence with Beacon before page unload cancels the debounce', async () => {
    vi.setSystemTime(new Date('2026-06-27T22:52:00.000Z'));
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSessionEvents({
      token: 'room-token',
      apiBase: 'https://api.test',
    }));

    act(() => {
      result.current.capture('clippy_action', 'Clippy chat opened', 'host', {
        source: 'clippy_tray_ui',
        agentResponseClaimed: false,
      });
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, payload] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe('https://api.test/api/v1/meeting-rooms/room-token/session-events');
    const parsedPayload = JSON.parse(payload) as {
      type: string;
      text: string;
      actor: string;
      properties: {
        source: string;
        agentResponseClaimed: boolean;
        clientEventId: string;
        clientCapturedAtMs: number;
      };
    };
    expect(parsedPayload).toMatchObject({
      type: 'clippy_action',
      text: 'Clippy chat opened',
      actor: 'host',
      properties: {
        source: 'clippy_tray_ui',
        agentResponseClaimed: false,
        clientCapturedAtMs: 1782600720000,
      },
    });
    expect(parsedPayload.properties.clientEventId).toEqual(expect.any(String));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
