/**
 * Types for the multi-turn code review conversation system.
 *
 * Aligned with the Code Review Arena research system:
 * research/code-review-arena/src/types.ts
 *
 * Key adaptation: In PIPE-OS the CANDIDATE is the reviewer (human)
 * and the IMPLEMENTER is the AI agent. The arena types are designed
 * for AI-vs-AI but the data model is the same.
 */

// ---------------------------------------------------------------------------
// Comment-level types
// ---------------------------------------------------------------------------

/** Category of a review comment — used by scorers, optionally set by candidate */
export type CommentCategory =
  | 'design'
  | 'functionality'
  | 'security'
  | 'complexity'
  | 'refactoring'
  | 'tests'
  | 'naming'
  | 'style_nit'
  | 'positive';

/** Severity of a review comment */
export type CommentSeverity = 'blocking' | 'major' | 'suggestion' | 'nit';

/**
 * A reviewer's comment on the PR.
 * In PIPE-OS, the candidate writes these via the DiffPanel annotation UI.
 */
export interface ReviewComment {
  /** Numeric ID, auto-incremented within a session */
  id: number;
  /** File path in the diff (if inline comment) */
  file?: string;
  /** Line number in the diff (if inline comment) */
  line?: number;
  /** Comment category */
  category: CommentCategory | null;
  /** Severity level */
  severity: CommentSeverity | null;
  /** What the issue is — the candidate's comment text */
  what: string;
  /** Why it matters — optional explanation */
  why: string;
  /** Suggested fix — optional */
  suggestion?: string;
  /** Whether this is a positive observation (not a bug) */
  positive: boolean;
}

// ---------------------------------------------------------------------------
// Implementer response types
// ---------------------------------------------------------------------------

/** The implementer's conversational move — only 3 moves per arena spec */
export type ImplementerMove = 'comment' | 'change' | 'pushback';

/**
 * The implementer agent's response to a specific review comment.
 */
export interface ImplementerResponse {
  /** Links back to ReviewComment.id */
  to_comment_id: number;
  /** How the implementer responded */
  move: ImplementerMove;
  /** The response text */
  content: string;
  /** Updated code snippet if the implementer made a change */
  updated_code?: string;
}

// ---------------------------------------------------------------------------
// Follow-up and thread resolution types
// ---------------------------------------------------------------------------

/**
 * Reviewer follow-up patterns — how the candidate responds to implementer pushback.
 * Classified by the scoring panel, not set by the candidate directly.
 */
export type ReviewerFollowUpPattern =
  | 'defended_with_reasoning'
  | 'asked_clarifying_question'
  | 'conceded_with_reasoning'
  | 'taught_concept'
  | 'provided_code_example'
  | 'verified_fix'
  | 'caught_incomplete_fix'
  | 'caved_without_evaluating'
  | 'repeated_same_point'
  | 'escalated_tone'
  | 'accepted_without_checking'
  | 'abandoned_thread';

/** How a conversation thread was resolved */
export type ThreadResolution =
  | 'fix_agreed'
  | 'conceded_with_reasoning'
  | 'deferred'
  | 'dangling'
  | 'rubber_stamped';

// ---------------------------------------------------------------------------
// Round-level types (chronological transcript)
// ---------------------------------------------------------------------------

/** Overall verdict the reviewer can submit */
export type ReviewVerdict = 'approve' | 'request_changes' | 'comment_only';

/**
 * A single round of review: reviewer comments + implementer responses.
 * Rounds are the primary transcript structure (chronological).
 */
export interface ReviewRound {
  /** 1-indexed round number */
  round: number;
  /** Comments the reviewer (candidate) submitted this round */
  reviewer_comments: ReviewComment[];
  /** Verdict submitted with this round's comments (optional) */
  reviewer_verdict?: ReviewVerdict;
  /** Summary text submitted with the round (optional) */
  reviewer_summary?: string;
  /** Implementer agent responses to this round's comments */
  implementer_responses: ImplementerResponse[];
}

// ---------------------------------------------------------------------------
// Thread-level types (per-comment view, computed from rounds)
// ---------------------------------------------------------------------------

/** A single exchange within a thread */
export interface ThreadExchange {
  /** Which round this exchange happened in */
  round: number;
  /** Who acted in this exchange */
  actor: 'implementer' | 'reviewer';
  /** Implementer's move (if actor is implementer) */
  move?: ImplementerMove;
  /** Reviewer's follow-up pattern (if actor is reviewer, classified by scorer) */
  pattern?: ReviewerFollowUpPattern;
  /** The text content */
  content: string;
  /** Updated code snippet when implementer made a change (move=change) */
  updated_code?: string;
}

/**
 * A conversation thread anchored to a specific review comment.
 * Computed from ReviewRound[] by grouping exchanges per comment_id.
 */
export interface Thread {
  /** The original comment that started this thread */
  comment_id: number;
  /** The original ReviewComment */
  comment: ReviewComment;
  /** Ordered exchanges after the initial comment */
  exchanges: ThreadExchange[];
  /** How the thread was resolved (set by scorer or inferred) */
  resolution: ThreadResolution;
}

// ---------------------------------------------------------------------------
// Transcript types
// ---------------------------------------------------------------------------

/** Implementer persona tier */
export type ImplementerTier = 'junior' | 'senior';

/**
 * The full structured transcript for a review session.
 * Stored in review_sessions.transcript as JSON.
 */
export interface StructuredTranscript {
  /** Exercise case ID (if applicable) */
  caseId?: string;
  /** Implementer persona used */
  implementerPersona: ImplementerTier;
  /** PR context */
  pr: {
    brief: string;
    diff: string;
    commitMessages?: string[];
  };
  /** Chronological rounds */
  rounds: ReviewRound[];
  /** Per-comment thread view (computed from rounds) */
  threads: Thread[];
  /** Total rounds completed */
  totalRounds: number;
  /** Final verdict */
  finalVerdict: ReviewVerdict | null;
}

// ---------------------------------------------------------------------------
// Session-level types
// ---------------------------------------------------------------------------

/**
 * A complete review session for a multi-turn code review challenge.
 * Stored server-side in review_sessions; a subset lives in submission state.
 */
export interface ReviewSession {
  /** Server-assigned session ID (null until first submission) */
  sessionId: string | null;
  /** Chronological round data */
  rounds: ReviewRound[];
  /** Per-comment thread view (computed from rounds for display) */
  threads: Thread[];
  /** Current round number (1-indexed) */
  currentRound: number;
  /** Maximum rounds allowed for this challenge */
  maxRounds: number;
  /** Final verdict (null until explicitly submitted) */
  verdict: ReviewVerdict | null;
  /** Overall review summary text */
  summary: string;
  /** True while waiting for the implementer agent to respond */
  isAwaitingResponse: boolean;
  /** Next comment ID to assign (auto-increment) */
  nextCommentId: number;
}

// ---------------------------------------------------------------------------
// Scoring report types — 4 scorers per arena spec
// ---------------------------------------------------------------------------

/** Band classification for scoring dimensions */
export type ScoreBand = 'strong' | 'adequate' | 'weak';

// ── Comment & thread evaluations (produced by scorers) ──

export interface CommentEvaluation {
  comment_id: number;
  matched_bug_id: number | null;
  category_correct: boolean;
  severity_correct: boolean;
  reasoning_quality: 'precise' | 'directional' | 'vague' | 'wrong';
  is_false_positive: boolean;
}

export interface ThreadEvaluation {
  comment_id: number;
  implementer_move: ImplementerMove;
  reviewer_response: ReviewerFollowUpPattern;
  resolution: ThreadResolution;
  quality: 'strong' | 'neutral' | 'weak';
}

// ── Technical score (weight: 30%) ──

export interface TechnicalScore {
  score: number;
  bug_detection: number;
  root_cause_depth: number;
  technical_accuracy: number;
  design_awareness: number;
  fix_quality: number;
  false_positive_discipline: number;
  severity_calibration: number;
  comment_evaluations: CommentEvaluation[];
  bugs_found: number[];
  bugs_missed: number[];
  false_positive_count: number;
  severity_accuracy: number;
  tradeoffs_identified: number[];
  impact_ratio: number;
  summary: string;
}

// ── Conversation score (weight: 30%) ──

export interface ConversationScore {
  score: number;
  pushback_handling: number;
  explanation_clarity: number;
  guidance_effectiveness: number;
  clarifying_questions: number;
  fix_verification: number;
  thread_resolution: number;
  concession_quality: number;
  teaching_depth: number;
  thread_evaluations: ThreadEvaluation[];
  defenses: number;
  caves_without_evaluating: number;
  threads_resolved: number;
  threads_dangling: number;
  summary: string;
}

// ── Practice score (weight: 25%) ──

export interface PracticeScore {
  score: number;
  bug_prioritization: number;
  accuracy_discipline: number;
  comment_substance: number;
  verdict_quality: number;
  craft_observations: number;
  coverage: number;
  positive_recognition: number;
  bugs_found_ids: number[];
  bugs_missed_ids: number[];
  false_positive_count: number;
  files_reviewed: number;
  files_in_pr: number;
  coverage_ratio: number;
  reviews_tests: boolean;
  nit_ratio: number;
  verdict_type: 'approve' | 'request_changes' | 'rubber_stamp' | 'no_verdict';
  summary: string;
}

// ── Effectiveness score (weight: 15% — deterministic, no LLM) ──

export interface EffectivenessScore {
  /** Review Impact Score: severity-weighted bug detection (0-100) */
  ris: number;
  /** Signal-to-noise ratio (0-100) */
  efficiency: number;
  /** Semantic depth: % of critical+major bugs found (0-100) */
  delta: number;
  /** Weighted composite: 0.50*ris + 0.30*efficiency + 0.20*delta (0-100) */
  score: number;
}

// ── Overall scoring report ──

/**
 * Structured scoring report produced by the 4-scorer panel.
 * Stored in review_sessions.score_report after verdict is submitted.
 *
 * Weights: technical 30% + conversation 30% + practice 25% + effectiveness 15%
 */
export interface ScoringReport {
  technical: TechnicalScore;
  conversation: ConversationScore;
  practice: PracticeScore;
  effectiveness: EffectivenessScore;
  overall: {
    /** 0-100 weighted composite */
    score: number;
    /** strong (75-100), adequate (45-74), weak (0-44) */
    band: ScoreBand;
    /** Hiring manager narrative summary */
    narrative: string;
    /** Key strengths identified */
    strengths: string[];
    /** Key areas for improvement */
    growth_areas: string[];
  };
}

// ---------------------------------------------------------------------------
// Comprehension Review types (blind comprehension mode)
// ---------------------------------------------------------------------------

/** Challenge review mode */
export type ReviewMode = 'bug_finding' | 'comprehension';

/** Verdict options for comprehension mode */
export type ComprehensionVerdict = 'approve' | 'request_changes' | 'needs_more_context';

/** Tags describing what context the explainer provided */
export type ContextTag = 'architecture' | 'data_flow' | 'surrounding_code' | 'trade_off' | 'problem_context' | 'integration';

/** Depth level of an explainer response */
export type DepthLevel = 'surface' | 'moderate' | 'deep';

/** A candidate's question in a comprehension session */
export interface ComprehensionQuestion {
  text: string;
  file?: string;
  line?: number;
}

/** The explainer agent's response to a question */
export interface ExplainerResponse {
  /** Markdown content, may contain ```mermaid code blocks */
  content: string;
  /** Tags for what context was provided (used by scorer) */
  context_provided: ContextTag[];
  /** Depth level of the answer (used by scorer) */
  depth_level: DepthLevel;
}

/** A single Q&A exchange in a comprehension session */
export interface ComprehensionExchange {
  round: number;
  question: ComprehensionQuestion;
  answer: ExplainerResponse;
}

/** Transcript format for comprehension sessions (stored in review_sessions.transcript) */
export interface ComprehensionTranscript {
  mode: 'comprehension';
  exchanges: ComprehensionExchange[];
  verdict?: {
    decision: ComprehensionVerdict;
    rationale: string;
    submittedAt: string;
  };
}

/** Ground truth insight categories */
export type InsightCategory = 'purpose' | 'tradeoff' | 'architecture' | 'risk' | 'integration';

/** Importance level for a key insight */
export type InsightImportance = 'critical' | 'major' | 'minor';

/** A single key insight in the comprehension ground truth */
export interface KeyInsight {
  id: number;
  category: InsightCategory;
  insight: string;
  depth: DepthLevel;
  importance: InsightImportance;
}

/** Ground truth for comprehension challenges (stored in challenges.ground_truth) */
export interface ComprehensionGroundTruth {
  mode: 'comprehension';
  keyInsights: KeyInsight[];
  idealVerdict: ComprehensionVerdict;
  idealRationale: string;
}

/** Repo knowledge document (stored in challenges.server_config.repoKnowledge) */
export interface RepoKnowledge {
  architecture: {
    overview: string;
    components: Array<{ name: string; description: string; file?: string }>;
    dataFlow?: string;
  };
  designDecisions: Array<{
    id: number;
    decision: string;
    reason: string;
    alternatives: string[];
    tradeoffs: string;
  }>;
  surroundingCode: Record<string, string>;
  prContext: {
    problemSolved: string;
    approach: string;
    keyFiles: string[];
  };
}

/** Session state for comprehension mode (frontend) */
export interface ComprehensionSession {
  sessionId: string | null;
  exchanges: ComprehensionExchange[];
  currentRound: number;
  maxRounds: number;
  verdict: ComprehensionVerdict | null;
  rationale: string;
  isAwaitingResponse: boolean;
}

// ── Comprehension scoring report types ──

export interface QuestionQualityScore {
  score: number;
  strategic_questioning: number;
  depth_progression: number;
  specificity: number;
  coverage: number;
  efficiency: number;
  probing_skill: number;
  summary: string;
}

export interface ComprehensionScore {
  score: number;
  insight_coverage: number;
  mental_model_accuracy: number;
  context_synthesis: number;
  misconception_avoidance: number;
  depth_of_understanding: number;
  insights_discovered: number[];
  insights_missed: number[];
  summary: string;
}

export interface DecisionQualityScore {
  score: number;
  verdict_alignment: number;
  rationale_quality: number;
  tradeoff_awareness: number;
  risk_identification: number;
  proportionality: number;
  summary: string;
}

export interface ComprehensionEfficiencyScore {
  /** Key insights discovered / total questions asked */
  questions_to_insight_ratio: number;
  /** How early core insights were reached (0-100) */
  round_efficiency: number;
  /** Deduction for redundant questions (0-100, higher = less redundancy) */
  redundancy_score: number;
  /** Weighted composite (0-100) */
  score: number;
}

export interface ComprehensionScoringReport {
  question_quality: { score: number; dimensions: QuestionQualityScore; summary: string };
  comprehension: { score: number; dimensions: ComprehensionScore; insights_discovered: number[]; insights_missed: number[]; summary: string };
  decision_quality: { score: number; dimensions: DecisionQualityScore; summary: string };
  efficiency: ComprehensionEfficiencyScore;
  overall: {
    score: number;
    band: ScoreBand;
    narrative: string;
    strengths: string[];
    growth_areas: string[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes Thread[] view from ReviewRound[] by grouping exchanges per comment_id.
 * This is a pure function — no side effects.
 */
export function buildThreadsFromRounds(rounds: ReviewRound[]): Thread[] {
  const threadMap = new Map<number, Thread>();

  for (const round of rounds) {
    // Register each reviewer comment as a thread root (if new)
    for (const comment of round.reviewer_comments) {
      if (!threadMap.has(comment.id)) {
        threadMap.set(comment.id, {
          comment_id: comment.id,
          comment,
          exchanges: [],
          resolution: 'dangling',
        });
      } else {
        // Follow-up comment in a later round — add as reviewer exchange
        const thread = threadMap.get(comment.id)!;
        thread.exchanges.push({
          round: round.round,
          actor: 'reviewer',
          content: comment.what,
        });
      }
    }

    // Add implementer responses as exchanges
    for (const resp of round.implementer_responses) {
      const thread = threadMap.get(resp.to_comment_id);
      if (thread) {
        thread.exchanges.push({
          round: round.round,
          actor: 'implementer',
          move: resp.move,
          content: resp.content,
          ...(typeof resp.updated_code === 'string' ? { updated_code: resp.updated_code } : {}),
        });

        // Infer resolution from move
        if (resp.move === 'change') {
          thread.resolution = 'fix_agreed';
        }
      }
    }
  }

  return Array.from(threadMap.values());
}
