/**
 * Unified Agent Runtime — Core Types
 *
 * Generic data shapes shared across all AI interview agents.
 */

import type { LLMProvider, LLMTool } from '../llm/types';

export type AgentType = 'role_discovery' | 'code_review' | 'culture_interview';

export type SessionState = 'consent' | 'in_progress' | 'scoring' | 'complete' | 'error';

export interface AgentSession {
  id: string;
  agentType: AgentType;
  challengeId: string | undefined;
  candidateId: string | undefined;
  state: SessionState;
  consentAt: string | undefined;
  transcript: AgentTranscript;
  scoreReport: ScoreReport | undefined;
  evalResults: EvalGateResult[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTranscript {
  turns: AgentTurn[];
  scratchpad: Record<string, unknown>;
}

export interface AgentTurn {
  idx: number;
  questionId: string | undefined;
  questionText: string;
  candidateResponse: string | undefined;
  metadata: Record<string, unknown> | undefined;
  timestamp: string;
}

export interface ScoreDimension {
  id: string;
  score: number;
  weight: number;
  evidenceQuotes: string[];
  confidence: number;
}

export interface ScoreReport {
  dimensions: ScoreDimension[];
  narrative: string | undefined;
  recommendation: 'hire' | 'flag' | 'pass' | undefined;
}

export interface FSMConfig {
  canAdvance: (session: AgentSession) => boolean;
  canTerminate: (session: AgentSession) => boolean;
  minTurns: number;
  maxTurns: number;
}

export interface ProviderCallOptions {
  forceJson: boolean | undefined;
  maxTokens: number | undefined;
  tools: LLMTool[] | undefined;
  budgetLabel: string | undefined;
  signal: AbortSignal | undefined;
}

export interface ProviderCallResult {
  content: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined } | undefined;
}

export type UsageCallback = (payload: {
  budgetLabel: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  model: string | undefined;
}) => void | Promise<void>;

export type ApprovalRule = 'all_pass' | 'no_fail' | 'weighted';

export interface EvalDimensionConfig {
  id: string;
  promptTemplate: string;
  model: string | undefined;
  weight: number | undefined;
}

export interface EvalDimension {
  id: string;
  verdict: 'pass' | 'fail' | 'warn';
  score: number;
  reason: string;
}

export interface EvalConfig {
  dimensions: EvalDimensionConfig[];
  approvalRule: ApprovalRule;
  minScore: number | undefined;
  maxRetries: number | undefined;
}

export interface EvalGateResult {
  approved: boolean;
  dimensions: EvalDimension[];
  rewrite: string | undefined;
}

export interface ScoringDimensionConfig {
  id: string;
  weight: number;
  promptTemplate: string;
  model: string | undefined;
}

export interface ScoringConfig {
  dimensions: ScoringDimensionConfig[];
  groundingRequirement: boolean;
  synthesisTemplate: string | undefined;
}

export interface SessionStore {
  createSession(agentType: AgentType, challengeId: string | undefined, candidateId: string | undefined): Promise<AgentSession>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  getSessionByToken(token: string): Promise<AgentSession | null>;
  updateSession(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession>;
  appendTurn(sessionId: string, turn: AgentTurn): Promise<AgentSession>;
}

export interface AgentPlugin {
  type: AgentType;
  fsmConfig: FSMConfig;
  generateTurn(session: AgentSession, context: unknown, provider: LLMProvider | null): Promise<AgentTurn>;
  evalConfig: EvalConfig | undefined;
  scoringConfig: ScoringConfig | undefined;
}
