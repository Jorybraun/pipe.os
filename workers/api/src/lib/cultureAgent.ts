/**
 * Culture Interview Agent — FSM + analysis loop (ADR-029).
 *
 * ### What this module does
 *
 * Drives a single turn of the culture interview. The caller (a route handler)
 * loads the session row from D1, passes its transcript + the candidate's
 * latest answer to `advanceCultureInterview`, and receives one of three
 * outcomes:
 *
 *   1. **probe**   — ask a follow-up on the same question. Transcript is
 *                    updated with the probe turn (pending candidate reply).
 *   2. **next**    — ask the next bank question. Transcript is updated with
 *                    the new turn (pending candidate reply). Coverage is
 *                    bumped for the answered question's primary dimension.
 *   3. **terminate** — we have enough signal (or hit the hard cap). The
 *                    caller should transition the session to \`scoring\` and
 *                    kick off the scorer pipeline.
 *
 * There is one special case: the FIRST call on a fresh session has no
 * candidate answer yet and just returns the first question to ask. That
 * path is `startCultureInterview`.
 *
 * ### Why this split (not one big function)
 *
 * Mirrors the roleAgent pattern: start = deterministic kickoff, advance =
 * per-turn analysis + decision. Keeps the route handler simple and makes
 * unit testing straightforward — `advanceCultureInterview` is pure given
 * its inputs (plus the LLM provider, which tests mock).
 *
 * ### What this module does NOT do
 *
 *   - It does NOT call the D1 database directly. The caller owns persistence.
 *   - It does NOT generate seed questions — those come from the bank.
 *   - It does NOT run the scorer. The scorer is a separate module
 *     (`cultureScorer.ts`) invoked when this module returns `terminate`.
 *   - It does NOT handle the consent gate. The route handler enforces that
 *     before this module is ever invoked.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import {
  CULTURE_QUESTION_BANK,
  COMPETENCY_DIMENSIONS,
  pickNextQuestion,
  getQuestionById,
  emptyCoverage,
  type CultureQuestion,
  type CompetencyDimension,
  type SeniorityTag,
  type StarSlot,
} from './cultureQuestionBank';
import {
  buildCultureAgentSystemPrompt,
  buildCultureAgentTurnMessage,
  type AgentTurnContext,
  type AgentTurnJsonResponse,
} from './cultureAgentPrompts';
import { coerceProbePattern } from './cultureProbePatterns';
import type { RoleOverlayId } from './cultureRoleOverlay';
import type { RoleProbeBank } from './cultureProbeBank';

// ─── Transcript shape ────────────────────────────────────────────────────────
// Stored as JSON in `culture_interview_sessions.transcript`. Keep this shape
// tight — additions require a migration or a versioning strategy.

export interface CultureTurn {
  /** 0-based position in the transcript. */
  idx: number;
  /** Bank question ID this turn belongs to. */
  questionId: string;
  /** The exact text asked (may be a probe rephrasing of the bank question). */
  questionText: string;
  /**
   * If this turn is a probe, the question-id it probes. Null for the initial
   * turn on a question (i.e. bank text).
   */
  probeOf: string | null;
  /**
   * The candidate's response. Null when the turn has been asked but the
   * candidate has not yet answered (i.e. pending). Populated once the next
   * `advanceCultureInterview` call carries their answer.
   */
  candidateResponse: string | null;
  /**
   * STAR slot analysis from the LLM. Null on probe-pending turns (the probe
   * hasn't been answered yet) and on the final turn before termination.
   */
  starSlots: Record<StarSlot, { present: boolean; specificity: number }> | null;
  /** ISO timestamp when this turn was generated. */
  timestamp: string;
}

export interface QuestionMetadata {
  questionText: string;
  targetDimension: string;
  personalizationAnchors: string[];
}

export interface CultureScratchpad {
  /** Count of how many complete STAR answers we have per dimension. */
  dimensionCoverage: Record<CompetencyDimension, number>;
  /** How many probes have been asked for the current (active) question. */
  probesUsedForCurrentQ: number;
  /** Short running observations the agent emits as it goes. */
  runningThemes: string[];
  /** Interview mode — 'profile_builder' (Mode-1) or 'role_fit' (Mode-2). */
  mode?: 'profile_builder' | 'role_fit';
  /** Metadata for each generatively-produced question (audit trail). */
  questionMetadata?: QuestionMetadata[];
}

export interface CultureTranscript {
  turns: CultureTurn[];
  scratchpad: CultureScratchpad;
}

/**
 * Default transcript for a brand-new session. Mirrors the DEFAULT in the
 * migration so callers can .parse(row.transcript) || defaultTranscript().
 */
export function defaultCultureTranscript(): CultureTranscript {
  return {
    turns: [],
    scratchpad: {
      dimensionCoverage: emptyCoverage(),
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode: 'profile_builder',
      questionMetadata: [],
    },
  };
}

// ─── Public: start and advance ───────────────────────────────────────────────

export interface StartCultureInterviewInput {
  /**
   * Optional candidate seniority override. When provided, the bank is
   * filtered so only questions calibrated for this seniority level are
   * eligible. Usually derived from the role context.
   */
  seniority?: SeniorityTag | null;
  /**
   * Role overlay id derived from the Role Discovery Agent persona. Drives
   * dimension weights and tag preferences in the selector.
   */
  roleOverlayId?: RoleOverlayId | null;
  /**
   * RCD-derived enriched probe bank (ADR-036 Phase 2). When populated, the
   * selector biases toward questions whose dimensions have team-specific
   * probes and merges them into the picked question's probe library.
   */
  probeBank?: RoleProbeBank | undefined;
}

export interface StartCultureInterviewResult {
  transcript: CultureTranscript;
  /** The first question the candidate should see. */
  nextQuestion: {
    questionId: string;
    text: string;
  };
}

/**
 * Called once when a session transitions from `consent` to `in_progress`.
 * Returns the first question to ask plus the initial transcript state.
 * Does NOT call the LLM — the first question is deterministic from the bank.
 */
export function startCultureInterview(input: StartCultureInterviewInput = {}): StartCultureInterviewResult {
  const transcript = defaultCultureTranscript();
  const first = pickNextQuestion({
    coverage: transcript.scratchpad.dimensionCoverage,
    askedIds: new Set(),
    seniority: input.seniority,
    roleOverlayId: input.roleOverlayId,
    runningThemes: [],
    probeBank: input.probeBank,
  });
  if (!first) {
    throw new Error('Culture interview bank is empty — cannot start interview.');
  }

  transcript.turns.push({
    idx: 0,
    questionId: first.id,
    questionText: first.text,
    probeOf: null,
    candidateResponse: null,
    starSlots: null,
    timestamp: new Date().toISOString(),
  });

  return {
    transcript,
    nextQuestion: { questionId: first.id, text: first.text },
  };
}

export interface AdvanceCultureInterviewInput {
  provider: LLMProvider | null;
  /** The mutable-ish transcript loaded from D1 (will be cloned; not mutated). */
  transcript: CultureTranscript;
  /** Candidate's verbatim answer to the currently-pending question. */
  candidateAnswer: string;
  /** Hard cap on total questions — 20 per ADR-029. */
  maxQuestions?: number;
  /** Minimum questions before termination is allowed — 5 per ADR-029. */
  minQuestions?: number;
  /** Optional seniority filter for question selection. */
  seniority?: SeniorityTag | null;
  /**
   * Role overlay id derived from the Role Discovery Agent persona at session
   * boot. When set, the selector applies dimension weights and tag preferences
   * from `knowledge/culture/role-overlays/{id}.md`.
   */
  roleOverlayId?: RoleOverlayId | null;
  /**
   * RCD-derived enriched probe bank (ADR-036 Phase 2). Threaded through from
   * the route handler — loaded once per session by `loadRoleProbeBank`.
   */
  probeBank?: RoleProbeBank | undefined;
}

export type AdvanceCultureInterviewResult =
  | {
      action: 'probe';
      transcript: CultureTranscript;
      probeQuestion: { questionId: string; text: string };
      acknowledgment: string;
      reasoning: string;
    }
  | {
      action: 'next';
      transcript: CultureTranscript;
      nextQuestion: { questionId: string; text: string };
      acknowledgment: string;
      reasoning: string;
    }
  | {
      action: 'terminate';
      transcript: CultureTranscript;
      terminationReason: 'hard_cap' | 'coverage_complete' | 'bank_exhausted';
      reasoning: string;
    };

const DEFAULT_MAX_QUESTIONS = 20;
const DEFAULT_MIN_QUESTIONS = 5;

/**
 * Core driver. Called every time the candidate submits an answer.
 */
export async function advanceCultureInterview(
  input: AdvanceCultureInterviewInput,
): Promise<AdvanceCultureInterviewResult> {
  const maxQuestions = input.maxQuestions ?? DEFAULT_MAX_QUESTIONS;
  const minQuestions = input.minQuestions ?? DEFAULT_MIN_QUESTIONS;

  // Clone defensively — never mutate the caller's transcript.
  const transcript = cloneTranscript(input.transcript);

  // 1. Find the pending turn (the last turn with no candidateResponse).
  let pendingTurnIdx = -1;
  for (let i = transcript.turns.length - 1; i >= 0; i--) {
    if (transcript.turns[i]!.candidateResponse === null) {
      pendingTurnIdx = i;
      break;
    }
  }
  if (pendingTurnIdx < 0) {
    throw new Error('advanceCultureInterview called but no pending turn exists in transcript.');
  }
  const pendingTurn = transcript.turns[pendingTurnIdx]!;
  const currentQuestion = getQuestionById(pendingTurn.questionId);
  if (!currentQuestion) {
    throw new Error(`Unknown question id in transcript: ${pendingTurn.questionId}`);
  }

  // 2. Attach candidate answer to the pending turn.
  pendingTurn.candidateResponse = input.candidateAnswer;

  // 3. Run the LLM turn analysis.
  const turnContext: AgentTurnContext = {
    currentQuestion,
    candidateAnswer: input.candidateAnswer,
    probesUsedForCurrentQ: transcript.scratchpad.probesUsedForCurrentQ,
    totalQuestionsAsked: distinctQuestionsAsked(transcript),
    maxQuestions,
    minQuestions,
    runningThemes: transcript.scratchpad.runningThemes,
  };

  const llmResult = await runTurnAnalysis(input.provider, turnContext);
  pendingTurn.starSlots = llmResult.star_slots;
  // Coerce the LLM's running theme into the closed probe-pattern vocabulary.
  // Free-text strings are silently dropped — they break the selector's
  // theme-resonance bonus (intersection with q.probe_patterns becomes empty).
  const coercedTheme = coerceProbePattern(llmResult.running_theme_to_add);
  if (coercedTheme && !transcript.scratchpad.runningThemes.includes(coercedTheme)) {
    // Cap themes at 5 — oldest wins eviction.
    transcript.scratchpad.runningThemes.push(coercedTheme);
    if (transcript.scratchpad.runningThemes.length > 5) {
      transcript.scratchpad.runningThemes.shift();
    }
  }

  // 4. Update coverage IF this was the seed turn of its question (not a probe).
  //    Probes don't add new coverage — they sharpen the existing signal.
  //    We count a question "covered" when its seed turn has at least
  //    3 of 4 STAR slots present with specificity ≥ 1.
  if (pendingTurn.probeOf === null) {
    const coverageDelta = scoreTurnCoverage(llmResult.star_slots);
    if (coverageDelta > 0) {
      const primary = currentQuestion.dimensions[0]!;
      transcript.scratchpad.dimensionCoverage[primary] =
        (transcript.scratchpad.dimensionCoverage[primary] ?? 0) + 1;
    }
  }

  // 5. Decide: probe, next, or terminate?
  const probesRemaining =
    currentQuestion.maxProbes - transcript.scratchpad.probesUsedForCurrentQ;
  const wantsProbe = llmResult.probe_needed && probesRemaining > 0;

  if (wantsProbe && llmResult.probe_text) {
    // Add the probe turn.
    const newIdx = transcript.turns.length;
    transcript.turns.push({
      idx: newIdx,
      questionId: currentQuestion.id,
      questionText: llmResult.probe_text,
      probeOf: currentQuestion.id,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });
    transcript.scratchpad.probesUsedForCurrentQ += 1;

    return {
      action: 'probe',
      transcript,
      probeQuestion: { questionId: currentQuestion.id, text: llmResult.probe_text },
      acknowledgment: llmResult.acknowledgment,
      reasoning: llmResult.reasoning,
    };
  }

  // Probe not needed (or budget exhausted) — we're moving on from this question.
  // Reset the per-question probe counter for whatever comes next.
  transcript.scratchpad.probesUsedForCurrentQ = 0;

  // 6. Termination check.
  const questionsAsked = distinctQuestionsAsked(transcript);
  const termination = evaluateTermination({
    transcript,
    questionsAsked,
    minQuestions,
    maxQuestions,
  });
  if (termination) {
    return {
      action: 'terminate',
      transcript,
      terminationReason: termination,
      reasoning: llmResult.reasoning,
    };
  }

  // 7. Otherwise pick the next bank question.
  const askedIds = new Set(transcript.turns.map((t) => t.questionId));
  const next = pickNextQuestion({
    coverage: transcript.scratchpad.dimensionCoverage,
    askedIds,
    seniority: input.seniority,
    roleOverlayId: input.roleOverlayId,
    runningThemes: transcript.scratchpad.runningThemes,
    probeBank: input.probeBank,
  });
  if (!next) {
    // Bank exhausted before termination — terminate with a distinct reason
    // so the caller can decide whether to re-use the bank or just finish.
    return {
      action: 'terminate',
      transcript,
      terminationReason: 'bank_exhausted',
      reasoning: llmResult.reasoning,
    };
  }

  const newIdx = transcript.turns.length;
  transcript.turns.push({
    idx: newIdx,
    questionId: next.id,
    questionText: next.text,
    probeOf: null,
    candidateResponse: null,
    starSlots: null,
    timestamp: new Date().toISOString(),
  });

  return {
    action: 'next',
    transcript,
    nextQuestion: { questionId: next.id, text: next.text },
    acknowledgment: llmResult.acknowledgment,
    reasoning: llmResult.reasoning,
  };
}

// ─── Termination ─────────────────────────────────────────────────────────────

interface EvaluateTerminationInput {
  transcript: CultureTranscript;
  questionsAsked: number;
  minQuestions: number;
  maxQuestions: number;
}

function evaluateTermination(
  input: EvaluateTerminationInput,
): 'hard_cap' | 'coverage_complete' | null {
  const { transcript, questionsAsked, minQuestions, maxQuestions } = input;

  // Hard cap: always wins.
  if (questionsAsked >= maxQuestions) return 'hard_cap';

  // Coverage rule: terminate early only if ALL five competency dimensions
  // have at least one adequate STAR response AND we've hit the minimum.
  if (questionsAsked < minQuestions) return null;
  const coverage = transcript.scratchpad.dimensionCoverage;
  const allCovered = COMPETENCY_DIMENSIONS.every((dim) => (coverage[dim] ?? 0) >= 1);
  if (allCovered) return 'coverage_complete';

  return null;
}

// ─── LLM turn analysis ───────────────────────────────────────────────────────

async function runTurnAnalysis(
  provider: LLMProvider | null,
  ctx: AgentTurnContext,
): Promise<AgentTurnJsonResponse> {
  // No provider → mock response. Safe to use in tests and when the culture
  // agent is running in environments without the AI binding.
  if (!provider) {
    return mockTurnResponse(ctx);
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildCultureAgentSystemPrompt() },
    { role: 'user', content: buildCultureAgentTurnMessage(ctx) },
  ];

  let content: string;
  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 768 });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[cultureAgent] LLM call failed:', err);
    return mockTurnResponse(ctx);
  }

  if (!content) {
    console.warn('[cultureAgent] LLM returned empty content. Falling back to mock.');
    return mockTurnResponse(ctx);
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseAgentTurnJsonResponse(parsed);
  } catch (err) {
    console.error('[cultureAgent] Failed to parse JSON:', content.slice(0, 300), err);
    return mockTurnResponse(ctx);
  }
}

// ─── JSON response parsing ──────────────────────────────────────────────────
// Strict parser — every field has a fallback so the agent never crashes on
// bad model output, but we log when we had to fall back.

const STAR_KEYS: StarSlot[] = ['S', 'T', 'A', 'R'];

function parseAgentTurnJsonResponse(raw: unknown): AgentTurnJsonResponse {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    star_slots: parseStarSlots(r.star_slots),
    acknowledgment: typeof r.acknowledgment === 'string' ? r.acknowledgment.trim() : '',
    probe_needed: r.probe_needed === true,
    probe_text:
      typeof r.probe_text === 'string' && r.probe_text.trim().length > 0
        ? r.probe_text.trim()
        : null,
    reasoning: typeof r.reasoning === 'string' ? r.reasoning.trim() : '',
    running_theme_to_add:
      typeof r.running_theme_to_add === 'string' && r.running_theme_to_add.trim().length > 0
        ? r.running_theme_to_add.trim()
        : null,
  };
}

function parseStarSlots(raw: unknown): Record<StarSlot, { present: boolean; specificity: number }> {
  const out: Record<StarSlot, { present: boolean; specificity: number }> = {
    S: { present: false, specificity: 0 },
    T: { present: false, specificity: 0 },
    A: { present: false, specificity: 0 },
    R: { present: false, specificity: 0 },
  };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of STAR_KEYS) {
    const slot = r[k];
    if (slot && typeof slot === 'object') {
      const s = slot as Record<string, unknown>;
      out[k] = {
        present: s.present === true,
        specificity: clampSpecificity(s.specificity),
      };
    }
  }
  return out;
}

function clampSpecificity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 2) return 2;
  return Math.round(v);
}

// ─── Coverage scoring ────────────────────────────────────────────────────────

/**
 * Score a turn's STAR slot coverage. Returns 1 if the turn counts as an
 * adequate STAR answer (≥3 slots present with specificity ≥1), else 0.
 *
 * Threshold lives here rather than in the prompt so we can tune it without
 * retraining the model.
 */
function scoreTurnCoverage(slots: Record<StarSlot, { present: boolean; specificity: number }>): number {
  let adequate = 0;
  for (const k of STAR_KEYS) {
    const s = slots[k];
    if (s.present && s.specificity >= 1) adequate += 1;
  }
  return adequate >= 3 ? 1 : 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cloneTranscript(t: CultureTranscript): CultureTranscript {
  return {
    turns: t.turns.map((turn) => ({
      ...turn,
      starSlots: turn.starSlots
        ? {
            S: { ...turn.starSlots.S },
            T: { ...turn.starSlots.T },
            A: { ...turn.starSlots.A },
            R: { ...turn.starSlots.R },
          }
        : null,
    })),
    scratchpad: {
      dimensionCoverage: { ...t.scratchpad.dimensionCoverage },
      probesUsedForCurrentQ: t.scratchpad.probesUsedForCurrentQ,
      runningThemes: [...t.scratchpad.runningThemes],
    },
  };
}

function distinctQuestionsAsked(t: CultureTranscript): number {
  const ids = new Set<string>();
  for (const turn of t.turns) {
    // Seed turns only — probes share the same questionId.
    if (turn.probeOf === null) ids.add(turn.questionId);
  }
  return ids.size;
}

// ─── Mock response (no-provider fallback) ────────────────────────────────────

function mockTurnResponse(ctx: AgentTurnContext): AgentTurnJsonResponse {
  // Very simple heuristic: probe once, then advance. Good enough for tests
  // that don't care about real STAR detection.
  const wantsProbe = ctx.probesUsedForCurrentQ === 0 && ctx.candidateAnswer.trim().length < 200;
  return {
    star_slots: {
      S: { present: true, specificity: 1 },
      T: { present: true, specificity: 1 },
      A: { present: !wantsProbe, specificity: wantsProbe ? 0 : 2 },
      R: { present: !wantsProbe, specificity: wantsProbe ? 0 : 1 },
    },
    acknowledgment: wantsProbe ? 'Got it.' : 'Thanks for walking me through that.',
    probe_needed: wantsProbe,
    probe_text: wantsProbe
      ? (ctx.currentQuestion.probes.missing_A ?? 'What did you specifically do in that situation?')
      : null,
    reasoning: wantsProbe
      ? '[MOCK] Short answer with weak Action slot; probing once.'
      : '[MOCK] Answer is long enough for a complete STAR; moving on.',
    running_theme_to_add: null,
  };
}

// ─── Re-exports for convenience ──────────────────────────────────────────────

export { CULTURE_QUESTION_BANK, COMPETENCY_DIMENSIONS };
export type { CultureQuestion, CompetencyDimension, SeniorityTag, StarSlot };
