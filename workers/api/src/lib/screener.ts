/**
 * Default automatic screener stage with basic candidate screening questions.
 *
 * Injected as the first stage (sortOrder = 0) for every newly created pipeline.
 * Existing preset/auto-build stages are shifted down by 1.
 */

import type { PresetStage, PresetChallenge } from './presets';

const SCREENING_QUESTIONS: PresetChallenge[] = [
  {
    type: 'INTAKE',
    title: 'Profile & Resume',
    instructions: 'Upload your CV/resume and share your GitHub or LinkedIn profiles. This helps us understand your background before the screening questions.',
    config: {
      title: 'Profile & Resume',
      description: 'Upload your CV/resume and share any profiles that help us understand your background.',
      allowSkip: true,
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Years of Experience',
    instructions: 'How many years of professional software engineering experience do you have?',
    config: {
      question: 'How many years of professional software engineering experience do you have?',
      placeholder: 'e.g. 5 years',
      maxLength: 200,
      inputMode: 'text',
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Current Role & Company',
    instructions: 'What is your current role and company?',
    config: {
      question: 'What is your current role and company?',
      placeholder: 'e.g. Senior Frontend Engineer at Acme Corp',
      maxLength: 300,
      inputMode: 'text',
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Motivation',
    instructions: 'Why are you interested in this role and what excites you about it?',
    config: {
      question: 'Why are you interested in this role and what excites you about it?',
      placeholder: 'Tell us what drew you to this opportunity...',
      maxLength: 1000,
      inputMode: 'text',
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Availability & Notice Period',
    instructions: 'What is your notice period or earliest start date?',
    config: {
      question: 'What is your notice period or earliest start date?',
      placeholder: 'e.g. 2 weeks, available immediately, etc.',
      maxLength: 300,
      inputMode: 'text',
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Salary Expectations',
    instructions: 'What are your salary expectations (base + any equity/bonus requirements)?',
    config: {
      question: 'What are your salary expectations (base + any equity/bonus requirements)?',
      placeholder: 'e.g. $150K–$180K base',
      maxLength: 300,
      inputMode: 'text',
    },
  },
  {
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Work Authorization',
    instructions: 'Are you legally authorized to work in the country where this role is based?',
    config: {
      question: 'Are you legally authorized to work in the country where this role is based?',
      placeholder: 'Yes / No / Requires sponsorship',
      maxLength: 300,
      inputMode: 'text',
    },
  },
];

export const DEFAULT_SCREENER_STAGE: PresetStage = {
  title: 'Automatic Screener',
  description: 'Basic candidate screening questions to assess fit before technical evaluation.',
  sortOrder: 0,
  challenges: SCREENING_QUESTIONS,
};

/**
 * Returns a copy of the default screener stage with challenges shifted by the given offset.
 * Used when inserting the screener before existing preset/auto-build stages.
 */
export function getScreenerStage(): PresetStage {
  return {
    ...DEFAULT_SCREENER_STAGE,
    challenges: DEFAULT_SCREENER_STAGE.challenges.map((c, i) => ({
      ...c,
      // challenges don't have an order field in PresetChallenge, but we rely on array index
    })),
  };
}
