import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSchedulingConnection } from '../useSchedulingConnection';
import type { ApiClient } from '../../lib/api/client';

// Mock Clerk auth to avoid <ClerkProvider> requirement
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('test-token') }),
}));

// Mock useApiClient so tests don't hit real HTTP endpoints
const apiMocks = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDel: vi.fn(),
}));

const mockApiClient: ApiClient = {
  get: apiMocks.mockGet,
  post: apiMocks.mockPost,
  patch: vi.fn(),
  put: vi.fn(),
  del: apiMocks.mockDel,
  postStream: vi.fn(),
};

vi.mock('../useApiClient', () => ({
  useApiClient: () => mockApiClient,
}));

describe('useSchedulingConnection hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6.1.1 Initial State before subscription fires', () => {
    const { result } = renderHook(() => useSchedulingConnection());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.connection).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('6.1.2 Subscription syncs with no connections', async () => {
    apiMocks.mockGet.mockResolvedValue({ connection: null });

    const { result } = renderHook(() => useSchedulingConnection());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connection).toBe(null);
  });

  it('6.1.3 Subscription syncs with ACTIVE connection', async () => {
    const mockConnection = {
      id: 'conn-1',
      providerId: 'CALENDLY',
      status: 'ACTIVE',
      accountEmail: 'test@example.com',
      accountName: 'Test User',
      connectedAt: '2026-03-03T10:00:00Z',
      lastSyncAt: null,
    };

    apiMocks.mockGet.mockResolvedValue({ connection: mockConnection });

    const { result } = renderHook(() => useSchedulingConnection());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connection).toEqual(expect.objectContaining({
      id: 'conn-1',
      status: 'ACTIVE',
      accountEmail: 'test@example.com',
    }));
  });

  it('6.2.1 Successful exchange → connection state updated', async () => {
    apiMocks.mockGet.mockResolvedValue({ connection: null });
    apiMocks.mockPost.mockResolvedValue({
      connection: {
        id: 'new-conn',
        providerId: 'CALENDLY',
        status: 'ACTIVE',
        accountEmail: 'new@example.com',
        accountName: 'New User',
        webhookRegistered: true,
      },
    });

    const { result } = renderHook(() => useSchedulingConnection());

    // Wait for initial fetch to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.exchangeOAuth('CALENDLY', 'code', 'uri');
    });

    expect(result.current.connection?.id).toBe('new-conn');
    expect(result.current.connection?.accountEmail).toBe('new@example.com');
  });

  it('6.3.1 fetchEventTypes maps duration correctly', async () => {
    apiMocks.mockGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/scheduling/connection') {
        return { connection: null };
      }
      if (path === '/api/v1/scheduling/event-types') {
        return {
          eventTypes: [
            { id: 'et-1', name: '30 min', durationMinutes: 30, url: 'url' },
          ],
        };
      }
      return {};
    });

    const { result } = renderHook(() => useSchedulingConnection());

    // Wait for initial fetch to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let eventTypes;
    await act(async () => {
      eventTypes = await result.current.fetchEventTypes('conn-1');
    });

    expect(eventTypes).toEqual([{
      id: 'et-1',
      name: '30 min',
      duration: 30,
      url: 'url',
    }]);
  });

  it('6.4.1 Successful disconnect clears connection', async () => {
    apiMocks.mockGet.mockResolvedValue({
      connection: {
        id: 'c1',
        status: 'ACTIVE',
        providerId: 'CALENDLY',
        accountEmail: 'a@b.com',
        accountName: 'A',
        connectedAt: '2026-03-03T10:00:00Z',
        lastSyncAt: null,
      },
    });
    apiMocks.mockDel.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSchedulingConnection());
    await waitFor(() => expect(result.current.connection).not.toBeNull());

    await act(async () => {
      await result.current.disconnect('c1');
    });

    expect(result.current.connection).toBeNull();
  });
});
