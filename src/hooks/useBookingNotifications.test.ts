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

describe('useBookingNotifications', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    getSessionToken.mockClear();
    window.history.pushState({}, '', '/');
  });

  it('opens the scheduling SSE stream without a bearer token when dev proxy auth is active', async () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { useBookingNotifications } = await import('./useBookingNotifications');

    renderHook(() => useBookingNotifications(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(getSessionToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/scheduling/events',
      expect.objectContaining({
        headers: {
          Accept: 'text/event-stream',
        },
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('caps retained booking notifications from the SSE stream', async () => {
    const events = Array.from({ length: 60 }, (_, index) => {
      const data = JSON.stringify({
        interviewId: `interview-${index}`,
        status: 'SCHEDULED',
        scheduledAt: null,
        meetingUrl: null,
        recipientName: null,
        recipientEmail: null,
        candidateId: null,
        syncSource: 'webhook',
        updatedAt: `2026-07-02T16:${String(index).padStart(2, '0')}:00.000Z`,
      });
      return `event: booking_update\ndata: ${data}\n\n`;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(events)));
    const { useBookingNotifications } = await import('./useBookingNotifications');

    const { result } = renderHook(() => useBookingNotifications(), { wrapper });

    await waitFor(() => expect(result.current.notifications).toHaveLength(50));
    expect(result.current.notifications[0]?.interviewId).toBe('interview-10');
    expect(result.current.notifications[49]?.interviewId).toBe('interview-59');
  });
});
