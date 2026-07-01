import { describe, expect, it, vi } from 'vitest';
import { recoverFromChunkLoadError, shouldRecoverFromChunkLoadError } from './ErrorBoundary';

function makeWindowStub(options?: {
  href?: string;
  existingKeys?: Record<string, string>;
}): Window {
  const values = new Map(Object.entries(options?.existingKeys ?? {}));
  return {
    location: {
      href: options?.href ?? 'https://app-dev.hire-pipe.com/assess/token-1',
      reload: vi.fn(),
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    },
  } as unknown as Window;
}

describe('ErrorBoundary stale chunk recovery', () => {
  it('recognizes stale dynamic import failures from deploy rollovers', () => {
    expect(shouldRecoverFromChunkLoadError(new Error(
      'Failed to fetch dynamically imported module: https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js',
    ))).toBe(true);
    expect(shouldRecoverFromChunkLoadError(new Error('ChunkLoadError: Loading chunk 141 failed.'))).toBe(true);
    expect(shouldRecoverFromChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('reloads once per stale chunk URL and records the recovery attempt', () => {
    const win = makeWindowStub();
    const error = new Error(
      'Failed to fetch dynamically imported module: https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js',
    );

    expect(recoverFromChunkLoadError(error, win)).toBe(true);

    expect(win.sessionStorage.setItem).toHaveBeenCalledWith(
      'pipe:chunk-reload:v1:https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js',
      '1',
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload forever when the same stale chunk fails again', () => {
    const win = makeWindowStub({
      existingKeys: {
        'pipe:chunk-reload:v1:https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js': '1',
      },
    });
    const error = new Error(
      'Failed to fetch dynamically imported module: https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js',
    );

    expect(recoverFromChunkLoadError(error, win)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('does not throw when browser storage blocks the recovery marker', () => {
    const win = makeWindowStub();
    vi.mocked(win.sessionStorage.getItem).mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const error = new Error(
      'Failed to fetch dynamically imported module: https://app-dev.hire-pipe.com/assets/index-BaEefGkS.js',
    );

    expect(recoverFromChunkLoadError(error, win)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
