/**
 * SessionTokenContext — provides the JWT session token to candidate-facing components.
 *
 * After resolveToken issues a sessionToken, CandidateAssessmentPage stores it here.
 * Any component that makes candidate-authenticated API calls reads it via useSessionToken().
 */

import { createContext, useContext } from 'react';

const SessionTokenContext = createContext<string | null>(null);

export const SessionTokenProvider = SessionTokenContext.Provider;

export function useSessionToken(): string | null {
  return useContext(SessionTokenContext);
}
