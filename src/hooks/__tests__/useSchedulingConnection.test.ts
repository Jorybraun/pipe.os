import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useSchedulingConnection } from '../useSchedulingConnection';
import { PipeProviderRoot } from '../../providers/DataContext';
import type { PipeProviders, DataProvider, ModelOperations } from '../../providers/types';

// Mock model/mutation functions
const mocks = vi.hoisted(() => {
  return {
    mockObserveQuery: vi.fn(),
    mockExchangeMutation: vi.fn(),
  };
});

function createMockModelOps(): ModelOperations {
  return {
    get: vi.fn().mockResolvedValue({ data: null }),
    list: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ data: null }),
    update: vi.fn().mockResolvedValue({ data: null }),
    delete: vi.fn().mockResolvedValue({ data: null }),
    observeQuery: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    }),
  };
}

function createMockDataProvider(): DataProvider {
  const modelNames = [
    'Pipeline', 'Stage', 'Candidate', 'Challenge', 'ChallengeSubmission',
    'Assessment', 'CodeArtifact', 'VideoSession', 'VideoSignal',
    'CandidateMedia', 'ScheduledInterview', 'SchedulingConnection',
    'RoleContext', 'RepoTemplate', 'DevContainerSession',
  ] as const;

  const models = {} as DataProvider['models'];
  for (const name of modelNames) {
    (models as Record<string, ModelOperations>)[name] = createMockModelOps();
  }

  // Wire up SchedulingConnection.observeQuery to use our mock
  (models.SchedulingConnection as { observeQuery: ReturnType<typeof vi.fn> }).observeQuery =
    vi.fn().mockReturnValue({ subscribe: mocks.mockObserveQuery });

  return {
    models,
    mutations: {
      exchangeSchedulingOAuth: mocks.mockExchangeMutation,
    },
    queries: {},
  };
}

function createWrapper() {
  const mockProvider = createMockDataProvider();
  const providers: PipeProviders = {
    data: {
      createClient: () => mockProvider,
      createPublicClient: () => mockProvider,
      createSessionClient: () => mockProvider,
    },
    storage: {
      upload: vi.fn().mockResolvedValue({ path: '' }),
      getUrl: vi.fn().mockResolvedValue({ url: new URL('https://example.com') }),
    },
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(PipeProviderRoot, { providers }, children);
  };
}

describe('useSchedulingConnection hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockObserveQuery.mockReturnValue({ unsubscribe: vi.fn() });
  });

  it('6.1.1 Initial State before subscription fires', () => {
    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.connection).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('6.1.2 Subscription syncs with no connections', async () => {
    mocks.mockObserveQuery.mockImplementation(({ next }: { next: (v: unknown) => void }) => {
      next({ items: [], isSynced: true });
      return { unsubscribe: vi.fn() };
    });

    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });

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

    mocks.mockObserveQuery.mockImplementation(({ next }: { next: (v: unknown) => void }) => {
      next({ items: [mockConnection], isSynced: true });
      return { unsubscribe: vi.fn() };
    });

    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connection).toEqual(expect.objectContaining({
      id: 'conn-1',
      status: 'ACTIVE',
      accountEmail: 'test@example.com',
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
          accountEmail: 'new@example.com',
        },
      }),
      errors: undefined,
    });

    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });

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
          { id: 'et-1', name: '30 min', durationMinutes: 30, url: 'url' },
        ],
      }),
    });

    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });

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
    mocks.mockObserveQuery.mockImplementation(({ next }: { next: (v: unknown) => void }) => {
      next({ items: [{ id: 'c1', status: 'ACTIVE' }], isSynced: true });
      return { unsubscribe: vi.fn() };
    });
    mocks.mockExchangeMutation.mockResolvedValue({ data: JSON.stringify({ success: true }) });

    const { result } = renderHook(() => useSchedulingConnection(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.connection).not.toBeNull());

    await act(async () => {
      await result.current.disconnect('c1');
    });

    expect(result.current.connection).toBeNull();
  });
});
