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
};

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
  submitBaseline: (baseline: Baseline) => Promise<void>;
  submitResponses: (responses: Array<{ questionId: string; response: string | string[] }>) => Promise<void>;
  generateJobDescription: () => Promise<JobDescriptionResponse>;
  reset: () => void;
}

/**
 * Custom hook for managing role discovery flow.
 *
 * @returns Role discovery state and actions
 *
 * @example
 * ```tsx
 * function RoleDiscoveryPage() {
 *   const {
 *     roleContext,
 *     currentSection,
 *     isLoading,
 *     isReady,
 *     submitBaseline,
 *     submitResponses,
 *     generateJobDescription,
 *   } = useRoleDiscovery();
 *
 *   const handleBaselineSubmit = async (baseline: Baseline) => {
 *     await submitBaseline(baseline);
 *   };
 *
 *   return (
 *     <div>
 *       {roleContext.status === 'baseline' && (
 *         <BaselineForm onSubmit={handleBaselineSubmit} />
 *       )}
 *       {currentSection && (
 *         <DynamicSection section={currentSection} onSubmit={submitResponses} />
 *       )}
 *       {isReady && (
 *         <button onClick={generateJobDescription}>Generate JD</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
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
  const submitBaseline = useCallback(async (baseline: Baseline): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: Replace with actual Lambda invocation once custom mutations are set up
      // For now, this is a placeholder that will be updated when backend integration is complete
      console.warn('[useRoleDiscovery] Lambda invocation not yet implemented. Using mock data.');

      // Mock response for development
      const mockResponse: QuestionAgentResponse = {
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

      setRoleContext((prev: RoleContext) => ({
        ...prev,
        baseline,
        context: mockResponse.updatedContext,
        status: mockResponse.status,
        gaps: mockResponse.gaps,
        userSignals: mockResponse.userSignals,
        updatedAt: Date.now(),
      }));
      setCurrentSection(mockResponse.nextSection);
      setReasoning(mockResponse.reasoning);
      setCostTracking(mockResponse.costTracking);

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
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
      // TODO: Replace with actual Lambda invocation
      console.warn('[useRoleDiscovery] Lambda invocation not yet implemented. Using mock data.');

      // Mock response
      const mockResponse: QuestionAgentResponse = {
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
        processingTime: 2300,
      };

      setRoleContext((prev: RoleContext) => ({
        ...prev,
        exchanges: [...prev.exchanges, ...mockResponse.newExchanges],
        context: mockResponse.updatedContext,
        status: mockResponse.status,
        gaps: mockResponse.gaps,
        userSignals: mockResponse.userSignals,
        updatedAt: Date.now(),
      }));
      setCurrentSection(mockResponse.nextSection);
      setReasoning(mockResponse.reasoning);
      setCostTracking(mockResponse.costTracking);

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
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
      // TODO: Replace with actual Lambda invocation
      console.warn('[useRoleDiscovery] Lambda invocation not yet implemented. Using mock data.');

      // Mock response
      const mockResponse: JobDescriptionResponse = {
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
        processingTime: 3500,
      };

      // Save to DynamoDB
      await client.models.RoleContext.create({
        id: roleContext.id,
        owner: undefined, // Will be set by Amplify auth
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
        jobDescription: JSON.stringify(mockResponse.jobDescription),
        candidateFilters: JSON.stringify(mockResponse.candidateFilters),
        suggestedStages: JSON.stringify(mockResponse.suggestedStages),
        createdAt: new Date(roleContext.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return mockResponse;

    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error');
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
