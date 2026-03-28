/**
 * useRoleDiscovery Hook Tests
 *
 * Tests for the role discovery client hook.
 * Uses PipeProviderRoot with mock providers instead of mocking aws-amplify/data
 * directly, since the hook calls useData() from the provider abstraction layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useRoleDiscovery } from './useRoleDiscovery';
import { PipeProviderRoot } from '../providers/DataContext';
import type { PipeProviders, DataProvider, ModelOperations } from '../providers/types';
import type { Baseline } from '../types/discovery';
import { v4 as uuid } from 'uuid';

// ─── Shared mock handles ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    mockGenerateQuestions: vi.fn(),
    mockGenerateJobDescription: vi.fn(),
    mockRoleContextCreate: vi.fn(),
  };
});

// ─── Mock factory helpers ─────────────────────────────────────────────────────

function createMockModelOps(): ModelOperations {
  return {
    get: vi.fn().mockResolvedValue({ data: null }),
    list: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ data: null }),
    update: vi.fn().mockResolvedValue({ data: null }),
    delete: vi.fn().mockResolvedValue({ data: null }),
    observeQuery: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    }),
  };
}

function createMockDataProvider(): DataProvider {
  const modelNames = [
    'Pipeline', 'Stage', 'Candidate', 'Challenge', 'ChallengeSubmission',
    'Assessment', 'CodeArtifact', 'VideoSession', 'VideoSignal',
    'CandidateMedia', 'ScheduledInterview', 'SchedulingConnection',
    'RoleContext', 'RepoTemplate', 'DevContainerSession',
  ] as const;

  const models = {} as DataProvider['models'];
  for (const name of modelNames) {
    (models as Record<string, ModelOperations>)[name] = createMockModelOps();
  }

  // Wire RoleContext.create to the shared mock handle
  (models.RoleContext as { create: ReturnType<typeof vi.fn> }).create =
    mocks.mockRoleContextCreate;

  return {
    models,
    mutations: {
      generateQuestions: mocks.mockGenerateQuestions,
      generateJobDescription: mocks.mockGenerateJobDescription,
    },
    queries: {},
  };
}

function createWrapper() {
  const mockProvider = createMockDataProvider();
  const providers: PipeProviders = {
    data: {
      createClient: () => mockProvider,
      createPublicClient: () => mockProvider,
      createSessionClient: () => mockProvider,
    },
    storage: {
      upload: vi.fn().mockResolvedValue({ path: '' }),
      getUrl: vi.fn().mockResolvedValue({ url: new URL('https://example.com') }),
    },
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(PipeProviderRoot, { providers }, children);
  };
}

// ─── Mock response builders ───────────────────────────────────────────────────

function makeQuestionsResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      updatedContext: {},
      newExchanges: [],
      nextSection: {
        id: uuid(),
        title: 'SUCCESS_CRITERIA',
        description: 'Let me understand what success looks like for this role.',
        questions: [
          {
            id: uuid(),
            text: 'What would this person need to accomplish in their first 90 days?',
            type: 'textarea',
            placeholder: 'Specific projects, milestones, or outcomes...',
          },
        ],
      },
      status: 'exploring',
      gaps: ['success_criteria', 'challenges', 'culture'],
      reasoning: 'Need to understand success metrics and role challenges.',
      costTracking: {
        sessionCost: 0.02,
        remainingBudget: 0.48,
        callCount: 1,
      },
      processingTime: 10,
      ...overrides,
    },
    errors: undefined,
  };
}

function makeReadyResponse(firstQuestionId: string) {
  return {
    data: {
      updatedContext: {
        success_criteria: 'Ship payment API v2, reduce latency by 40%',
      },
      newExchanges: [
        {
          id: uuid(),
          questionId: firstQuestionId,
          agentQuestion: 'What would this person need to accomplish in their first 90 days?',
          userResponse: 'Detailed response',
          extractedFacts: ['90-day goal: ship payment API v2'],
          timestamp: Date.now(),
        },
      ],
      nextSection: null,
      status: 'ready',
      gaps: [],
      reasoning: 'I now have enough context to generate a job description.',
      costTracking: {
        sessionCost: 0.15,
        remainingBudget: 0.35,
        callCount: 5,
      },
      processingTime: 10,
    },
    errors: undefined,
  };
}

function makeJobDescriptionResponse() {
  return {
    data: {
      jobDescription: {
        title: 'Senior Backend Engineer',
        summary: 'Lead backend engineering efforts for our payment platform.',
        responsibilities: [
          'Design and implement payment API v2',
          'Optimize system latency and throughput',
          'Mentor junior engineers',
        ],
        requirements: {
          required: [
            '5+ years backend engineering experience',
            'Strong Node.js/TypeScript skills',
            'Experience with payment systems',
          ],
          preferred: [
            'AWS architecture experience',
            'System design expertise',
          ],
        },
        successIndicators: [
          '90 days: Ship payment API v2',
          '1 year: Reduce latency by 40%',
        ],
        teamContext: '5-person platform team, async-first culture.',
        growthOpportunity: 'Path to Staff Engineer or Engineering Manager.',
        rawMarkdown: '# Senior Backend Engineer\n\n...',
      },
      candidateFilters: [],
      suggestedStages: [],
      processingTime: 10,
    },
    errors: undefined,
  };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const mockBaseline: Baseline = {
  title: 'Senior Backend Engineer',
  level: 'senior',
  department: 'Engineering',
  workModel: 'remote',
  teamSize: '5 engineers',
  reportsTo: 'Engineering Manager',
  stack: ['TypeScript', 'Node.js', 'PostgreSQL'],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useRoleDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockRoleContextCreate.mockResolvedValue({ data: null });
  });

  it('should initialize with baseline status', () => {
    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.roleContext.baseline).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should update status after baseline submission', async () => {
    mocks.mockGenerateQuestions.mockResolvedValue(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    await waitFor(() => {
      expect(result.current.roleContext.status).toBe('exploring');
      expect(result.current.roleContext.baseline).toEqual(mockBaseline);
      expect(result.current.currentSection).not.toBeNull();
    });
  });

  it('should track cost over multiple operations', async () => {
    mocks.mockGenerateQuestions.mockResolvedValue(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    await waitFor(() => {
      expect(result.current.costTracking.sessionCost).toBeGreaterThan(0);
      expect(result.current.costTracking.callCount).toBeGreaterThan(0);
      expect(result.current.costTracking.remainingBudget).toBeLessThan(0.50);
    });
  });

  it('should submit responses and update context', async () => {
    mocks.mockGenerateQuestions.mockResolvedValueOnce(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const firstSection = result.current.currentSection;
    expect(firstSection).not.toBeNull();

    if (firstSection) {
      const firstQuestionId = firstSection.questions[0].id;
      mocks.mockGenerateQuestions.mockResolvedValueOnce(makeReadyResponse(firstQuestionId));

      await act(async () => {
        await result.current.submitResponses([
          {
            questionId: firstQuestionId,
            response: 'Ship payment API v2 and reduce latency by 40%',
          },
        ]);
      });

      await waitFor(() => {
        expect(result.current.roleContext.exchanges.length).toBeGreaterThan(0);
      });
    }
  });

  it('should become ready after sufficient exploration', async () => {
    mocks.mockGenerateQuestions.mockResolvedValueOnce(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const firstQuestionId = result.current.currentSection?.questions[0]?.id ?? '';
    mocks.mockGenerateQuestions.mockResolvedValueOnce(makeReadyResponse(firstQuestionId));

    await act(async () => {
      await result.current.submitResponses([
        {
          questionId: firstQuestionId,
          response: 'Detailed response',
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
      expect(result.current.roleContext.status).toBe('ready');
    });
  });

  it('should throw error when generating JD before ready', async () => {
    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await expect(async () => {
      await act(async () => {
        await result.current.generateJobDescription();
      });
    }).rejects.toThrow('Not ready to generate job description');
  });

  it('should generate job description when ready and persist to RoleContext', async () => {
    mocks.mockGenerateQuestions.mockResolvedValueOnce(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    // Submit baseline to get to exploring state
    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const firstQuestionId = result.current.currentSection?.questions[0]?.id ?? '';
    mocks.mockGenerateQuestions.mockResolvedValueOnce(makeReadyResponse(firstQuestionId));

    // Submit responses to reach ready state
    await act(async () => {
      await result.current.submitResponses([
        { questionId: firstQuestionId, response: 'Detailed response' },
      ]);
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    mocks.mockGenerateJobDescription.mockResolvedValueOnce(makeJobDescriptionResponse());

    let jdResult: Awaited<ReturnType<typeof result.current.generateJobDescription>> | undefined;
    await act(async () => {
      jdResult = await result.current.generateJobDescription();
    });

    expect(jdResult?.jobDescription.title).toBe('Senior Backend Engineer');
    expect(mocks.mockRoleContextCreate).toHaveBeenCalledOnce();
  });

  it('should reset to initial state', async () => {
    mocks.mockGenerateQuestions.mockResolvedValue(makeQuestionsResponse());

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.submitBaseline(mockBaseline);
    });

    const idBeforeReset = result.current.roleContext.id;

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.roleContext.baseline).toBeNull();
    expect(result.current.roleContext.id).not.toBe(idBeforeReset);
    expect(result.current.currentSection).toBeNull();
    expect(result.current.costTracking.sessionCost).toBe(0);
  });

  it('should handle errors gracefully when submitResponses called without baseline', async () => {
    // generateQuestions will throw because roleContext has no baseline context
    // but the hook catches errors and sets error state without re-throwing
    mocks.mockGenerateQuestions.mockRejectedValue(new Error('No baseline provided'));

    const { result } = renderHook(() => useRoleDiscovery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.submitResponses([
          { questionId: 'invalid', response: 'test' },
        ]);
      } catch {
        // submitResponses catches internally — should not reach here
      }
    });

    // Hook should still be functional
    expect(result.current.roleContext.status).toBe('baseline');
    expect(result.current.error).not.toBeNull();
  });
});
