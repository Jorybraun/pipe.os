/**
 * Type definitions for Job Description Agent Lambda
 */

import type {
  Baseline,
  Exchange,
  DynamicContext,
} from '../questionAgent/types';

export { Baseline, Exchange, DynamicContext };

export interface RoleContext {
  id: string;
  baseline: Baseline | null;
  exchanges: Exchange[];
  context: DynamicContext;
  status: 'baseline' | 'exploring' | 'almost_ready' | 'ready';
  gaps: string[];
  createdAt: number;
  updatedAt: number;
}

export interface JobDescriptionRequest {
  roleContext: RoleContext;
}

export interface JobDescriptionResponse {
  jobDescription: JobDescription;
  candidateFilters: CandidateFilter[];
  suggestedStages: SuggestedStage[];
  processingTime: number;
}

export interface JobDescription {
  title: string;
  summary: string;
  responsibilities: string[];
  requirements: {
    required: string[];
    preferred: string[];
  };
  successIndicators: string[];
  teamContext: string;
  growthOpportunity: string;
  rawMarkdown: string;
}

export interface CandidateFilter {
  id: string;
  category: 'experience' | 'skills' | 'traits' | 'logistics';
  label: string;
  required: boolean;
  derivedFrom: string;
}

export interface SuggestedStage {
  id: string;
  type: 'technical_screen' | 'coding' | 'system_design' | 'behavioral' | 'culture_fit' | 'hiring_manager' | 'team_interview' | 'presentation';
  name: string;
  rationale: string;
  focusAreas: string[];
  suggestedDuration: number;
  order: number;
}
