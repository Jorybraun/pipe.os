/**
 * useTemplateLibrary — fetch challenge templates and template packs
 * from the CA Phase 1 API routes (ADR-034).
 *
 * Exposes:
 *   templates     — filtered list of challenge templates
 *   packs         — filtered list of template packs
 *   packDetail    — single pack with expanded challenges
 *   isLoading     — loading state
 *   error         — error message
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';

// ─── Response types (mirrors worker types) ──────────────────────────────────

export type TemplateType = 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';
export type TemplateDifficulty = 'JUNIOR' | 'MID' | 'SENIOR';
export type PackRoleType = 'FRONTEND' | 'BACKEND' | 'FULLSTACK' | 'DATA_ENGINEERING' | 'DEVOPS' | 'MOBILE' | 'CUSTOM';

export interface ChallengeTemplateItem {
  id: string;
  type: TemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primarySkill: string;
  secondarySkills: string[];
  bloomLevel: string | null;
  estimatedMinutes: number | null;
  config: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  source: string;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePackItem {
  id: string;
  name: string;
  description: string | null;
  roleType: PackRoleType;
  seniority: string;
  version: number;
  skills: string[];
  supportedLanguages: string[];
  source: string;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  items?: Array<{
    challengeTemplateId: string;
    sortOrder: number;
    weight: number;
    isRequired: boolean;
    challenge?: ChallengeTemplateItem;
  }>;
}

// ─── Filters ────────────────────────────────────────────────────────────────

export type TemplateSource = 'SYSTEM' | 'AI_GENERATED' | 'USER_CREATED';

export interface TemplateFilters {
  type?: TemplateType;
  difficulty?: TemplateDifficulty;
  skill?: string;
  search?: string;
  source?: TemplateSource;
  /** When omitted defaults to 'true'. Pass 'false' for drafts, 'all' for both. */
  published?: 'true' | 'false' | 'all';
}

export interface PackFilters {
  roleType?: PackRoleType;
  seniority?: string;
  /** When omitted defaults to 'true'. Pass 'false' for drafts, 'all' for both. */
  published?: 'true' | 'false' | 'all';
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface UseTemplateLibraryResult {
  templates: ChallengeTemplateItem[];
  packs: TemplatePackItem[];
  isLoadingTemplates: boolean;
  isLoadingPacks: boolean;
  error: string | null;
  fetchTemplates: (filters?: TemplateFilters) => Promise<void>;
  fetchPacks: (filters?: PackFilters) => Promise<void>;
  fetchPackDetail: (packId: string) => Promise<TemplatePackItem | null>;
}

export function useTemplateLibrary(): UseTemplateLibraryResult {
  const { getToken } = useClerkAuth();
  const [templates, setTemplates] = useState<ChallengeTemplateItem[]>([]);
  const [packs, setPacks] = useState<TemplatePackItem[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(
    async (filters?: TemplateFilters): Promise<void> => {
      setIsLoadingTemplates(true);
      setError(null);
      try {
        const api = createApiClient({ getToken });
        const params = new URLSearchParams();
        if (filters?.type) params.set('type', filters.type);
        if (filters?.difficulty) params.set('difficulty', filters.difficulty);
        if (filters?.skill) params.set('skill', filters.skill);
        if (filters?.source) params.set('source', filters.source);
        const pub = filters?.published ?? 'true';
        if (pub !== 'all') params.set('published', pub);

        const qs = params.toString();
        const result = await api.get<{ templates: ChallengeTemplateItem[] }>(
          `/api/v1/challenge-templates${qs ? `?${qs}` : ''}`,
        );
        let items = result.templates;

        // Client-side search filter
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          items = items.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.primarySkill.toLowerCase().includes(q) ||
              t.secondarySkills.some((s) => s.toLowerCase().includes(q)),
          );
        }

        setTemplates(items);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch templates';
        console.error('[useTemplateLibrary] fetchTemplates:', message);
        setError(message);
      } finally {
        setIsLoadingTemplates(false);
      }
    },
    [getToken],
  );

  const fetchPacks = useCallback(
    async (filters?: PackFilters): Promise<void> => {
      setIsLoadingPacks(true);
      setError(null);
      try {
        const api = createApiClient({ getToken });
        const params = new URLSearchParams();
        if (filters?.roleType) params.set('roleType', filters.roleType);
        if (filters?.seniority) params.set('seniority', filters.seniority);
        const pubPack = filters?.published ?? 'true';
        if (pubPack !== 'all') params.set('published', pubPack);

        const qs = params.toString();
        const result = await api.get<{ packs: TemplatePackItem[] }>(
          `/api/v1/template-packs${qs ? `?${qs}` : ''}`,
        );
        setPacks(result.packs);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch packs';
        console.error('[useTemplateLibrary] fetchPacks:', message);
        setError(message);
      } finally {
        setIsLoadingPacks(false);
      }
    },
    [getToken],
  );

  const fetchPackDetail = useCallback(
    async (packId: string): Promise<TemplatePackItem | null> => {
      try {
        const api = createApiClient({ getToken });
        return await api.get<TemplatePackItem>(
          `/api/v1/template-packs/${packId}?expand=challenges`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch pack detail';
        console.error('[useTemplateLibrary] fetchPackDetail:', message);
        setError(message);
        return null;
      }
    },
    [getToken],
  );

  // Initial fetch on mount
  useEffect(() => {
    void fetchTemplates();
    void fetchPacks();
  }, [fetchTemplates, fetchPacks]);

  return {
    templates,
    packs,
    isLoadingTemplates,
    isLoadingPacks,
    error,
    fetchTemplates,
    fetchPacks,
    fetchPackDetail,
  };
}
