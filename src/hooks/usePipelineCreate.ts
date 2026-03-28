import { useState, useCallback } from 'react';
import { useData } from '../providers';
import type { DataProviderFactory } from '../providers';

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
  const factory: DataProviderFactory = useData();

  const [state, setState] = useState<UsePipelineCreateState>({
    isSubmitting: false,
    error: null,
    createdId: null,
  });

  const create = useCallback(
    async (input: PipelineCreateInput): Promise<string | null> => {
      setState({ isSubmitting: true, error: null, createdId: null });

      try {
        const client = factory.createClient();

        // 1. Create the Pipeline
        const { data: pipeline, errors } = await client.models.Pipeline.create({
          title: input.title.trim(),
          level: input.level,
          stack: input.stack,
          description: input.description?.trim() || undefined,
          status: 'DRAFT',
          creationMode: input.presetId === 'BLANK' ? 'BLANK' : 'PRESET',
        });

        if (errors && errors.length > 0) throw new Error(errors[0]?.message ?? 'Create failed');
        if (!pipeline) throw new Error('Failed to create pipeline');

        const pipelineRecord = pipeline as Record<string, unknown>;
        const pipelineId = pipelineRecord['id'] as string;
        console.log('[usePipelineCreate] Pipeline created:', pipelineId);
        setState({ isSubmitting: false, error: null, createdId: pipelineId });
        return pipelineId;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('An unexpected error occurred');
        console.error('[usePipelineCreate] Unexpected error:', error);
        setState({ isSubmitting: false, error, createdId: null });
        return null;
      }
    },
    [factory]
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
