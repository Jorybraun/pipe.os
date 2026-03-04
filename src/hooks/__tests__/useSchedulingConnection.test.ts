import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSchedulingConnection } from '../useSchedulingConnection';

// Use vi.hoisted to ensure these are available during vi.mock evaluation
const mocks = vi.hoisted(() => {
  return {
    mockObserveQuery: vi.fn(),
    mockExchangeMutation: vi.fn(),
  };
});

vi.mock('aws-amplify/data', () => {
  return {
    generateClient: () => ({
      models: {
        SchedulingConnection: {
          observeQuery: () => ({
            subscribe: mocks.mockObserveQuery
          })
        }
      },
      mutations: {
        exchangeSchedulingOAuth: mocks.mockExchangeMutation
      }
    })
  };
});

describe('useSchedulingConnection hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation to prevent unsubscribe errors
    mocks.mockObserveQuery.mockReturnValue({ unsubscribe: vi.fn() });
  });

  it('6.1.1 Initial State before subscription fires', () => {
    // Already set in beforeEach
    const { result } = renderHook(() => useSchedulingConnection());
    
    expect(result.current.isLoading).toBe(true);
    expect(result.current.connection).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('6.1.2 Subscription syncs with no connections', async () => {
    mocks.mockObserveQuery.mockImplementation(({ next }) => {
      next({ items: [], isSynced: true });
      return { unsubscribe: vi.fn() };
    });

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
      lastSyncAt: null
    };

    mocks.mockObserveQuery.mockImplementation(({ next }) => {
      next({ items: [mockConnection], isSynced: true });
      return { unsubscribe: vi.fn() };
    });

    const { result } = renderHook(() => useSchedulingConnection());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connection).toEqual(expect.objectContaining({
      id: 'conn-1',
      status: 'ACTIVE',
      accountEmail: 'test@example.com'
    }));
  });

  it('6.2.1 Successful exchange → connection state updated', async () => {
    mocks.mockExchangeMutation.mockResolvedValue({
      data: JSON.stringify({
        success: true,
        data: {
          connectionId: 'new-conn',
          providerId: 'CALENDLY',
          status: 'ACTIVE',
          accountEmail: 'new@example.com'
        }
      }),
      errors: undefined
    });

    const { result } = renderHook(() => useSchedulingConnection());

    await act(async () => {
      await result.current.exchangeOAuth('CALENDLY', 'code', 'uri');
    });

    expect(result.current.connection?.id).toBe('new-conn');
    expect(result.current.connection?.accountEmail).toBe('new@example.com');
  });

  it('6.3.1 fetchEventTypes maps duration correctly', async () => {
    mocks.mockExchangeMutation.mockResolvedValue({
      data: JSON.stringify({
        success: true,
        data: [
          { id: 'et-1', name: '30 min', durationMinutes: 30, url: 'url' }
        ]
      })
    });

    const { result } = renderHook(() => useSchedulingConnection());
    
    let eventTypes;
    await act(async () => {
      eventTypes = await result.current.fetchEventTypes('conn-1');
    });

    expect(eventTypes).toEqual([{
      id: 'et-1',
      name: '30 min',
      duration: 30,
      url: 'url'
    }]);
  });

  it('6.4.1 Successful disconnect clears connection', async () => {
    mocks.mockObserveQuery.mockImplementation(({ next }) => {
      next({ items: [{ id: 'c1', status: 'ACTIVE' }], isSynced: true });
      return { unsubscribe: vi.fn() };
    });
    mocks.mockExchangeMutation.mockResolvedValue({ data: JSON.stringify({ success: true }) });

    const { result } = renderHook(() => useSchedulingConnection());
    await waitFor(() => expect(result.current.connection).not.toBeNull());

    await act(async () => {
      await result.current.disconnect('c1');
    });

    expect(result.current.connection).toBeNull();
  });
});
