
export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'INTAKE';

export type PanelType =
  | 'problem'
  | 'monaco'
  | 'preview'
  | 'tests'
  | 'diff-annotation'
  | 'options'
  | 'textarea'
  | 'voice'
  | 'video-submission';

export type LayoutType = 'browser' | 'algorithm' | 'standard';

export interface ResolvedLayout {
  leftPanel: PanelType | null;
  centerPanel: PanelType;
  rightPanel: PanelType | null;
  layoutType: LayoutType;
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
        layoutType: 'standard',
      };

    case 'CODE_IMPLEMENTATION': {
      const subtype = config.subtype ?? 'WRITE_FUNCTION';
      switch (subtype) {
        case 'BUILD_COMPONENT':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'preview',
            layoutType: 'browser',
          };
        case 'WRITE_FUNCTION':
        case 'REFACTOR_FUNCTION':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'tests',
            layoutType: 'algorithm',
          };
        default:
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: null,
            layoutType: 'standard',
          };
      }
    }

    case 'QUIZ_MCQ':
      return {
        leftPanel: null,
        centerPanel: 'options',
        rightPanel: null,
        layoutType: 'standard',
      };

    case 'QUIZ_SHORT_ANSWER': {
      const inputMode = (config as { inputMode?: string }).inputMode ?? 'text';
      if (inputMode === 'voice') {
        return { leftPanel: null, centerPanel: 'voice', rightPanel: null, layoutType: 'standard' };
      }
      if (inputMode === 'video') {
        return { leftPanel: null, centerPanel: 'video-submission', rightPanel: null, layoutType: 'standard' };
      }
      return { leftPanel: null, centerPanel: 'textarea', rightPanel: null, layoutType: 'standard' };
    }

    // FOLLOW_UP is intercepted at the page level before ChallengeRegistry is reached.
    // This case exists only for type-safety completeness.
    case 'FOLLOW_UP':
      return {
        leftPanel: null,
        centerPanel: 'textarea',
        rightPanel: null,
        layoutType: 'standard',
      };

    default:
      return {
        leftPanel: 'problem',
        centerPanel: 'monaco',
        rightPanel: null,
        layoutType: 'standard',
      };
  }
}
