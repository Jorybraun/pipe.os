/**
 * Pipeline templates — curated starter sets of stages + challenges for common roles.
 *
 * Used by the empty-state "USE_TEMPLATE" action on OverviewPage: picking a template
 * creates all its stages in order and seeds each stage with the template questions
 * defined on its StageType (see `stageTemplates.ts`). Challenges are created via
 * `POST /api/v1/stages/:stageId/challenges` using the same shape as manual adds.
 *
 * Templates are intentionally deterministic — no AI calls. The "AI interview"
 * option is a separate flow.
 */

import { STAGE_TYPE_CONFIGS, type StageType } from './stageTemplates';
import type { ChallengeType } from './api/types';

export interface PipelineTemplateStage {
  /** StageType — determines which template questions are seeded. */
  stageType: StageType;
  /** Custom title for the stage (overrides the default type label). */
  title: string;
}

export interface PipelineTemplate {
  key: string;
  label: string;
  description: string;
  /** Accent color used by the template card in the picker UI. */
  accent: string;
  stages: PipelineTemplateStage[];
}

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    key: 'FRONTEND_ENGINEER',
    label: 'Frontend Engineer',
    description: 'Screening → Technical → Code Review → Panel',
    accent: '#60a5fa',
    stages: [
      { stageType: 'SCREENING', title: 'Screening' },
      { stageType: 'TECHNICAL', title: 'Technical' },
      { stageType: 'CODE_REVIEW', title: 'Code Review' },
      { stageType: 'PANEL', title: 'Panel' },
    ],
  },
  {
    key: 'BACKEND_ENGINEER',
    label: 'Backend Engineer',
    description: 'Screening → Technical → Code Review → Panel',
    accent: '#a78bfa',
    stages: [
      { stageType: 'SCREENING', title: 'Screening' },
      { stageType: 'TECHNICAL', title: 'Technical' },
      { stageType: 'CODE_REVIEW', title: 'Code Review' },
      { stageType: 'PANEL', title: 'Panel' },
    ],
  },
  {
    key: 'FULL_STACK',
    label: 'Full-Stack Engineer',
    description: 'Screening → Cultural → Technical → Code Review → Panel',
    accent: '#4ade80',
    stages: [
      { stageType: 'SCREENING', title: 'Screening' },
      { stageType: 'CULTURAL', title: 'Cultural Fit' },
      { stageType: 'TECHNICAL', title: 'Technical' },
      { stageType: 'CODE_REVIEW', title: 'Code Review' },
      { stageType: 'PANEL', title: 'Panel' },
    ],
  },
  {
    key: 'LEAN',
    label: 'Lean Loop',
    description: 'Screening → Technical → Panel',
    accent: '#fbbf24',
    stages: [
      { stageType: 'SCREENING', title: 'Screening' },
      { stageType: 'TECHNICAL', title: 'Technical' },
      { stageType: 'PANEL', title: 'Panel' },
    ],
  },
];

/**
 * Expand a template into the concrete stage + challenge payloads needed to
 * call `createStage` and `createChallenge`. Challenges come from the stage
 * type's `templateQuestions`.
 */
export interface ResolvedTemplateStage {
  title: string;
  stageType: StageType;
  challenges: {
    type: ChallengeType;
    title: string;
    instructions: string;
  }[];
}

export function resolveTemplate(template: PipelineTemplate): ResolvedTemplateStage[] {
  return template.stages.map((stage) => ({
    title: stage.title,
    stageType: stage.stageType,
    challenges: STAGE_TYPE_CONFIGS[stage.stageType].templateQuestions.map((q) => ({
      type: q.type,
      title: q.title,
      instructions: q.instructions,
    })),
  }));
}
