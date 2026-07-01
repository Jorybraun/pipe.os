import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    clerkUseAuth: vi.fn(() => ({
      getToken: vi.fn(async () => 'mock-token'),
      userId: 'mock-user',
    })),
  };
});

vi.mock('@clerk/react', () => ({
  useAuth: mocks.clerkUseAuth,
}));

describe('useRoomStatusNotifications', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    window.history.pushState({}, '', '/');
  });

  it('opens the room-status SSE stream without a bearer token when dev proxy auth is active', async () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { useRoomStatusNotifications } = await import('./useRoomStatusNotifications');

    renderHook(() => useRoomStatusNotifications());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
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
});
