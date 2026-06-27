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

    await act(async () => {
      await result.current.flush();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.test/api/v1/meeting-rooms/room-token/session-events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'chat_message',
          text: 'hello',
          actor: 'guest',
          properties: { source: 'room_chat_client_submit' },
        }),
      }),
    );
  });

  it('sends queued evidence with Beacon before page unload cancels the debounce', async () => {
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
    expect(payload).toBe(JSON.stringify({
      type: 'clippy_action',
      text: 'Clippy chat opened',
      actor: 'host',
      properties: {
        source: 'clippy_tray_ui',
        agentResponseClaimed: false,
      },
    }));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
