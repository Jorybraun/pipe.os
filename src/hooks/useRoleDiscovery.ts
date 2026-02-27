/**
 * useRoleDiscovery Hook
 *
 * Manages role discovery session state and Lambda function invocations.
 * Provides interface for baseline submission, question responses, and JD generation.
 */

import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type {
  RoleContext,
  Baseline,
  FormSection,
  QuestionAgentResponse,
  JobDescriptionResponse,
} from '../types/discovery';
import { v4 as uuid } from 'uuid';

const client = generateClient<Schema>();

const initialContext: RoleContext = {
  id: uuid(),
  baseline: null,
  exchanges: [],
  context: {},
  status: 'baseline',
  gaps: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  // New configuration defaults
  questionLimit: '5',
  questionMode: 'Custom AI Questions',
  codeReviewMode: 'AI Generated',
};

// Configuration for development
const USE_MOCK = import.meta.env.VITE_USE_MOCK_AGENT === 'true';

export interface UseRoleDiscoveryReturn {
  // State
  roleContext: RoleContext;
  currentSection: FormSection | null;
  reasoning: string;
  costTracking: {
    sessionCost: number;
    remainingBudget: number;
    callCount: number;
  };
  isLoading: boolean;
  error: Error | null;
  isReady: boolean;

  // Actions
  submitBaseline: (baseline: Baseline, config?: { 
    questionLimit?: string, 
    questionMode?: string, 
    codeReviewMode?: string 
  }) => Promise<void>;
  submitResponses: (responses: Array<{ questionId: string; response: string | string[] }>) => Promise<void>;
  generateJobDescription: () => Promise<JobDescriptionResponse>;
  reset: () => void;
}

export function useRoleDiscovery(): UseRoleDiscoveryReturn {
  const [roleContext, setRoleContext] = useState<RoleContext>(initialContext);
  const [currentSection, setCurrentSection] = useState<FormSection | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [costTracking, setCostTracking] = useState({
    sessionCost: 0,
    remainingBudget: 0.50,
    callCount: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Submits baseline data and gets first set of questions.
   */
  const submitBaseline = useCallback(async (
    baseline: Baseline, 
    config?: { questionLimit?: string, questionMode?: string, codeReviewMode?: string }
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    const updatedContext: RoleContext = {
      ...roleContext,
      baseline,
      status: 'exploring',
      updatedAt: Date.now(),
      ...config, // Merge in new config options
    };

    try {
      let data: QuestionAgentResponse;

      if (USE_MOCK) {
        // Mock response for development
        await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate latency
        data = {
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
          processingTime: 1500,
        };
      } else {
        // Real Lambda invocation via Amplify Mutation
        const response = await client.mutations.generateQuestions({
          roleContext: updatedContext as any, // Cast to any for JSON arg
        });

        if (response.errors) {
          throw new Error(response.errors[0].message);
        }

        data = response.data as unknown as QuestionAgentResponse;
      }

      setRoleContext((prev: RoleContext) => ({
        ...prev,
        baseline,
        context: data.updatedContext,
        status: data.status,
        gaps: data.gaps,
        userSignals: data.userSignals,
        updatedAt: Date.now(),
        ...config,
      }));
      setCurrentSection(data.nextSection);
      setReasoning(data.reasoning);
      setCostTracking(data.costTracking);

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to connect to agent');
      console.error('[useRoleDiscovery] submitBaseline error:', errorObj);
      setError(errorObj);
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  /**
   * Submits question responses and gets next questions.
   */
  const submitResponses = useCallback(async (
    responses: Array<{ questionId: string; response: string | string[] }>
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      let data: QuestionAgentResponse;

      if (USE_MOCK) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        data = {
          updatedContext: {
            ...roleContext.context,
            success_criteria: 'Ship payment API v2, reduce latency by 40%',
          },
          newExchanges: responses.map(r => ({
            id: uuid(),
            questionId: r.questionId,
            agentQuestion: 'What would this person need to accomplish in their first 90 days?',
            userResponse: typeof r.response === 'string' ? r.response : r.response.join(', '),
            extractedFacts: ['90-day goal: ship payment API v2', 'performance target: 40% latency reduction'],
            timestamp: Date.now(),
          })),
          nextSection: null,
          status: 'ready',
          gaps: [],
          reasoning: 'I now have enough context to generate a job description.',
          costTracking: {
            sessionCost: 0.15,
            remainingBudget: 0.35,
            callCount: 5,
          },
          processingTime: 2000,
        };
      } else {
        const response = await client.mutations.generateQuestions({
          roleContext: roleContext as any,
          responses: responses as any,
        });

        if (response.errors) {
          throw new Error(response.errors[0].message);
        }

        data = response.data as unknown as QuestionAgentResponse;
      }

      setRoleContext((prev: RoleContext) => ({
        ...prev,
        exchanges: [...prev.exchanges, ...data.newExchanges],
        context: data.updatedContext,
        status: data.status,
        gaps: data.gaps,
        userSignals: data.userSignals,
        updatedAt: Date.now(),
      }));
      setCurrentSection(data.nextSection);
      setReasoning(data.reasoning);
      setCostTracking(data.costTracking);

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Agent failed to process responses');
      console.error('[useRoleDiscovery] submitResponses error:', errorObj);
      setError(errorObj);
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  /**
   * Generates job description when context is ready.
   */
  const generateJobDescription = useCallback(async (): Promise<JobDescriptionResponse> => {
    if (roleContext.status !== 'ready') {
      throw new Error('Not ready to generate job description');
    }

    setIsLoading(true);
    setError(null);

    try {
      let data: JobDescriptionResponse;

      if (USE_MOCK) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        data = {
          jobDescription: {
            title: roleContext.baseline!.title,
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
          processingTime: 3000,
        };
      } else {
        const response = await client.mutations.generateJobDescription({
          roleContext: roleContext as any,
        });

        if (response.errors) {
          throw new Error(response.errors[0].message);
        }

        data = response.data as unknown as JobDescriptionResponse;
      }

      // Persist to RoleContext model in DynamoDB
      await client.models.RoleContext.create({
        id: roleContext.id,
        title: roleContext.baseline!.title,
        level: roleContext.baseline!.level,
        department: roleContext.baseline!.department,
        workModel: roleContext.baseline!.workModel,
        teamSize: roleContext.baseline!.teamSize,
        reportsTo: roleContext.baseline!.reportsTo,
        stack: roleContext.baseline!.stack,
        context: JSON.stringify(roleContext.context),
        exchanges: JSON.stringify(roleContext.exchanges),
        status: roleContext.status,
        gaps: roleContext.gaps,
        userSignals: roleContext.userSignals ? JSON.stringify(roleContext.userSignals) : undefined,
        jobDescription: JSON.stringify(data.jobDescription),
        candidateFilters: JSON.stringify(data.candidateFilters),
        suggestedStages: JSON.stringify(data.suggestedStages),
      });

      return data;

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to generate job description');
      console.error('[useRoleDiscovery] generateJobDescription error:', errorObj);
      setError(errorObj);
      throw errorObj;
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  /**
   * Resets the discovery session to initial state.
   */
  const reset = useCallback((): void => {
    setRoleContext({ ...initialContext, id: uuid() });
    setCurrentSection(null);
    setReasoning('');
    setCostTracking({
      sessionCost: 0,
      remainingBudget: 0.50,
      callCount: 0,
    });
    setError(null);
  }, []);

  return {
    roleContext,
    currentSection,
    reasoning,
    costTracking,
    isLoading,
    error,
    isReady: roleContext.status === 'ready',
    submitBaseline,
    submitResponses,
    generateJobDescription,
    reset,
  };
}
