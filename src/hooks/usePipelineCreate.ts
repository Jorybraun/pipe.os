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
// Validation
// ============================================================================

export function validatePipelineInput(
  input: Partial<PipelineCreateInput>
): Partial<Record<keyof PipelineCreateInput, string>> {
  const errors: Partial<Record<keyof PipelineCreateInput, string>> = {};

  if (!input.title?.trim()) {
    errors.title = 'Role title is required';
  } else if (input.title.trim().length > 100) {
    errors.title = 'Role title must be 100 characters or less';
  }

  if (!input.level) {
    errors.level = 'Seniority level is required';
  }

  if (!input.stack || input.stack.length === 0) {
    errors.stack = 'At least one technology is required';
  }

  if (input.description && input.description.length > 1000) {
    errors.description = 'Description must be 1000 characters or less';
  }

  return errors;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * usePipelineCreate - Handles pipeline creation with form state and Amplify Data persistence.
 *
 * Provides a thin wrapper around the Amplify Data `Pipeline.create` mutation.
 * Returns the created pipeline ID on success for redirect.
 *
 * @example
 * ```tsx
 * const { create, isSubmitting, error } = usePipelineCreate();
 *
 * const handleSubmit = async () => {
 *   const id = await create({ title: 'Senior Engineer', level: 'Senior', stack: ['React', 'TypeScript'] });
 *   if (id) navigate(`/pipeline/${id}`);
 * };
 * ```
 */
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
        const { data, errors } = await client.models.Pipeline.create({
          title: input.title.trim(),
          level: input.level,
          stack: input.stack,
          description: input.description?.trim() || undefined,
          status: 'DRAFT',
        });

        if (errors && errors.length > 0) {
          const err = new Error(errors[0].message ?? 'Failed to create pipeline');
          console.error('[usePipelineCreate] GraphQL errors:', errors);
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        if (!data?.id) {
          const err = new Error('Pipeline was created but no ID was returned');
          console.error('[usePipelineCreate] No ID returned from create mutation');
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        console.log('[usePipelineCreate] Pipeline created:', data.id);
        setState({ isSubmitting: false, error: null, createdId: data.id });
        return data.id;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('An unexpected error occurred');
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
