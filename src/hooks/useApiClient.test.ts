import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApiClient } from './useApiClient';
import { PipeProviderRoot } from '../providers/DataContext';
import type { AuthProvider, DataProviderFactory, StorageProvider } from '../providers/types';

const getSessionToken = vi.fn(async () => 'test-token');

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

describe('useApiClient', () => {
  afterEach(() => {
    getSessionToken.mockClear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('uses PIPE auth on normal recruiter routes', async () => {
    window.history.pushState({}, '', '/interviews');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.get('/api/v1/interviews');

    expect(getSessionToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
  });
});
