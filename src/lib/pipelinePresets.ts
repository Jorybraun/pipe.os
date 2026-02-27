import { quizQuestions } from '../content/quizQuestions';

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export interface PresetChallenge {
  type: ChallengeType;
  title: string;
  instructions: string;
  config: any;
  snippetId?: string;
}

export interface PresetStage {
  name: string;
  challenges: PresetChallenge[];
}

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  stages: PresetStage[];
}

export const PIPELINE_PRESETS: Record<string, PipelinePreset> = {
  DEFAULT: {
    id: 'DEFAULT',
    name: 'Default MVP',
    description: 'Includes a Code Review challenge and a Technical Quiz.',
    stages: [
      {
        name: 'Technical Assessment',
        challenges: [
          {
            type: 'CODE_REVIEW',
            title: 'JS Auth Middleware Review',
            instructions: 'Identify security and logic flaws in this Express middleware.',
            snippetId: 'js-auth-logic',
            config: { renderer: 'DIFF_VIEW' }
          },
          {
            type: 'QUIZ_MCQ',
            title: 'React & TS Fundamentals',
            instructions: 'Complete this brief quiz on modern frontend development.',
            config: {
              questions: quizQuestions.filter(q => q.id.startsWith('react') || q.id.startsWith('ts'))
            }
          }
        ]
      }
    ]
  },
  BLANK: {
    id: 'BLANK',
    name: 'Blank Pipeline',
    description: 'Start with an empty pipeline and build it from scratch.',
    stages: []
  }
};
