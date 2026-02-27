import type { Schema } from '../../../amplify/data/resource';

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export type PanelType =
  | 'problem'
  | 'monaco'
  | 'preview'
  | 'tests'
  | 'diff-annotation'
  | 'options'
  | 'textarea';

export interface ResolvedLayout {
  leftPanel: PanelType | null;
  centerPanel: PanelType;
  rightPanel: PanelType | null;
}

/**
 * Maps challenge type + subtype → which panels to render.
 */
export function resolveLayout(challenge: { type: string | null; config?: any }): ResolvedLayout {
  const config = typeof challenge.config === 'string' 
    ? JSON.parse(challenge.config) 
    : (challenge.config || {});

  switch (challenge.type as ChallengeType) {
    case 'CODE_REVIEW':
      return {
        leftPanel: 'problem',
        centerPanel: 'diff-annotation',
        rightPanel: null,
      };

    case 'CODE_IMPLEMENTATION': {
      const subtype = config.subtype ?? 'WRITE_FUNCTION';
      switch (subtype) {
        case 'BUILD_COMPONENT':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'preview',
          };
        case 'WRITE_FUNCTION':
        case 'REFACTOR_FUNCTION':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'tests',
          };
        default:
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: null,
          };
      }
    }

    case 'QUIZ_MCQ':
      return {
        leftPanel: null,
        centerPanel: 'options',
        rightPanel: null,
      };

    case 'QUIZ_SHORT_ANSWER':
      return {
        leftPanel: null,
        centerPanel: 'textarea',
        rightPanel: null,
      };

    default:
      return {
        leftPanel: 'problem',
        centerPanel: 'monaco',
        rightPanel: null,
      };
  }
}
