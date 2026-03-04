export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export type EditorPanelType =
  | 'instructions'   // Markdown editor for instructions
  | 'code'           // Monaco editor for snippet/starter code
  | 'scoring'        // Ground truth for CODE_REVIEW or Rubric for SHORT_ANSWER
  | 'tests'          // Test case editor for CODE_IMPLEMENTATION
  | 'options'        // MCQ options editor
  | 'preview';       // Real-time candidate-view preview

export interface ResolvedEditorLayout {
  leftPanels: EditorPanelType[];
  rightPanels: EditorPanelType[];
  bottomPanels: EditorPanelType[];
}

/**
 * resolveEditorLayout - Maps challenge type to a declarative list of editor panels.
 * Implements ADR-012.
 */
export function resolveEditorLayout(type: string | null): ResolvedEditorLayout {
  switch (type as ChallengeType) {
    case 'CODE_REVIEW':
      return {
        leftPanels: ['instructions'],
        rightPanels: ['code', 'scoring'],
        bottomPanels: [],
      };

    case 'CODE_IMPLEMENTATION':
      return {
        leftPanels: ['instructions'],
        rightPanels: ['code', 'tests'],
        bottomPanels: [],
      };

    case 'QUIZ_MCQ':
      return {
        leftPanels: ['instructions'],
        rightPanels: ['options'],
        bottomPanels: [],
      };

    case 'QUIZ_SHORT_ANSWER':
      return {
        leftPanels: ['instructions'],
        rightPanels: ['scoring'],
        bottomPanels: [],
      };

    default: {
      // Fallback for unknown types
      return {
        leftPanels: ['instructions'],
        rightPanels: ['preview'],
        bottomPanels: [],
      };
    }
  }
}
