/**
 * useCandidateProfile — fetches the full candidate profile from the Worker API.
 *
 * Returns candidate metadata, stages, challenges, and all submissions in a
 * single round-trip to GET /api/v1/candidates/:id.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type {
  CandidateProfileResponse,
  CandidateProfileRecord,
  ProfileStage,
  PhoneCallRecord,
} from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UseCandidateProfileResult {
  candidate: CandidateProfileRecord | null;
  stages: ProfileStage[];
  phoneCalls: PhoneCallRecord[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  updateSubmissionScore: (submissionId: string, score: number) => Promise<void>;
  updateSubmissionFeedback: (submissionId: string, feedback: string) => Promise<void>;
}

/**
 * Fetches the candidate profile for the given candidate ID.
 * Performs optimistic updates for score and feedback changes.
 *
 * @param candidateId - The candidate ID from the URL param.
 */
export function useCandidateProfile(
  candidateId: string | undefined,
): UseCandidateProfileResult {
  const { getToken } = useClerkAuth();

  const [candidate, setCandidate] = useState<CandidateProfileRecord | null>(null);
  const [stages, setStages] = useState<ProfileStage[]>([]);
  const [phoneCalls, setPhoneCalls] = useState<PhoneCallRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(async (): Promise<void> => {
    if (!candidateId) return;

    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    try {
      const data = await api.get<CandidateProfileResponse>(
        `/api/v1/candidates/${candidateId}`,
      );
      setCandidate(data.candidate);
      setStages(data.stages);
      setPhoneCalls(data.phoneCalls ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[useCandidateProfile] API error:', err.code, err.message);
        setError(new Error(err.message));
      } else {
        const message =
          err instanceof Error ? err.message : 'Failed to load candidate profile';
        console.error('[useCandidateProfile] Unexpected error:', message);
        setError(new Error(message));
      }
    } finally {
      setIsLoading(false);
    }
  }, [candidateId, getToken]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  /** Optimistically update a submission score, then persist to the API. */
  const updateSubmissionScore = useCallback(
    async (submissionId: string, score: number): Promise<void> => {
      // Optimistic update
      setStages((prev) =>
        prev.map((stage) => ({
          ...stage,
          challenges: stage.challenges.map((ch) =>
            ch.submission?.id === submissionId
              ? { ...ch, submission: { ...ch.submission, score } }
              : ch,
          ),
        })),
      );

      const api = createApiClient({ getToken });
      try {
        await api.patch(`/api/v1/challenge-submissions/${submissionId}`, { score });
      } catch (err) {
        console.error('[useCandidateProfile] Score update failed:', err);
        // Revert by refetching
        void fetchProfile();
      }
    },
    [getToken, fetchProfile],
  );

  /** Optimistically update submission feedback, then persist to the API. */
  const updateSubmissionFeedback = useCallback(
    async (submissionId: string, feedback: string): Promise<void> => {
      // Optimistic update
      setStages((prev) =>
        prev.map((stage) => ({
          ...stage,
          challenges: stage.challenges.map((ch) =>
            ch.submission?.id === submissionId
              ? { ...ch, submission: { ...ch.submission, feedback } }
              : ch,
          ),
        })),
      );

      const api = createApiClient({ getToken });
      try {
        await api.patch(`/api/v1/challenge-submissions/${submissionId}`, { feedback });
      } catch (err) {
        console.error('[useCandidateProfile] Feedback update failed:', err);
        // Revert by refetching
        void fetchProfile();
      }
    },
    [getToken, fetchProfile],
  );

  return {
    candidate,
    stages,
    phoneCalls,
    isLoading,
    error,
    refetch: fetchProfile,
    updateSubmissionScore,
    updateSubmissionFeedback,
  };
}
