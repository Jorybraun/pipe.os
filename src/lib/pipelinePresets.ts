import { TEMPLATE_BY_ID } from '../content/challengeLibrary';

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

export interface PresetChallenge {
  type: ChallengeType;
  title: string;
  instructions: string;
  config: any;
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

// Helper to pull from library
const fromLibrary = (id: string) => {
  const template = TEMPLATE_BY_ID[id];
  if (!template) {
    console.warn(`[Presets] Template not found: ${id}`);
    return null;
  }
  return {
    type: template.type,
    title: template.title,
    instructions: template.instructions,
    config: template.config,
  };
};

export const PIPELINE_PRESETS: Record<string, PipelinePreset> = {
  DEFAULT: {
    id: 'DEFAULT',
    name: 'Default MVP',
    description: 'Includes a Code Review challenge and a Technical Quiz.',
    stages: [
      {
        name: 'Technical Assessment',
        challenges: [
          fromLibrary('cr-jwt-auth-bypass'),
          fromLibrary('mcq-react-use-effect'),
          fromLibrary('mcq-ts-interface-vs-type'),
        ].filter(Boolean) as PresetChallenge[]
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
