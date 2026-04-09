/**
 * Stage type definitions and template questions.
 *
 * When a recruiter selects a stage type, the corresponding template questions
 * are seeded as challenges via the existing challenge API. The stage records
 * its type so the UI knows what was selected.
 */

import type { ChallengeType } from './api/types';

export const STAGE_TYPES = [
  'SCREENING',
  'CULTURAL',
  'TECHNICAL',
  'CODE_REVIEW',
  'PANEL',
] as const;

export type StageType = (typeof STAGE_TYPES)[number];

export interface TemplateQuestion {
  type: ChallengeType;
  title: string;
  instructions: string;
}

export interface StageTypeConfig {
  key: StageType;
  label: string;
  description: string;
  templateQuestions: TemplateQuestion[];
}

export const STAGE_TYPE_CONFIGS: Record<StageType, StageTypeConfig> = {
  SCREENING: {
    key: 'SCREENING',
    label: 'Screening',
    description: 'Initial candidate evaluation',
    templateQuestions: [
      {
        type: 'FOLLOW_UP',
        title: 'Introduce yourself',
        instructions:
          'Tell us about your background and what brought you to this role.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Motivation',
        instructions: 'Why are you interested in this position?',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Relevant experience',
        instructions:
          'Describe a recent project or role that is most relevant to this position.',
      },
    ],
  },
  CULTURAL: {
    key: 'CULTURAL',
    label: 'Cultural Fit',
    description: 'Values and team alignment',
    templateQuestions: [
      {
        type: 'FOLLOW_UP',
        title: 'Introduce yourself',
        instructions: 'Brief introduction and career highlights.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'STAR: Challenge',
        instructions:
          'Describe a situation where you faced a significant challenge at work. What was the situation, task, action, and result?',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'STAR: Collaboration',
        instructions:
          'Tell us about a time you had to work closely with someone whose personality was very different from yours.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'STAR: Leadership',
        instructions:
          'Describe a time you took the lead on a project or initiative. What did you do and what was the outcome?',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Team values',
        instructions: 'What does a healthy team culture look like to you?',
      },
    ],
  },
  CODE_REVIEW: {
    key: 'CODE_REVIEW',
    label: 'Code Review',
    description: 'Multi-turn code review challenge',
    templateQuestions: [],
  },
  TECHNICAL: {
    key: 'TECHNICAL',
    label: 'Technical',
    description: 'Skills and problem-solving assessment',
    templateQuestions: [
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'System design',
        instructions:
          'Walk us through how you would design a system for a use case relevant to this role.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Debugging approach',
        instructions:
          'Describe your approach to debugging a production issue you have never seen before.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Trade-off analysis',
        instructions:
          'Describe a technical decision where you had to weigh trade-offs. What did you choose and why?',
      },
    ],
  },
  PANEL: {
    key: 'PANEL',
    label: 'Panel Interview',
    description: 'Multi-interviewer round',
    templateQuestions: [
      {
        type: 'FOLLOW_UP',
        title: 'Opening',
        instructions:
          'Brief introduction to the panel and role overview.',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Leadership',
        instructions:
          'Tell us about a time you led a project or initiative. What was the outcome?',
      },
      {
        type: 'QUIZ_SHORT_ANSWER',
        title: 'Conflict resolution',
        instructions:
          'Describe a disagreement you had with a colleague. How did you resolve it?',
      },
    ],
  },
};
