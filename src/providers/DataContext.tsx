/**
 * PipeProviderRoot + context hooks.
 *
 * Wrap the app in <PipeProviderRoot providers={...}> once at startup.
 * Consumer components and hooks call useData(), useStorage(), useAuth()
 * without any knowledge of the underlying provider implementation.
 *
 * Auth note: the `auth` slot is optional at the root because ClerkAuthWrapper
 * registers it from inside the signed-in boundary. useAuth() returns a loading
 * stub until auth is wired in.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import type {
  DataProviderFactory,
  StorageProvider,
  AuthProvider,
  PipeProviders,
} from './types';

interface PipeContextValue extends PipeProviders {
  /** Internal — fills the auth slot from inside the Authenticator boundary. */
  setAuth: (auth: AuthProvider) => void;
}

const PipeProviderContext = createContext<PipeContextValue | null>(null);

/**
 * PipeProviderRoot — single configuration point for all provider implementations.
 *
 * Place this as high as possible in the React tree, above any route or
 * auth boundary that needs to access providers.
 *
 * The `auth` slot in `providers` is optional here; it is filled by
 * ClerkAuthWrapper from inside the signed-in boundary.
 */
export function PipeProviderRoot({
  providers,
  children,
}: {
  providers: PipeProviders;
  children: React.ReactNode;
}): JSX.Element {
  const [auth, setAuthState] = useState<AuthProvider | undefined>(providers.auth);

  const setAuth = useCallback((authProvider: AuthProvider) => {
    setAuthState(authProvider);
  }, []);

  // Construct value explicitly to satisfy exactOptionalPropertyTypes:
  // auth must be omitted (not set to undefined) when not yet available.
  const value: PipeContextValue = auth !== undefined
    ? { data: providers.data, storage: providers.storage, auth, setAuth }
    : { data: providers.data, storage: providers.storage, setAuth };

  return (
    <PipeProviderContext.Provider value={value}>
      {children}
    </PipeProviderContext.Provider>
  );
}

/**
 * useData — returns the DataProviderFactory.
 *
 * Call factory methods to get a DataProvider with the appropriate auth mode:
 *   const client = useData().createClient();          // recruiter (userPool)
 *   const client = useData().createPublicClient();     // candidate (apiKey)
 *   const client = useData().createSessionClient(tok); // candidate (lambda JWT)
 *
 * Must be called within a component tree wrapped by <PipeProviderRoot>.
 */
export function useData(): DataProviderFactory {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useData must be used within PipeProviderRoot');
  return ctx.data;
}

/**
 * useStorage — returns the StorageProvider.
 *
 * Must be called within a component tree wrapped by <PipeProviderRoot>.
 */
export function useStorage(): StorageProvider {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useStorage must be used within PipeProviderRoot');
  return ctx.storage;
}

/**
 * useAuth — returns the AuthProvider.
 *
 * Must be called within a component tree wrapped by <PipeProviderRoot>
 * and within an auth boundary (e.g. inside <ClerkAuthWrapper>).
 */
export function useAuth(): AuthProvider {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useAuth must be used within PipeProviderRoot');
  // Return a loading stub if auth isn't wired in yet (first render before useEffect fires)
  if (!ctx.auth) {
    return {
      currentUser: null,
      isLoading: true,
      signOut: async () => {},
      getSessionToken: async () => null,
      getToken: async () => '',
      userId: '',
    };
  }
  return ctx.auth;
}

/**
 * Internal hook — used by ClerkAuthWrapper to fill the auth slot.
 * Not exported from the providers barrel; only used by auth implementations.
 */
export function useSetAuth(): (auth: AuthProvider) => void {
  const ctx = useContext(PipeProviderContext);
  if (!ctx) throw new Error('useSetAuth must be used within PipeProviderRoot');
  return ctx.setAuth;
}
