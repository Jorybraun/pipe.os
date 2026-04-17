/**
 * AIChat — universal conversation component contracts.
 *
 * ConversationAdapter decouples the <AIChat> component from any specific
 * backend (role discovery, culture interview, candidate assessment).
 * Each feature provides its own adapter that implements this interface.
 */

import type {
  RoleContextQuestion,
  RoleContextProgress,
  CandidatePersona,
  GeneratedJobDescription,
} from '../../lib/api/types';

// ─── Adapter config ───────────────────────────────────────────────────────────

/** Passed to ConversationAdapter.initialize() when the session starts. */
export interface AdapterConfig {
  /** For role discovery: pre-collected baseline fields. */
  baseline?: Record<string, unknown>;
  questionBudget?: number;
  /** For candidate assessment: challenge ID + session token. */
  challengeId?: string;
  sessionToken?: string | null;
  /** Arbitrary extra config. */
  [key: string]: unknown;
}

// ─── Turn results ─────────────────────────────────────────────────────────────

export interface QuestionTurnResult {
  type: 'question';
  acknowledgment: string;
  question: RoleContextQuestion;
  progress: RoleContextProgress;
}

export interface SynthesisResult {
  type: 'synthesis';
  synthesis: string;
  persona: CandidatePersona | null;
  jobDescription: GeneratedJobDescription | null;
  progress: RoleContextProgress;
  /** Raw transcript — present for voice sessions. */
  transcript?: Array<{ role: 'user' | 'model'; text: string }>;
}

export type TurnResult = QuestionTurnResult | SynthesisResult;

// ─── PastExchange ─────────────────────────────────────────────────────────────

export interface PastExchange {
  questionId: string;
  acknowledgment: string;
  questionText: string;
  answer: string;
  feedback?: string;
}

// ─── Adapter interface ────────────────────────────────────────────────────────

/** Event emitted by respondStream */
export type StreamEvent =
  | { event: 'chunk'; text: string }
  | { event: 'done'; result: TurnResult }
  | { event: 'error'; message: string };

export interface ConversationAdapter {
  /**
   * One-time setup — called before the first question.
   * Must fire the first question (via the adapter's own state).
   */
  initialize(config: AdapterConfig): Promise<QuestionTurnResult>;
  /** Submit an answer, receive the next question or final synthesis. */
  respond(answer: string, questionId: string): Promise<TurnResult>;
  /**
   * Optional: streaming version of respond. Yields chunk events as tokens arrive,
   * then a done event with the final result. Falls back to respond if not implemented.
   */
  respondStream?(answer: string, questionId: string): AsyncGenerator<StreamEvent>;
  /** Trigger synthesis before the budget is exhausted. */
  completeEarly(): Promise<SynthesisResult>;
  /** Optional: flag a question for tuning. */
  submitFeedback?(questionId: string, feedback: string): Promise<void>;
}

// ─── Component props ──────────────────────────────────────────────────────────

import type { UseConversationResult } from '../../hooks/useConversation';

export interface AIChatProps {
  /**
   * Shared conversation state. The caller owns the `useConversation(adapter)`
   * instance and passes it in — AIChat never creates its own. This keeps the
   * page and the chat component reading the same phase/persona/synthesis so
   * the synthesis handoff (onComplete + SynthesisPhase) can't desync.
   */
  conv: UseConversationResult;
  /** Null until scripted intake is complete — AIChat stays IDLE until this is set. */
  initConfig: AdapterConfig | null;
  /** Enable Whisper-based voice transcription. Default: true. */
  enableVoice?: boolean;
  /** Enable Vertex AI Gemini Live real-time voice mode. Default: false. */
  enableLiveVoice?: boolean;
  /**
   * Start in live voice mode immediately when initConfig is set.
   * When true the HTTP turn loop is skipped — the voice agent owns the
   * conversation. Driven by the sq-mode scripted question answer.
   */
  defaultLiveMode?: boolean;
  /** Called when the conversation reaches synthesis. */
  onComplete?: (result: SynthesisResult) => void;
  /** Render the synthesis result (if omitted, a default view is shown). */
  renderSynthesis?: (result: SynthesisResult) => JSX.Element;
  /**
   * Render content above the conversation area.
   * Use this for scripted intake questions, JD import buttons, etc.
   */
  renderHeader?: () => JSX.Element;
  /** Show the Six Domain coverage bars during the interview. Default: false. */
  showDomainBars?: boolean;
  /** Auto-read AI questions aloud using Google Cloud TTS. Default: false. */
  enableTTS?: boolean;
  /**
   * Opening line spoken by the AI when the interview starts (before the first
   * question). Only plays in text/hybrid mode — skipped in live voice mode.
   * Example: "Hi, I'm Pipe's interview assistant. Let's get started."
   */
  greeting?: string;
  /**
   * Called when the user ends a live voice session early (taps END SESSION).
   * Use to navigate back to the Voice/Text mode selector without losing prior
   * scripted intake answers.
   */
  onLiveEnd?: () => void;
}
