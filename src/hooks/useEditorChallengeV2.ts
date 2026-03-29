/**
 * useEditorChallengeV2
 *
 * Replaces useEditorChallenge for the Cloudflare-migrated ChallengeEditorPage.
 * All data comes from the Worker API (/api/v1/challenges/:id) — zero aws-amplify.
 *
 * Handles:
 *   - Existing challenges: fetched via GET /api/v1/challenges/:id
 *   - NEW_* routes: returns a blank template of the correct type, no API call
 *   - isNew flag propagated to caller so save uses POST instead of PUT
 */

import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApiClient } from './useApiClient';
import { ApiError } from '../lib/api/types';
import type { EditorChallenge } from '../components/Editor/types';

// ─── Challenge type templates ─────────────────────────────────────────────────

const CODE_IMPL_TEMPLATE: Partial<EditorChallenge> = {
  instructions:
    '# Problem\n\nDescribe the task.\n\n## Requirements\n\n- \n\n## Examples\n\n```txt\ninput: \noutput: \n```\n',
  config: {
    starterCode: 'export function solve() {\n  return null;\n}\n',
    language: 'javascript',
  },
  serverConfig: {
    testCode:
      "import { solve } from './starter';\n\nassert.equal(solve(), null, 'stub should return null');\n",
    testLanguage: 'javascript',
  },
};

const QUIZ_MCQ_TEMPLATE: Partial<EditorChallenge> = {
  instructions: '',
  config: {
    question: '',
    options: [
      { id: 'a', text: '' },
      { id: 'b', text: '' },
    ],
  },
  serverConfig: {
    correctOptionId: 'a',
    options: [],
  },
};

const QUIZ_SHORT_ANSWER_TEMPLATE: Partial<EditorChallenge> = {
  instructions: '',
  config: { question: '' },
  serverConfig: { sampleAnswer: '' },
};

const CODE_REVIEW_TEMPLATE: Partial<EditorChallenge> = {
  instructions: '',
  config: {},
  serverConfig: {},
};

function getBlankTemplate(type: string): Partial<EditorChallenge> {
  switch (type) {
    case 'CODE_IMPLEMENTATION':
      return CODE_IMPL_TEMPLATE;
    case 'QUIZ_MCQ':
      return QUIZ_MCQ_TEMPLATE;
    case 'QUIZ_SHORT_ANSWER':
      return QUIZ_SHORT_ANSWER_TEMPLATE;
    case 'CODE_REVIEW':
      return CODE_REVIEW_TEMPLATE;
    default:
      return { instructions: '', config: {}, serverConfig: {} };
  }
}

// ─── API response type ────────────────────────────────────────────────────────

interface ChallengeApiData {
  id: string;
  stageId: string;
  pipelineId: string;
  type: string;
  title: string;
  instructions: string | null;
  order: number;
  config: Record<string, unknown>;
  serverConfig: Record<string, unknown>;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
  githubPrTitle?: string | null;
  githubPrDescription?: string | null;
  cachedDiffJson?: Record<string, unknown> | null;
  cachedMetadata?: Record<string, unknown> | null;
  diffCachedAt?: string | null;
  groundTruthAnnotations?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseEditorChallengeV2Return {
  challenge: EditorChallenge | null;
  setChallenge: (c: EditorChallenge) => void;
  isLoading: boolean;
  isNew: boolean;
  error: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Load a challenge for the editor.
 *
 * @param challengeId — real ID or "NEW_<TYPE>" sentinel
 * @param pipelineId  — owning pipeline (for navigation, not fetching)
 */
interface LocationState {
  pendingTitle?: string;
  cloneOf?: string;
}

export function useEditorChallengeV2(
  challengeId: string | undefined,
  pipelineId: string | undefined,
): UseEditorChallengeV2Return {
  const api = useApiClient();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const pendingTitle = locationState?.pendingTitle;
  const cloneOf = locationState?.cloneOf;

  const [challenge, setChallengeRaw] = useState<EditorChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setChallenge = useCallback((c: EditorChallenge) => setChallengeRaw(c), []);

  const fetchChallenge = useCallback(async () => {
    if (!challengeId) {
      setIsLoading(false);
      return;
    }

    // Handle NEW_* sentinel — no API call, return a blank template.
    if (challengeId.startsWith('NEW_')) {
      const type = challengeId.replace(/^NEW_/, '');
      const template = getBlankTemplate(type);
      setChallengeRaw({
        id: challengeId,
        type,
        title: '',
        isNew: true,
        stageId: undefined,
        ...template,
        config: template.config ?? {},
        serverConfig: template.serverConfig ?? {},
        instructions: template.instructions ?? null,
      } as EditorChallenge);
      setIsNew(true);
      setIsLoading(false);
      return;
    }

    // If navigating optimistically after a clone, show pending title immediately
    // while we wait for the clone API to finish creating the record.
    if (pendingTitle) {
      setChallengeRaw({
        id: challengeId,
        type: 'CODE_IMPLEMENTATION',
        title: pendingTitle,
        isNew: false,
        isTemplate: false,
        config: {},
        serverConfig: {},
        instructions: null,
      } as EditorChallenge);
    }

    // Fetch from Worker API. If this is an optimistic clone navigation, retry on
    // 404 up to 8 times (4 seconds) while the clone POST completes in the background.
    const maxRetries = cloneOf ? 8 : 0;
    setIsLoading(true);
    setError(null);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      try {
        const data = await api.get<ChallengeApiData>(`/api/v1/challenges/${challengeId}`);

        setChallengeRaw({
          id: data.id,
          type: data.type,
          title: data.title,
          instructions: data.instructions ?? null,
          config: data.config ?? {},
          serverConfig: data.serverConfig ?? {},
          order: data.order,
          stageId: data.stageId,
          isNew: false,
          isTemplate: false,
          githubRepoUrl: data.githubRepoUrl ?? undefined,
          githubPrNumber: data.githubPrNumber ?? undefined,
          githubPrTitle: data.githubPrTitle ?? undefined,
          githubPrDescription: data.githubPrDescription ?? undefined,
          cachedDiffJson: data.cachedDiffJson ?? undefined,
          cachedMetadata: data.cachedMetadata ?? undefined,
          diffCachedAt: data.diffCachedAt ?? undefined,
        });
        setIsNew(false);
        setIsLoading(false);
        return;
      } catch (err) {
        // Retry on 404 while waiting for optimistic clone to be persisted.
        if (cloneOf && err instanceof ApiError && err.status === 404 && attempt < maxRetries) {
          continue;
        }
        const message = err instanceof Error ? err.message : 'Failed to load challenge';
        console.error('[useEditorChallengeV2] fetch error:', err);
        setError(message);
        setIsLoading(false);
        return;
      }
    }
  }, [challengeId, api, pendingTitle, cloneOf]);

  useEffect(() => {
    void fetchChallenge();
  }, [fetchChallenge]);

  // When pipelineId changes and we have a NEW_ challenge, surface pipelineId via challenge if needed.
  // The stageId comes from the URL query param; ChallengeEditorPage reads it directly.
  void pipelineId; // referenced by caller, suppress lint unused var

  return { challenge, setChallenge, isLoading, isNew, error };
}
