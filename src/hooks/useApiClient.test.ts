import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApiClient } from './useApiClient';

const mocks = vi.hoisted(() => ({
  useClerkAuth: vi.fn(() => ({
    getToken: vi.fn(async () => 'test-token'),
    userId: 'user_1',
  })),
}));

vi.mock('@clerk/react', () => ({
  useAuth: mocks.useClerkAuth,
}));

describe('useApiClient', () => {
  afterEach(() => {
    mocks.useClerkAuth.mockClear();
    window.history.pushState({}, '', '/');
  });

  it('returns a working client when dev proxy auth bypass is enabled', () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');

    const { result } = renderHook(() => useApiClient());

    expect(result.current).toBeTruthy();
  });

  it('uses Clerk auth on normal recruiter routes', () => {
    window.history.pushState({}, '', '/interviews');

    const { result } = renderHook(() => useApiClient());

    expect(result.current).toBeTruthy();
    expect(mocks.useClerkAuth).toHaveBeenCalledTimes(1);
  });
});
