/**
 * Amplify auth implementations.
 *
 * AmplifyAuthGate — drop-in replacement for <Authenticator> in App.tsx.
 *   Renders children only when the user is authenticated.
 *
 * AmplifyAuthWrapper — must be placed INSIDE <AmplifyAuthGate>.
 *   Reads from useAuthenticator and registers the AuthProvider into
 *   PipeProviderRoot via the internal useSetAuth hook.
 *   This bridges the Amplify auth boundary with the provider context.
 *
 * useAmplifyAuth — hook that builds an AuthProvider from useAuthenticator.
 *   Used internally by AmplifyAuthWrapper.
 *
 * Consumer code accesses auth state via useAuth() from 'providers', not here.
 */

import { useEffect } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useSetAuth } from '../DataContext';
import type { AuthProvider } from '../types';

/**
 * AmplifyAuthGate — wraps children in the Amplify Authenticator boundary.
 *
 * Renders the Amplify sign-in UI when the user is unauthenticated.
 * Once authenticated, children are rendered.
 *
 * Drop-in replacement for the current <Authenticator> usage in App.tsx.
 */
export function AmplifyAuthGate({ children }: { children: React.ReactNode }): JSX.Element {
  return <Authenticator>{children}</Authenticator>;
}

/**
 * useAmplifyAuth — builds an AuthProvider snapshot from useAuthenticator.
 *
 * Must be called inside the Authenticator boundary.
 */
export function useAmplifyAuth(): AuthProvider {
  const { user, signOut, authStatus } = useAuthenticator();

  const loginId = user?.signInDetails?.loginId;

  return {
    currentUser: user
      ? {
          userId: user.userId,
          username: user.username,
          ...(loginId !== undefined ? { email: loginId } : {}),
        }
      : null,
    isLoading: authStatus === 'configuring',
    signOut: async (): Promise<void> => signOut(),
    /**
     * Fetch the Cognito access token from the current session.
     * Returns null on error (e.g. session expired).
     */
    getSessionToken: async (): Promise<string | null> => {
      try {
        const session = await fetchAuthSession();
        return session.tokens?.accessToken?.toString() ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * AmplifyAuthWrapper — registers Amplify auth state into PipeProviderRoot.
 *
 * Place this directly inside <AmplifyAuthGate> (inside the Authenticator
 * boundary) so that useAuthenticator is available.
 *
 * This component has no visual output — it only wires auth state into context.
 *
 * Usage in App.tsx (after Phase 0C migration):
 *   <AmplifyAuthGate>
 *     <AmplifyAuthWrapper>
 *       <Routes>...</Routes>
 *     </AmplifyAuthWrapper>
 *   </AmplifyAuthGate>
 */
export function AmplifyAuthWrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const auth = useAmplifyAuth();
  const setAuth = useSetAuth();

  useEffect(() => {
    setAuth(auth);
    // Re-register when auth state changes (sign in / sign out / loading transitions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.currentUser?.userId, auth.isLoading]);

  return <>{children}</>;
}
