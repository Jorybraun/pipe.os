/**
 * useChallengeStudio — CRUD operations for the Challenge Studio page.
 *
 * Wraps the challenge-template and template-pack API endpoints with
 * mutation helpers for create, update, publish, delete, and AI refine.
 */

import { useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';
import type { ChallengeTemplateItem, TemplatePackItem } from './useTemplateLibrary';

// ─── Request types ───────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  type: string;
  title: string;
  instructions: string;
  difficulty: string;
  primarySkill: string;
  secondarySkills?: string[];
  bloomLevel?: string | null;
  estimatedMinutes?: number | null;
  config: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  source?: string;
}

export interface UpdateTemplateInput {
  title?: string;
  instructions?: string;
  difficulty?: string;
  primarySkill?: string;
  secondarySkills?: string[];
  bloomLevel?: string | null;
  estimatedMinutes?: number | null;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
}

export interface CreatePackInput {
  name: string;
  description?: string;
  roleType: string;
  seniority: string;
  skills: string[];
  supportedLanguages?: string[];
  items?: Array<{
    challengeTemplateId: string;
    sortOrder: number;
    weight?: number;
    isRequired?: boolean;
  }>;
}

export interface BatchSaveInput {
  challenges: Array<{
    type: string;
    title: string;
    instructions: string;
    difficulty: string;
    primarySkill: string;
    secondarySkills?: string[];
    bloomLevel?: string | null;
    estimatedMinutes?: number | null;
    config: Record<string, unknown>;
  }>;
}

export interface RefineInput {
  challengeTemplateId: string;
  instructions: string;
}

export interface RefinedChallenge {
  type: string;
  title: string;
  instructions: string;
  difficulty: string;
  primarySkill: string;
  secondarySkills: string[];
  bloomLevel: string | null;
  estimatedMinutes: number | null;
  config: Record<string, unknown>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseChallengeStudioResult {
  // Template operations
  createTemplate: (input: CreateTemplateInput) => Promise<ChallengeTemplateItem>;
  updateTemplate: (id: string, input: UpdateTemplateInput) => Promise<ChallengeTemplateItem>;
  publishTemplate: (id: string) => Promise<ChallengeTemplateItem>;
  deleteTemplate: (id: string) => Promise<void>;

  // Pack operations
  createPack: (input: CreatePackInput) => Promise<TemplatePackItem>;
  publishPack: (id: string) => Promise<TemplatePackItem>;
  deletePack: (id: string) => Promise<void>;
  duplicatePack: (id: string) => Promise<TemplatePackItem>;

  // AI operations
  batchSave: (input: BatchSaveInput) => Promise<{ savedIds: string[]; count: number }>;
  refineChallenge: (input: RefineInput) => Promise<RefinedChallenge>;
}

export function useChallengeStudio(): UseChallengeStudioResult {
  const api: ApiClient = useApiClient();

  // ─── Templates ───────────────────────────────────────────────────────────

  const createTemplate = useCallback(
    (input: CreateTemplateInput) =>
      api.post<ChallengeTemplateItem>('/api/v1/challenge-templates', input),
    [api],
  );

  const updateTemplate = useCallback(
    (id: string, input: UpdateTemplateInput) =>
      api.put<ChallengeTemplateItem>(`/api/v1/challenge-templates/${id}`, input),
    [api],
  );

  const publishTemplate = useCallback(
    (id: string) =>
      api.post<ChallengeTemplateItem>(`/api/v1/challenge-templates/${id}/publish`, {}),
    [api],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      await api.del(`/api/v1/challenge-templates/${id}`);
    },
    [api],
  );

  // ─── Packs ───────────────────────────────────────────────────────────────

  const createPack = useCallback(
    (input: CreatePackInput) =>
      api.post<TemplatePackItem>('/api/v1/template-packs', input),
    [api],
  );

  const publishPack = useCallback(
    (id: string) =>
      api.post<TemplatePackItem>(`/api/v1/template-packs/${id}/publish`, {}),
    [api],
  );

  const deletePack = useCallback(
    async (id: string) => {
      await api.del(`/api/v1/template-packs/${id}`);
    },
    [api],
  );

  const duplicatePack = useCallback(
    (id: string) =>
      api.post<TemplatePackItem>(`/api/v1/template-packs/${id}/duplicate`, {}),
    [api],
  );

  // ─── AI operations ───────────────────────────────────────────────────────

  const batchSave = useCallback(
    (input: BatchSaveInput) =>
      api.post<{ savedIds: string[]; count: number }>(
        '/api/v1/challenges/generate/batch-save',
        input,
      ),
    [api],
  );

  const refineChallenge = useCallback(
    async (input: RefineInput) => {
      const result = await api.post<{ refined: RefinedChallenge }>(
        '/api/v1/challenges/generate/refine',
        input,
      );
      return result.refined;
    },
    [api],
  );

  return {
    createTemplate,
    updateTemplate,
    publishTemplate,
    deleteTemplate,
    createPack,
    publishPack,
    deletePack,
    duplicatePack,
    batchSave,
    refineChallenge,
  };
}
