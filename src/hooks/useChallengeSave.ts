/**
 * useChallengeSave
 *
 * Provides save and clone actions for the ChallengeEditorPage.
 * All writes go through the Worker API — zero aws-amplify.
 *
 * save(challengeId, challenge, stageId):
 *   - Existing challenge: PUT /api/v1/challenges/:id
 *   - New challenge (NEW_* or isNew): POST /api/v1/stages/:stageId/challenges
 *   Returns the final challenge ID (useful for URL navigation after creation).
 *
 * clone(challengeId):
 *   - POST /api/v1/challenges/:id/clone
 *   Returns { id, title, type, stageId, pipelineId }
 */

import { useState, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { EditorChallenge } from '../components/Editor/types';

// ─── Request body types ────────────────────────────────────────────────────────

interface CreateChallengeBody {
  type: string;
  title: string;
  order: number;
  instructions?: string | null;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  githubRepoUrl?: string;
  githubPrNumber?: number;
  githubPrTitle?: string;
  githubPrDescription?: string;
  cachedDiffJson?: unknown;
  cachedMetadata?: unknown;
}

interface UpdateChallengeBody {
  title?: string;
  instructions?: string | null;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
  githubPrTitle?: string | null;
  githubPrDescription?: string | null;
  cachedDiffJson?: unknown;
  cachedMetadata?: unknown;
  diffCachedAt?: string | null;
  groundTruthAnnotations?: unknown;
}

// ─── Response types ────────────────────────────────────────────────────────────

interface CreateResponse {
  data?: { id: string };
  id?: string;
}

interface CloneResponse {
  id: string;
  title: string;
  type: string;
  stageId: string;
  pipelineId: string;
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseChallengeSaveReturn {
  /** Returns the final challenge ID. May navigate if a new challenge was created. */
  save: (
    challengeId: string,
    challenge: EditorChallenge,
    stageId: string | undefined,
    groundTruthAnnotations?: Record<string, unknown[]>,
  ) => Promise<string | null>;
  /** Clone the challenge. Returns the new challenge's metadata. */
  clone: (challengeId: string, newId?: string) => Promise<CloneResponse | null>;
  isSaving: boolean;
  error: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChallengeSave(): UseChallengeSaveReturn {
  const api = useApiClient();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (
      challengeId: string,
      challenge: EditorChallenge,
      stageId: string | undefined,
      groundTruthAnnotations?: Record<string, unknown[]>,
    ): Promise<string | null> => {
      setIsSaving(true);
      setError(null);

      try {
        const isNew = challengeId.startsWith('NEW_') || !!challenge.isNew || !!challenge.isTemplate;

        if (isNew) {
          // POST /api/v1/stages/:stageId/challenges
          if (!stageId) throw new Error('Cannot create a challenge without a stageId.');

          const body: CreateChallengeBody = {
            type: challenge.type,
            title: challenge.title || `New ${challenge.type.toLowerCase().replace(/_/g, ' ')}`,
            order: challenge.order ?? 0,
            instructions: challenge.instructions ?? null,
            config: challenge.config ?? {},
            serverConfig: challenge.serverConfig ?? {},
          };

          if (challenge.type === 'CODE_REVIEW') {
            if (challenge.githubRepoUrl) body.githubRepoUrl = challenge.githubRepoUrl;
            if (challenge.githubPrNumber) body.githubPrNumber = challenge.githubPrNumber;
            if (challenge.githubPrTitle) body.githubPrTitle = challenge.githubPrTitle;
            if (challenge.githubPrDescription) body.githubPrDescription = challenge.githubPrDescription;
            if (challenge.cachedDiffJson) body.cachedDiffJson = challenge.cachedDiffJson;
            if (challenge.cachedMetadata) body.cachedMetadata = challenge.cachedMetadata;
          }

          const res = await api.post<CreateResponse>(
            `/api/v1/stages/${stageId}/challenges`,
            body,
          );

          return res.data?.id ?? res.id ?? null;
        } else {
          // PUT /api/v1/challenges/:id
          const body: UpdateChallengeBody = {
            title: challenge.title,
            instructions: challenge.instructions ?? null,
            config: challenge.config ?? {},
            serverConfig: challenge.serverConfig ?? {},
          };

          if (challenge.type === 'CODE_REVIEW') {
            body.githubRepoUrl = challenge.githubRepoUrl ?? null;
            body.githubPrNumber = challenge.githubPrNumber ?? null;
            body.githubPrTitle = challenge.githubPrTitle ?? null;
            body.githubPrDescription = challenge.githubPrDescription ?? null;
            body.cachedDiffJson = challenge.cachedDiffJson;
            body.cachedMetadata = challenge.cachedMetadata;
            body.diffCachedAt = challenge.diffCachedAt ?? null;
            if (groundTruthAnnotations) {
              body.groundTruthAnnotations = groundTruthAnnotations;
            }
          }

          await api.put(`/api/v1/challenges/${challengeId}`, body);
          return challengeId;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save challenge';
        console.error('[useChallengeSave] save error:', err);
        setError(message);
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [api],
  );

  const clone = useCallback(
    async (challengeId: string, newId?: string): Promise<CloneResponse | null> => {
      setIsSaving(true);
      setError(null);

      try {
        const res = await api.post<CloneResponse>(
          `/api/v1/challenges/${challengeId}/clone`,
          newId ? { newId } : {},
        );
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to clone challenge';
        console.error('[useChallengeSave] clone error:', err);
        setError(message);
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [api],
  );

  return { save, clone, isSaving, error };
}
