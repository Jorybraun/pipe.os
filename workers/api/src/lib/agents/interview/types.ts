/**
 * Interview State Machine — Types
 *
 * Pure deterministic types for the role-discovery interview reducer.
 * No LLM references, no provider types. JSON-serializable everywhere.
 */

import type {
  RoleExchange,
  DomainCoverage,
  ConversationPhase,
  ParticipantRole,
} from '../../../types';

/**
 * The full interview state. This is the single source of truth.
 * The UI holds this, the reducer transforms it, the generators read it.
 */
export interface InterviewState {
  // ── Static (set once at creation) ──
  baseline: Record<string, unknown>;
  participantRole: ParticipantRole | null;
  questionBudget: number;

  // ── Dynamic (mutated by reducer) ──
  exchanges: RoleExchange[];
  knowledgeState: Record<string, Record<string, unknown>>;
  coverage: Record<string, DomainCoverage>;
  phase: ConversationPhase;
  questionsAsked: number;
  synthesisReady: boolean;
}

/**
 * Actions that drive the state machine. Every action is deterministic.
 */
export type InterviewAction =
  | {
      type: 'ANSWER';
      /** The user's answer text. */
      answer: string;
      /**
       * Optional knowledge-state update produced by the question generator
       * on the previous turn. When present, merged into state.knowledgeState
       * before phase re-computation.
       */
      knowledgeStateUpdate?: Record<string, Record<string, unknown>>;
      /**
       * Optional domain-coverage map produced by the question generator.
       * When present, written to state.coverage before phase re-computation.
       */
      domainCoverage?: Record<string, DomainCoverage>;
    }
  | { type: 'SKIP' }
  | { type: 'FORCE_SYNTHESIZE' };

/**
 * Input needed to create the initial state for a participant.
 */
export interface CreateInterviewStateInput {
  baseline: Record<string, unknown>;
  participantRole: ParticipantRole | null;
  questionBudget: number;
  /** Optional seed knowledge from previous participants (multi-stakeholder). */
  seedKnowledgeState?: Record<string, Record<string, unknown>>;
}
