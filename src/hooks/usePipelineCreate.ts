import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// ============================================================================
// Types
// ============================================================================

export type PipelineLevel =
  | 'Junior'
  | 'Mid'
  | 'Senior'
  | 'Staff'
  | 'Principal'
  | 'Lead'
  | 'Manager';

export interface PipelineCreateInput {
  title: string;
  level: PipelineLevel;
  stack: string[];
  description?: string;
  presetId?: string;
}

interface UsePipelineCreateState {
  isSubmitting: boolean;
  error: Error | null;
  createdId: string | null;
}

interface UsePipelineCreateReturn extends UsePipelineCreateState {
  create: (input: PipelineCreateInput) => Promise<string | null>;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function usePipelineCreate(): UsePipelineCreateReturn {
  const [state, setState] = useState<UsePipelineCreateState>({
    isSubmitting: false,
    error: null,
    createdId: null,
  });

  const create = useCallback(
    async (input: PipelineCreateInput): Promise<string | null> => {
      setState({ isSubmitting: true, error: null, createdId: null });

      try {
        // 1. Create the Pipeline
        const { data: pipeline, errors } = await client.models.Pipeline.create({
          title: input.title.trim(),
          level: input.level,
          stack: input.stack,
          description: input.description?.trim() || undefined,
          status: 'ACTIVE',
          creationMode: input.presetId === 'BLANK' ? 'BLANK' : 'PRESET',
        } as any);

        if (errors && errors.length > 0) throw new Error(errors[0].message);
        if (!pipeline) throw new Error('Failed to create pipeline');

        console.log('[usePipelineCreate] Pipeline created:', pipeline.id);
        setState({ isSubmitting: false, error: null, createdId: pipeline.id });
        return pipeline.id;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('An unexpected error occurred');
        console.error('[usePipelineCreate] Unexpected error:', error);
        setState({ isSubmitting: false, error, createdId: null });
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState({ isSubmitting: false, error: null, createdId: null });
  }, []);

  return {
    ...state,
    create,
    reset,
  };
}
