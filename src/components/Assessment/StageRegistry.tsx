import React from 'react';
import { ReviewCanvas } from '../ReviewCanvas';
import { QuizRenderer } from '../QuizRenderer';
import { DiffReviewCanvas } from './CodeReview/DiffReviewCanvas';

// ============================================================================
// Types & Contracts
// ============================================================================

export type StageType = 'CODE_REVIEW' | 'QUIZ';

/**
 * StageDefinition - The "Source of Truth" for a specific stage type.
 * TConfig: Raw data from DynamoDB config field.
 * TProps: Final props passed to the React component.
 */
export interface StageDefinition<TConfig = any, TProps = any> {
  type: StageType;
  
  /**
   * Auto-Mapper: Decides which component to use and transforms config -> props.
   */
  resolve: (config: TConfig, onDataChange: (data: any) => void) => {
    Component: React.ComponentType<any>;
    props: TProps;
  };
}

// ============================================================================
// Stage Definitions (Inverted Logic)
// ============================================================================

const CodeReviewDefinition: StageDefinition = {
  type: 'CODE_REVIEW',
  resolve: (config, onDataChange) => {
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    const snippets = parsed.snippets || (parsed.code ? [parsed] : []);
    const renderer = parsed.renderer || 'DIFF_VIEW';

    return {
      Component: renderer === 'CUSTOM' ? ReviewCanvas : DiffReviewCanvas,
      props: {
        snippets: snippets.map((s: any, i: number) => ({
          id: s.id || `snippet-${i}`,
          title: s.title || 'Code Review',
          code: s.code,
          language: s.language || 'javascript'
        })),
        onAnnotationsChange: onDataChange
      }
    };
  }
};

const QuizDefinition: StageDefinition = {
  type: 'QUIZ',
  resolve: (config, onDataChange) => {
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    return {
      Component: QuizRenderer,
      props: {
        questions: parsed.questions || [],
        onAnswersChange: onDataChange
      }
    };
  }
};

// ============================================================================
// The Registry
// ============================================================================

const Definitions: Record<StageType, StageDefinition> = {
  CODE_REVIEW: CodeReviewDefinition,
  QUIZ: QuizDefinition,
};

// ============================================================================
// The Auto-Mapping Renderer
// ============================================================================

interface StageRendererProps {
  type: StageType;
  config: any;
  onSubmissionChange: (submission: any) => void;
}

/**
 * StageRenderer - Generic engine that uses Inversion of Control to render stages.
 */
export function StageRenderer({ type, config, onSubmissionChange }: StageRendererProps): JSX.Element | null {
  const definition = Definitions[type];

  if (!definition) {
    console.warn(`[StageRenderer] No definition found for stage type: ${type}`);
    return null;
  }

  // Execute the Inverted Resolver
  const { Component, props } = definition.resolve(config, onSubmissionChange);

  return <Component key={type} {...props} />;
}
