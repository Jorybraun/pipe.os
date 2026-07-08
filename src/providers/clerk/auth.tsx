/**
 * Clerk auth implementations.
 *
 * ClerkAuthGate — replaces AmplifyAuthGate in App.tsx.
 *   Shows the Clerk-hosted sign-in UI when unauthenticated, renders children
 *   when authenticated. Uses Clerk's <Show> component.
 *
 * ClerkAuthWrapper — replaces AmplifyAuthWrapper.
 *   Must be placed inside <ClerkAuthGate> (i.e. inside the signed-in boundary).
 *   Reads Clerk user state via useUser()/useAuth()/useClerk() and registers it
 *   into PipeProviderRoot via the internal useSetAuth() hook.
 *
 * useClerkAuth — hook that builds an AuthProvider from Clerk's hooks.
 *   Used internally by ClerkAuthWrapper.
 *
 * Consumer code accesses auth state via useAuth() from 'providers', not here.
 */

import { useEffect, useState } from 'react';
import {
  Show,
  SignInButton,
  useAuth as useClerkAuthHook,
  useClerk,
} from '@clerk/react';
import { useSetAuth } from '../DataContext';
import type { AuthProvider } from '../types';
import { AppBackground } from '../../components/ui/AppBackground';
import { LoadingSplash } from '../../components/ui/LoadingSplash';
import { warmApiClientToken } from '../../hooks/useApiClient';
import { DEV_PROXY_RECRUITER_USER_ID } from '../../lib/auth/devProxyAuth';

// ─── ClerkAuthGate ────────────────────────────────────────────────────────────

/**
 * ClerkAuthGate — wraps children behind a Clerk signed-in boundary.
 *
 * Renders a sign-in prompt when the user is unauthenticated.
 * Once authenticated, children are rendered.
 *
 * Drop-in replacement for <AmplifyAuthGate> in App.tsx.
 */
export function ClerkAuthGate({ children }: { children: React.ReactNode }): JSX.Element {
  const [showSplash, setShowSplash] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    // Start fading out after a short delay
    const timer = setTimeout(() => setFadingOut(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!fadingOut) return;
    const timer = setTimeout(() => setShowSplash(false), 600);
    return () => clearTimeout(timer);
  }, [fadingOut]);

  return (
    <>
      <AppBackground />
      {showSplash && <LoadingSplash fadingOut={fadingOut} />}
      <>
        <Show when="signed-out">
          <ClerkSignInScreen />
        </Show>
        <Show when="signed-in">{children}</Show>
      </>
    </>
  );
}

/**
 * ClerkSignInScreen — minimal sign-in prompt styled to match the Pipe design system.
 *
 * Rendered by ClerkAuthGate when the user is not authenticated.
 * Uses Clerk's <SignInButton> to trigger the Clerk-hosted sign-in flow.
 */
function ClerkSignInScreen(): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: '"Space Mono", monospace',
        color: 'var(--pipe-text, #fff)',
        gap: 32,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.3em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 16,
          }}
        >
          PIPE_OS
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}
        >
          RECRUITER ACCESS
        </div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'var(--pipe-text-dim)',
          }}
        >
          Sign in to access your pipeline dashboard
        </div>
      </div>

      <SignInButton mode="modal">
        <button
          data-testid="auth-gate-sign-in"
          style={{
            padding: '16px 40px',
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
            border: '1px solid var(--pipe-border)',
            color: 'var(--pipe-text, #fff)',
            fontSize: 11,
            letterSpacing: '0.2em',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          SIGN IN
        </button>
      </SignInButton>
    </div>
  );
}

// ─── useClerkAuth ─────────────────────────────────────────────────────────────

/**
 * useClerkAuth — builds an AuthProvider snapshot from Clerk's hooks.
 *
 * Must be called inside the <Show when="signed-in"> boundary (i.e. inside
 * ClerkAuthGate) so that Clerk's user state is available.
 */
export function useClerkAuth(): AuthProvider {
  const { isLoaded, userId } = useClerkAuthHook();
  const { getToken } = useClerkAuthHook();
  const { signOut: clerkSignOut } = useClerk();

  // Warm the API client token when userId is available
  useEffect(() => {
    if (!userId) return;
    warmApiClientToken(getToken, userId);
  }, [getToken, userId]);

  return {
    currentUser: userId
      ? {
          userId,
          username: userId,
        }
      : null,
    isLoading: !isLoaded,
    signOut: async (): Promise<void> => {
      await clerkSignOut();
    },
    /**
     * Fetch the current Clerk session token.
     * Returns null on error (e.g. session expired or not loaded).
     */
    getSessionToken: async (): Promise<string | null> => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    },
    /**
     * Synchronously get the current Clerk session token.
     */
    getToken: async (): Promise<string> => {
      const token = await getToken();
      if (!token) {
        throw new Error('No token available');
      }
      return token;
    },
    /**
     * The current user's ID from Clerk.
     */
    userId: userId ?? '',
  };
}

// ─── ClerkAuthWrapper ─────────────────────────────────────────────────────────

/**
 * ClerkAuthWrapper — registers Clerk auth state into PipeProviderRoot.
 *
 * Place this directly inside <ClerkAuthGate> (inside the signed-in boundary)
 * so that Clerk's user hooks resolve correctly.
 *
 * This component has no visual output — it only wires auth state into context.
 *
 * Usage in App.tsx:
 *   <ClerkAuthGate>
 *     <ClerkAuthWrapper>
 *       <Routes>...</Routes>
 *     </ClerkAuthWrapper>
 *   </ClerkAuthGate>
 */
export function ClerkAuthWrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const auth = useClerkAuth();
  const setAuth = useSetAuth();

  useEffect(() => {
    setAuth(auth);
    // Re-register on sign-in, sign-out, and loading transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentUser?.userId, auth.isLoading]);

  return <>{children}</>;
}

export function DevProxyAuthWrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const setAuth = useSetAuth();

  useEffect(() => {
    setAuth({
      currentUser: {
        userId: DEV_PROXY_RECRUITER_USER_ID,
        username: 'PIPE app-dev recruiter',
      },
      isLoading: false,
      signOut: async (): Promise<void> => {},
      getSessionToken: async (): Promise<string | null> => null,
      getToken: async (): Promise<string> => '',
      userId: DEV_PROXY_RECRUITER_USER_ID,
    });
  }, [setAuth]);

  return <>{children}</>;
}
