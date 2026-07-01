import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipeProviderRoot } from '../providers/DataContext';
import type { AuthProvider, DataProviderFactory, StorageProvider } from '../providers/types';

const getSessionToken = vi.fn(async () => 'test-token');

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const auth: AuthProvider = {
    currentUser: { userId: 'user_1', username: 'test@example.com', email: 'test@example.com' },
    isLoading: false,
    signOut: async () => {},
    getSessionToken,
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
    vi.resetModules();
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
});
