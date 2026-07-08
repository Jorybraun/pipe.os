import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipeProviderRoot } from '../providers/DataContext';
import type { AuthProvider, DataProviderFactory, StorageProvider } from '../providers/types';

const getSessionToken = vi.fn(async () => 'test-token');
const encoder = new TextEncoder();

function sseResponse(events: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const auth: AuthProvider = {
    currentUser: { userId: 'user_1', username: 'test@example.com', email: 'test@example.com' },
    isLoading: false,
    signOut: async () => {},
    getSessionToken,
    getToken: async () => 'test-token',
    userId: 'user_1',
  };
  return createElement(PipeProviderRoot, {
    providers: {
      data: {} as DataProviderFactory,
      storage: {} as StorageProvider,
      auth,
    },
    children,
  });
}

describe('useRoomStatusNotifications', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    getSessionToken.mockClear();
    window.history.pushState({}, '', '/');
  });

  it('opens the room-status SSE stream without a bearer token when dev proxy auth is active', async () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { useRoomStatusNotifications } = await import('./useRoomStatusNotifications');

    renderHook(() => useRoomStatusNotifications(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(getSessionToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/scheduling/room-events',
      expect.objectContaining({
        headers: {
          Accept: 'text/event-stream',
        },
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('caps retained room-status updates from the SSE stream', async () => {
    const events = Array.from({ length: 125 }, (_, index) => {
      const data = JSON.stringify({
        interviewId: `interview-${index}`,
        meetingId: `meeting-${index}`,
        meetingStatus: 'OPEN',
        roomStatus: 'WAITING',
        guestJoinedAt: null,
        guestLeftAt: null,
        guestWaiting: true,
        updatedAt: `2026-07-02T16:${String(index).padStart(2, '0')}:00.000Z`,
      });
      return `event: room_status\ndata: ${data}\n\n`;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)));
    const { useRoomStatusNotifications } = await import('./useRoomStatusNotifications');

    const { result } = renderHook(() => useRoomStatusNotifications(), { wrapper });

    await waitFor(() => expect(result.current.updates).toHaveLength(100));
    expect(result.current.updates[0]?.interviewId).toBe('interview-25');
    expect(result.current.updates[99]?.interviewId).toBe('interview-124');
  });
});
