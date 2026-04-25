/**
 * CandidateIdContext — provides candidateId + stageId to deep components.
 *
 * Used by VideoInterviewStep to compute the deterministic DO session ID
 * without making a server call. Provided by CandidateAssessmentPage.
 */

import { createContext, useContext } from 'react';

interface CandidateIds {
  candidateId: string;
  stageId: string;
}

const CandidateIdContext = createContext<CandidateIds | null>(null);

export const CandidateIdProvider = CandidateIdContext.Provider;

export function useCandidateId(): CandidateIds | null {
  return useContext(CandidateIdContext);
}
