import React from 'react';
import { ReviewCanvas } from '../ReviewCanvas';
import { QuizRenderer } from '../QuizRenderer';
import { DiffReviewCanvas } from './CodeReview/DiffReviewCanvas';

// ============================================================================
// Types & Contracts
// ============================================================================

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export interface ChallengeDefinition<TConfig = any, TProps = any> {
  type: ChallengeType;
  resolve: (config: TConfig, onDataChange: (data: any) => void, context?: any) => {
    Component: React.ComponentType<any>;
    props: TProps;
  };
}

// ============================================================================
// Challenge Definitions
// ============================================================================

const CodeReviewDefinition: ChallengeDefinition = {
  type: 'CODE_REVIEW',
  resolve: (config, onDataChange, context) => {
    const parsed = typeof config === 'string' ? JSON.parse(config) : (config || {});
    const renderer = parsed?.renderer || 'DIFF_VIEW';
    
    // In the new architecture, snippets might come from a linked CodeArtifact
    // For now, we'll support both inline and linked
    const snippets = context?.codeArtifact ? [context.codeArtifact] : (parsed?.snippets || (parsed?.code ? [parsed] : []));

    return {
      Component: renderer === 'CUSTOM' ? ReviewCanvas : DiffReviewCanvas,
      props: {
        snippets: snippets.map((s: any, i: number) => ({
          id: s.id || `snippet-${i}`,
          title: s.title || 'Code Review',
          code: s.code || '',
          language: s.language || 'javascript'
        })),
        onAnnotationsChange: onDataChange
      }
    };
  }
};

const QuizMCQDefinition: ChallengeDefinition = {
  type: 'QUIZ_MCQ',
  resolve: (config, onDataChange) => {
    const parsed = typeof config === 'string' ? JSON.parse(config) : (config || {});
    // Adapt to QuizRenderer's expected format
    const questions = parsed?.q ? [parsed] : (parsed?.questions || []);
    
    return {
      Component: QuizRenderer,
      props: {
        questions: questions,
        onAnswersChange: (answers: any) => onDataChange({ answers })
      }
    };
  }
};

const QuizShortAnswerDefinition: ChallengeDefinition = {
  type: 'QUIZ_SHORT_ANSWER',
  resolve: (_, onDataChange) => {
    return {
      Component: ({ onSubmissionChange }: any) => (
        <div style={{ padding: 32, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
          <textarea 
            onChange={(e) => onSubmissionChange({ text: e.target.value })}
            placeholder="Type your response here..."
            style={{ width: '100%', height: 300, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: 20, color: '#fff', fontSize: 14, outline: 'none' }}
          />
        </div>
      ),
      props: {
        onSubmissionChange: onDataChange
      }
    };
  }
};

// Placeholder for Monaco based implementation
const CodeImplementationDefinition: ChallengeDefinition = {
  type: 'CODE_IMPLEMENTATION',
  resolve: () => {
    return {
      Component: () => (
        <div style={{ padding: 60, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
            MONACO_EDITOR_IMPLEMENTATION_COMING_SOON
          </div>
        </div>
      ),
      props: {}
    };
  }
};

// ============================================================================
// The Registry
// ============================================================================

const Definitions: Record<ChallengeType, ChallengeDefinition> = {
  CODE_REVIEW: CodeReviewDefinition,
  CODE_IMPLEMENTATION: CodeImplementationDefinition,
  QUIZ_MCQ: QuizMCQDefinition,
  QUIZ_SHORT_ANSWER: QuizShortAnswerDefinition,
};

// ============================================================================
// The Auto-Mapping Renderer
// ============================================================================

interface ChallengeRendererProps {
  type: ChallengeType;
  config: any;
  onSubmissionChange: (submission: any) => void;
  context?: any;
}

/**
 * ChallengeRenderer - Generic engine that resolves and renders individual challenges.
 */
export function ChallengeRenderer({ type, config, onSubmissionChange, context }: ChallengeRendererProps): JSX.Element | null {
  const definition = Definitions[type];

  if (!definition) {
    console.warn(`[ChallengeRenderer] No definition found for challenge type: ${type}`);
    return null;
  }

  const { Component, props } = definition.resolve(config, onSubmissionChange, context);

  return <Component key={type} {...props} />;
}
