import type { ReactElement, ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('main auth bootstrap', () => {
  let capturedElement: ReactElement | null = null;
  const renderRoot = vi.fn((element: ReactElement): void => {
    capturedElement = element;
  });

  async function loadMainAt(path: string, clerkPublishableKey: string | undefined): Promise<void> {
    vi.resetModules();
    cleanup();
    capturedElement = null;
    renderRoot.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    window.history.pushState({}, '', path);

    if (clerkPublishableKey) {
      vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', clerkPublishableKey);
    } else {
      vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    }

    vi.doMock('react-dom/client', () => ({
      default: {
        createRoot: () => ({ render: renderRoot }),
      },
    }));

    vi.doMock('@clerk/react', () => ({
      ClerkProvider: ({ children }: { children: ReactNode }) => (
        <div data-testid="clerk-provider">{children}</div>
      ),
    }));

    vi.doMock('./App.tsx', () => ({
      default: ({ recruiterAuthUnavailable }: { recruiterAuthUnavailable?: boolean }) => (
        <div data-auth-missing={String(Boolean(recruiterAuthUnavailable))} data-testid="app-root" />
      ),
    }));

    vi.doMock('./providers/DataContext', () => ({
      PipeProviderRoot: ({ children }: { children: ReactNode }) => (
        <div data-testid="pipe-provider">{children}</div>
      ),
    }));

    await import('./main');
    if (!capturedElement) {
      throw new Error('Expected main.tsx to render the root element.');
    }
    render(capturedElement);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('keeps ClerkProvider when a Clerk key exists', async () => {
    await loadMainAt('/interviews', 'pk_test_dev');

    expect(screen.getByTestId('clerk-provider')).toBeTruthy();
    expect(screen.getByTestId('app-root')).toHaveAttribute('data-auth-missing', 'false');
  });

  it('shows missing auth when no Clerk key is configured', async () => {
    await loadMainAt('/interviews', undefined);

    expect(screen.queryByTestId('clerk-provider')).toBeNull();
    expect(screen.getByTestId('app-root')).toHaveAttribute('data-auth-missing', 'true');
  });
});
