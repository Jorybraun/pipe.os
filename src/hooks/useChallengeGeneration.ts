/**
 * useChallengeGeneration — calls the CA Phase 3 generation pipeline.
 *
 * Wraps POST /api/v1/challenges/generate with loading/error state.
 * Returns generated challenges with confidence scores for the wizard UI.
 */

import { useState, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';

// ─── Types (mirror backend GenerationPipelineResult) ─────────────────────────

export interface ConfidenceScores {
  topicRelevance: number;
  roleFit: number;
  clarity: number;
}

export interface GeneratedChallengeItem {
  challenge: {
    type: string;
    title: string;
    instructions: string;
    difficulty: string;
    primarySkill: string;
    secondarySkills: string[];
    bloomLevel: string;
    estimatedMinutes: number;
    config: Record<string, unknown>;
    reasoning: string;
  };
  confidence: ConfidenceScores;
  issues: string[];
  calibrationWarnings: string[];
}

export interface GenerationResult {
  challenges: GeneratedChallengeItem[];
  totalGenerated: number;
  totalRejected: number;
  models: {
    generator: string;
    contentReviewer: string;
    linguisticEvaluator: string;
    difficultyCalibrator: string;
  };
}

export interface GenerationConfig {
  roleContextId?: string;
  types?: string[];
  count?: number;
  seniority?: string;
}

export interface UseChallengeGenerationResult {
  generate: (config: GenerationConfig) => Promise<GenerationResult | null>;
  result: GenerationResult | null;
  isGenerating: boolean;
  error: string | null;
  reset: () => void;
  /** Remove a challenge from results by index (used by REMOVE button). */
  removeChallenge: (index: number) => void;
}

export function useChallengeGeneration(): UseChallengeGenerationResult {
  const api: ApiClient = useApiClient();
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (config: GenerationConfig): Promise<GenerationResult | null> => {
      setIsGenerating(true);
      setError(null);
      setResult(null);

      try {
        const data = await api.post<GenerationResult>(
          '/api/v1/challenges/generate',
          config,
        );
        setResult(data);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed';
        setError(message);
        console.error('[useChallengeGeneration] Generation failed:', err);
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [api],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const removeChallenge = useCallback((index: number) => {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        challenges: prev.challenges.filter((_, i) => i !== index),
      };
    });
  }, []);

  return { generate, result, isGenerating, error, reset, removeChallenge };
}
