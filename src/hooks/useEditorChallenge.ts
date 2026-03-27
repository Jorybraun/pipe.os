import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ALL_CHALLENGE_TEMPLATES } from '../content/challengeLibrary';
import type { EditorChallenge } from '../components/Editor/types';

const client = generateClient<Schema>();

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseEditorChallengeReturn {
  challenge: EditorChallenge | null;
  setChallenge: (c: EditorChallenge) => void;
  isLoading: boolean;
  isSaving: boolean;
  prFetched: boolean;
  setPrFetched: (v: boolean) => void;
  groundTruthAnnotations: Record<string, unknown[]>;
  setGroundTruthAnnotations: (v: Record<string, unknown[]>) => void;
  handleSave: () => Promise<void>;
  handleClone: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEditorChallenge(
  challengeId: string | undefined,
  pipelineId: string | undefined,
): UseEditorChallengeReturn {
  const navigate = useNavigate();
  const [challenge, setChallengeRaw] = useState<EditorChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [prFetched, setPrFetched] = useState(false);
  const [groundTruthAnnotations, setGroundTruthAnnotations] = useState<Record<string, unknown[]>>({
    senior: [],
    mid: [],
    junior: [],
  });

  const setChallenge = useCallback((c: EditorChallenge) => setChallengeRaw(c), []);

  // -------------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (!challengeId) return;
    try {
      setIsLoading(true);

      // 1. Template library lookup
      const libraryTemplate = ALL_CHALLENGE_TEMPLATES.find(
        (t) => t.id === challengeId,
      );
      if (libraryTemplate) {
        const cfg = (libraryTemplate.config ?? {}) as Record<string, unknown>;
        setChallengeRaw({
          id: libraryTemplate.id,
          type: libraryTemplate.type,
          title: libraryTemplate.title,
          instructions: libraryTemplate.instructions ?? null,
          config: cfg,
          serverConfig: (cfg as Record<string, unknown>).correctOptionId
            ? { correctOptionId: (cfg as Record<string, unknown>).correctOptionId }
            : {},
          isTemplate: true,
        } as EditorChallenge);
        setIsLoading(false);
        return;
      }

      // 2. NEW_ placeholder
      if (challengeId.startsWith('NEW_')) {
        const type = challengeId.replace('NEW_', '');
        setChallengeRaw({
          id: challengeId,
          type,
          title: `New ${type.replace('_', ' ').toLowerCase()}`,
          instructions:
            type === 'CODE_IMPLEMENTATION'
              ? '# Problem\n\nDescribe the task.\n\n## Requirements\n\n- \n\n## Examples\n\n```txt\ninput: \noutput: \n```\n'
              : '',
          config:
            type === 'CODE_IMPLEMENTATION'
              ? { starterCode: "export function solve() {\n  return null;\n}\n", language: 'javascript' }
              : {},
          serverConfig:
            type === 'CODE_IMPLEMENTATION'
              ? { testCode: "import { solve } from './starter';\n\nassert.equal(solve(), null, 'stub should return null');\n", testLanguage: 'javascript' }
              : {},
          isNew: true,
        });
        setIsLoading(false);
        return;
      }

      // 3. Fetch from DB
      const { data } = await client.models.Challenge.get({ id: challengeId });
      if (data) {
        const parsedConfig =
          typeof data.config === 'string' ? JSON.parse(data.config) : data.config || {};
        const parsedServerConfig =
          typeof data.serverConfig === 'string' ? JSON.parse(data.serverConfig) : data.serverConfig || {};

        setChallengeRaw({
          ...(data as unknown as Record<string, unknown>),
          config: parsedConfig as Record<string, unknown>,
          serverConfig: parsedServerConfig as Record<string, unknown>,
        } as EditorChallenge);

        if (data.groundTruthAnnotations) {
          const parsed =
            typeof data.groundTruthAnnotations === 'string'
              ? JSON.parse(data.groundTruthAnnotations)
              : data.groundTruthAnnotations;
          setGroundTruthAnnotations(parsed as Record<string, unknown[]>);
        }

        if (data.type === 'CODE_REVIEW' && data.githubRepoUrl && data.githubPrNumber) {
          setPrFetched(true);
        }
      }
    } catch (err) {
      console.error('[useEditorChallenge] fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!challenge) return;
    setIsSaving(true);
    try {
      const updateParams: Record<string, unknown> = {
        title: challenge.title,
        instructions: challenge.instructions,
        config: JSON.stringify(challenge.config || {}),
        serverConfig: JSON.stringify(challenge.serverConfig || {}),
      };

      if (challenge.type === 'CODE_REVIEW' && challenge.githubRepoUrl) {
        updateParams.githubRepoUrl = challenge.githubRepoUrl;
        updateParams.githubPrNumber = challenge.githubPrNumber;
        updateParams.githubPrTitle = challenge.githubPrTitle;
        updateParams.githubPrDescription = challenge.githubPrDescription;
        updateParams.cachedDiffJson =
          typeof challenge.cachedDiffJson === 'string'
            ? challenge.cachedDiffJson
            : JSON.stringify(challenge.cachedDiffJson);
        updateParams.cachedMetadata =
          typeof challenge.cachedMetadata === 'string'
            ? challenge.cachedMetadata
            : JSON.stringify(challenge.cachedMetadata);
        updateParams.diffCachedAt = new Date().toISOString();
        updateParams.groundTruthAnnotations = JSON.stringify(groundTruthAnnotations);
      }

      const isTemplate = challenge.isTemplate;
      const isNew = challenge.isNew || challenge.id.startsWith('NEW_');

      if (isTemplate || isNew) {
        let stageId = challenge.stageId;

        if (!stageId && pipelineId) {
          const { data: stages } = await client.models.Stage.list({
            filter: { pipelineId: { eq: pipelineId } },
          });
          if (stages && stages.length > 0 && stages[0]) {
            stageId = stages[0].id;
          }
        }

        if (!stageId) throw new Error('Cannot save challenge without a stage ID.');

        const challengeOrder = challenge.order ?? 0;
        const { data: newChallenge } = await client.models.Challenge.create({
          ...updateParams,
          stageId,
          type: challenge.type,
          order: challengeOrder,
        } as Parameters<typeof client.models.Challenge.create>[0]);

        // Auto-create FOLLOW_UP challenge if enabled
        if (challenge.config?.enableFollowUp && stageId) {
          try {
            await client.models.Challenge.create({
              stageId,
              type: 'FOLLOW_UP',
              title: 'Follow-Up Questions',
              instructions: 'AI-generated follow-up questions based on your previous response.',
              config: JSON.stringify({}),
              serverConfig: JSON.stringify({}),
              order: challengeOrder + 1,
            });
          } catch (err) {
            console.warn('[useEditorChallenge] Failed to create follow-up:', err);
          }
        }

        if (newChallenge?.id) {
          navigate(`/pipeline/${pipelineId}/challenges/${newChallenge.id}`, { replace: true });
        }
      } else {
        await client.models.Challenge.update({
          id: challenge.id,
          ...updateParams,
        } as Parameters<typeof client.models.Challenge.update>[0]);

        // Auto-create FOLLOW_UP if newly enabled
        if (challenge.config?.enableFollowUp && challenge.stageId) {
          const { data: siblings } = await client.models.Challenge.list({
            filter: { stageId: { eq: challenge.stageId } },
          });
          const hasFollowUp = siblings?.some(
            (c) => c.type === 'FOLLOW_UP' && (c.order ?? 0) > (challenge.order ?? 0),
          );
          if (!hasFollowUp) {
            try {
              await client.models.Challenge.create({
                stageId: challenge.stageId,
                type: 'FOLLOW_UP',
                title: 'Follow-Up Questions',
                instructions: 'AI-generated follow-up questions based on your previous response.',
                config: JSON.stringify({}),
                serverConfig: JSON.stringify({}),
                order: (challenge.order ?? 0) + 1,
              });
            } catch (err) {
              console.warn('[useEditorChallenge] Failed to create follow-up:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error('[useEditorChallenge] save error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [challenge, groundTruthAnnotations, pipelineId, navigate]);

  // -------------------------------------------------------------------------
  // Clone
  // -------------------------------------------------------------------------

  const handleClone = useCallback(async () => {
    if (!challenge) return;
    setIsSaving(true);
    try {
      const cloneParams: Record<string, unknown> = {
        title: `${challenge.title} (Clone)`,
        instructions: challenge.instructions,
        config: JSON.stringify(challenge.config || {}),
        serverConfig: JSON.stringify(challenge.serverConfig || {}),
        stageId: challenge.stageId,
        type: challenge.type,
        order: (challenge.order ?? 0) + 1,
      };

      if (challenge.type === 'CODE_REVIEW') {
        cloneParams.githubRepoUrl = challenge.githubRepoUrl;
        cloneParams.githubPrNumber = challenge.githubPrNumber;
        cloneParams.githubPrTitle = challenge.githubPrTitle;
        cloneParams.githubPrDescription = challenge.githubPrDescription;
        cloneParams.cachedDiffJson =
          typeof challenge.cachedDiffJson === 'string'
            ? challenge.cachedDiffJson
            : JSON.stringify(challenge.cachedDiffJson);
        cloneParams.cachedMetadata =
          typeof challenge.cachedMetadata === 'string'
            ? challenge.cachedMetadata
            : JSON.stringify(challenge.cachedMetadata);
        cloneParams.diffCachedAt = new Date().toISOString();
        cloneParams.groundTruthAnnotations = JSON.stringify(groundTruthAnnotations);
      }

      const { data: newChallenge } = await client.models.Challenge.create(
        cloneParams as Parameters<typeof client.models.Challenge.create>[0],
      );
      if (newChallenge) {
        navigate(`/pipeline/${pipelineId}/challenges/${newChallenge.id}`, { replace: true });
      }
    } catch (err) {
      console.error('[useEditorChallenge] clone error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [challenge, groundTruthAnnotations, pipelineId, navigate]);

  return {
    challenge,
    setChallenge,
    isLoading,
    isSaving,
    prFetched,
    setPrFetched,
    groundTruthAnnotations,
    setGroundTruthAnnotations,
    handleSave,
    handleClone,
  };
}
