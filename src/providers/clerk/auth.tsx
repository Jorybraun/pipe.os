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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAuth as useClerkAuthState,
  SignInButton,
  useClerk,
} from '@clerk/react';
import { useSetAuth } from '../DataContext';
import type { AuthProvider } from '../types';
import { AppBackground } from '../../components/ui/AppBackground';
import { LoadingSplash } from '../../components/ui/LoadingSplash';
import { warmApiClientToken } from '../../hooks/useApiClient';

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
  const [showAuthFallback, setShowAuthFallback] = useState(false);

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

  const auth = useClerkAuth();

  useEffect(() => {
    if (!auth.isLoading) {
      setShowAuthFallback(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowAuthFallback(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [auth.isLoading]);

  if (auth.isLoading && !showAuthFallback) {
    return (
      <>
        <AppBackground />
        {showSplash && <LoadingSplash fadingOut={fadingOut} />}
      </>
    );
  }

  return (
    <>
      <AppBackground />
      {showSplash && <LoadingSplash fadingOut={fadingOut} />}
      {auth.currentUser ? children : <ClerkSignInScreen />}
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
 * Internal to the Clerk auth implementation; only ClerkAuthGate calls this.
 * Consumer code must use `useAuth()` from the providers barrel.
 */
function useClerkAuth(): AuthProvider {
  const clerk = useClerk();
  const clerkAuth = useClerkAuthState();
  const userId = clerkAuth.userId ?? '';
  const isLoaded = clerkAuth.isLoaded;

  const signOut = useCallback(async (): Promise<void> => {
    await clerk.signOut();
  }, [clerk]);

  const getSessionToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await clerkAuth.getToken();
      return token ?? null;
    } catch {
      return null;
    }
  }, [clerkAuth]);

  const getToken = useCallback(async (): Promise<string> => {
    const token = await clerkAuth.getToken();
    if (!token) {
      throw new Error('No token available');
    }
    return token;
  }, [clerkAuth]);

  // Warm the API client token when userId is available
  useEffect(() => {
    if (!userId) return;
    warmApiClientToken(getSessionToken, userId);
  }, [getSessionToken, userId]);

  return useMemo(
    () => ({
      currentUser: userId
        ? {
            userId,
            username: userId,
          }
        : null,
      isLoading: !isLoaded,
      signOut,
      getSessionToken,
      getToken,
      userId,
    }),
    [userId, isLoaded, signOut, getSessionToken, getToken],
  );
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
  const setAuth = useSetAuth();
  const lastAuthKey = useRef('');
  const clerk = useClerk();
  const clerkAuth = useClerkAuthState();
  const userId = clerkAuth.userId ?? '';
  const isLoaded = clerkAuth.isLoaded;
  const isSignedIn = clerkAuth.isSignedIn;

  const signOut = useCallback(async (): Promise<void> => {
    await clerk.signOut();
  }, [clerk]);

  const getSessionToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await clerkAuth.getToken();
      return token ?? null;
    } catch {
      return null;
    }
  }, [clerkAuth]);

  const getToken = useCallback(async (): Promise<string> => {
    const token = await clerkAuth.getToken();
    if (!token) {
      throw new Error('No token available');
    }
    return token;
  }, [clerkAuth]);

  const newAuth: AuthProvider | null = useMemo(() => {
    if (!isLoaded || !isSignedIn) return null;
    return {
      currentUser: userId
        ? {
            userId,
            username: userId,
          }
        : null,
      isLoading: !isLoaded,
      signOut,
      getSessionToken,
      getToken,
      userId,
    };
  }, [isLoaded, isSignedIn, userId, signOut, getSessionToken, getToken]);

  useEffect(() => {
    if (!newAuth) return;
    const authKey = `${newAuth.userId}|${String(newAuth.isLoading)}`;
    if (lastAuthKey.current === authKey) return;
    lastAuthKey.current = authKey;
    setAuth(newAuth);
  }, [newAuth, setAuth]);

  return <>{children}</>;
}
