/**
 * Type definitions for Question Agent Lambda
 *
 * These types are duplicated from src/types/discovery.ts to avoid
 * dependencies between Lambda and frontend code.
 */

export interface Baseline {
  title: string;
  level: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'lead' | 'manager';
  department: string;
  workModel: 'remote' | 'hybrid' | 'onsite';
  teamSize: string;
  reportsTo: string;
  stack: string[];
}

export interface Exchange {
  id: string;
  questionId: string;
  agentQuestion: string;
  userResponse: string;
  extractedFacts: string[];
  timestamp: number;
}

export type DynamicContext = Record<string, string | string[]>;

export type DiscoveryStatus = 'baseline' | 'exploring' | 'almost_ready' | 'ready';

export interface RoleContext {
  id: string;
  baseline: Baseline | null;
  exchanges: Exchange[];
  context: DynamicContext;
  status: DiscoveryStatus;
  gaps: string[];
  createdAt: number;
  updatedAt: number;
  userSignals?: {
    knowledgeDepth: 'surface' | 'moderate' | 'deep';
    personaSignals: ('recruiter' | 'hiring_manager' | 'tech_lead')[];
    uncertaintyFlags: string[];
  };
}

export interface Question {
  id: string;
  text: string;
  type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
  options?: string[];
  placeholder?: string;
  helpText?: string;
  targetContext?: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

export interface QuestionAgentRequest {
  roleContext: RoleContext;
  responses?: Array<{
    questionId: string;
    response: string | string[];
  }>;
}

export interface QuestionAgentResponse {
  updatedContext: DynamicContext;
  newExchanges: Exchange[];
  nextSection: FormSection | null;
  status: DiscoveryStatus;
  gaps: string[];
  userSignals?: RoleContext['userSignals'];
  reasoning: string;
  costTracking: {
    sessionCost: number;
    remainingBudget: number;
    callCount: number;
  };
  processingTime: number;
}

// Internal agent step outputs

export interface ExtractorOutput {
  extractedFacts: string[];
  contextUpdates: DynamicContext;
  userSignals?: {
    knowledgeDepth: 'surface' | 'moderate' | 'deep';
    personaSignals: ('recruiter' | 'hiring_manager' | 'tech_lead')[];
    uncertaintyFlags: string[];
  };
  contradictions: string[];
  implicitSignals: Array<{ signal: string; evidence: string }>;
}

export interface AssessorOutput {
  status: DiscoveryStatus;
  gaps: string[];
  confidence: {
    role_clarity: number;
    success_definition: number;
    challenges: number;
    team_dynamics: number;
    culture_signals: number;
    technical_depth: number;
  };
  reasoning: string;
}

export interface GeneratorOutput {
  section: FormSection;
  reasoning: string;
}

export interface ReviewerOutput {
  approved: boolean;
  issues: Array<{ questionId: string; issue: string; suggestion: string }>;
  feedback: string;
}
