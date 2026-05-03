/**
 * Culture Interview Agent — Adaptive FSM (ADR-029 v2).
 *
 * Replaces the static bank selector with a generative turn planner that
 * produces personalized questions based on candidate background + RCD.
 *
 * Keeps the same output contract as `cultureAgent.ts` so the route handler
 * can switch between adaptive and static with minimal wiring changes.
 *
 * Fallback strategy:
 *   - If `useStaticFallback` is true → use existing static bank
 *   - If generative planner returns null (parse failure, no provider, etc.)
 *     → fall back to static bank
 *   - Static bank is NEVER deleted — it is the compliance escape hatch.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { LLMProvider, LLMMessage } from './llm/types';
import type {
  CultureTranscript,
  CultureTurn,
  CultureScratchpad,
  QuestionMetadata,
  StartCultureInterviewResult,
  AdvanceCultureInterviewResult,
} from './cultureAgent';
import {
  defaultCultureTranscript,
  advanceCultureInterview as staticAdvanceCultureInterview,
  startCultureInterview as staticStartCultureInterview,
} from './cultureAgent';
import type { CompetencyDimension, SeniorityTag, StarSlot } from './cultureQuestionBank';
import { COMPETENCY_DIMENSIONS, CULTURE_BANK_SIZE, CULTURE_QUESTION_BANK } from './cultureQuestionBank';
import type { RoleOverlayId } from './cultureRoleOverlay';
import type { RoleProbeBank } from './cultureProbeBank';
import type { CultureTeamContext } from './cultureRoleResolution';
import { buildCultureInterviewContext } from './cultureAgentContext';
import {
  runGenerativeTurnPlanner,
  type GenerativeTurnResult,
} from './cultureGenerativePlanner';
import {
  buildCultureAgentSystemPrompt,
  buildCultureAgentTurnMessage,
  type AgentTurnContext,
  type AgentTurnJsonResponse,
} from './cultureAgentPrompts';
import { coerceProbePattern } from './cultureProbePatterns';

// ─── Input types ─────────────────────────────────────────────────────────────

export interface StartAdaptiveCultureInterviewInput {
  provider: LLMProvider | null;
  db: D1Database;
  candidateId: string;
  assessmentId: string;
  mode: 'profile_builder' | 'role_fit';
  teamContext: CultureTeamContext | null;
  seniority?: SeniorityTag | null;
  roleOverlayId?: RoleOverlayId | null;
  probeBank?: RoleProbeBank | undefined;
  /** When true, bypass generative planner and use the static 15-question bank. */
  useStaticFallback?: boolean;
}

export interface AdvanceAdaptiveCultureInterviewInput {
  provider: LLMProvider | null;
  db: D1Database;
  candidateId: string;
  assessmentId: string;
  mode: 'profile_builder' | 'role_fit';
  teamContext: CultureTeamContext | null;
  /** The mutable-ish transcript loaded from D1 (will be cloned; not mutated). */
  transcript: CultureTranscript;
  /** Candidate's verbatim answer to the currently-pending question. */
  candidateAnswer: string;
  /** Hard cap on total questions — 20 per ADR-029. */
  maxQuestions?: number;
  /** Minimum questions before termination is allowed — 5 per ADR-029. */
  minQuestions?: number;
  seniority?: SeniorityTag | null;
  roleOverlayId?: RoleOverlayId | null;
  probeBank?: RoleProbeBank | undefined;
  /** When true, bypass generative planner and use the static 15-question bank. */
  useStaticFallback?: boolean;
}

const DEFAULT_MAX_QUESTIONS = CULTURE_BANK_SIZE;
const DEFAULT_MIN_QUESTIONS = 5;

// ─── Start ───────────────────────────────────────────────────────────────────

export async function startAdaptiveCultureInterview(
  input: StartAdaptiveCultureInterviewInput,
): Promise<StartCultureInterviewResult> {
  // Mode-1 (profile_builder) never uses the generative planner — too risky
  // for a blocking gate. Always use the static profile probe bank.
  if (input.useStaticFallback || input.mode === 'profile_builder') {
    const staticInput: import('./cultureAgent').StartCultureInterviewInput = {
      mode: input.mode,
    };
    if (input.seniority !== undefined) staticInput.seniority = input.seniority;
    if (input.roleOverlayId !== undefined) staticInput.roleOverlayId = input.roleOverlayId;
    if (input.probeBank !== undefined) staticInput.probeBank = input.probeBank;
    const result = staticStartCultureInterview(staticInput);
    result.transcript.scratchpad.mode = input.mode;
    result.transcript.scratchpad.questionMetadata = result.transcript.scratchpad.questionMetadata ?? [];
    return result;
  }

  const transcript: CultureTranscript = {
    ...defaultCultureTranscript(),
    scratchpad: {
      ...defaultCultureTranscript().scratchpad,
      mode: input.mode,
      questionMetadata: [],
    },
  };

  // Build context for generative planner
  const plannerCtx = await buildCultureInterviewContext({
    db: input.db,
    candidateId: input.candidateId,
    assessmentId: input.assessmentId,
    mode: input.mode,
    transcript,
    teamContext: input.teamContext,
  });

  const generativeResult = await runGenerativeTurnPlanner(input.provider, plannerCtx);

  if (generativeResult) {
    const turn: CultureTurn = {
      idx: 0,
      questionId: generativeId(generativeResult, 0),
      questionText: generativeResult.question,
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    };

    transcript.turns.push(turn);
    appendQuestionMetadata(transcript.scratchpad, generativeResult);

    return {
      transcript,
      nextQuestion: { questionId: turn.questionId, text: turn.questionText },
    };
  }

  // Fallback to static bank
  const staticInput: import('./cultureAgent').StartCultureInterviewInput = {
    mode: input.mode,
  };
  if (input.seniority !== undefined) staticInput.seniority = input.seniority;
  if (input.roleOverlayId !== undefined) staticInput.roleOverlayId = input.roleOverlayId;
  if (input.probeBank !== undefined) staticInput.probeBank = input.probeBank;
  const staticResult = staticStartCultureInterview(staticInput);

  // Preserve mode in scratchpad even when falling back to static
  staticResult.transcript.scratchpad.mode = input.mode;
  staticResult.transcript.scratchpad.questionMetadata = staticResult.transcript.scratchpad.questionMetadata ?? [];

  return staticResult;
}

// ─── Advance ─────────────────────────────────────────────────────────────────

export async function advanceAdaptiveCultureInterview(
  input: AdvanceAdaptiveCultureInterviewInput,
): Promise<AdvanceCultureInterviewResult> {
  // Mode-1 (profile_builder) never uses the generative planner — always
  // delegate to the static path which routes to the profile probe bank.
  if (input.useStaticFallback || input.mode === 'profile_builder') {
    const staticInput: import('./cultureAgent').AdvanceCultureInterviewInput = {
      provider: input.provider,
      transcript: input.transcript,
      candidateAnswer: input.candidateAnswer,
    };
    if (input.maxQuestions !== undefined) staticInput.maxQuestions = input.maxQuestions;
    if (input.minQuestions !== undefined) staticInput.minQuestions = input.minQuestions;
    if (input.seniority !== undefined) staticInput.seniority = input.seniority;
    if (input.roleOverlayId !== undefined) staticInput.roleOverlayId = input.roleOverlayId;
    if (input.probeBank !== undefined) staticInput.probeBank = input.probeBank;
    return staticAdvanceCultureInterview(staticInput);
  }

  const maxQuestions = input.maxQuestions ?? DEFAULT_MAX_QUESTIONS;
  const minQuestions = input.minQuestions ?? DEFAULT_MIN_QUESTIONS;
  const transcript = cloneTranscript(input.transcript);

  // Ensure mode is set in scratchpad (backward compat for transcripts created
  // before the adaptive field existed).
  transcript.scratchpad.mode = transcript.scratchpad.mode ?? input.mode;
  transcript.scratchpad.questionMetadata = transcript.scratchpad.questionMetadata ?? [];

  // 1. Find the pending turn.
  let pendingTurnIdx = -1;
  for (let i = transcript.turns.length - 1; i >= 0; i--) {
    if (transcript.turns[i]!.candidateResponse === null) {
      pendingTurnIdx = i;
      break;
    }
  }
  if (pendingTurnIdx < 0) {
    throw new Error('advanceAdaptiveCultureInterview called but no pending turn exists in transcript.');
  }
  const pendingTurn = transcript.turns[pendingTurnIdx]!;

  // 2. Attach candidate answer.
  pendingTurn.candidateResponse = input.candidateAnswer;

  // 3. Run LLM turn analysis (same as static path — probes and STAR analysis).
  //    For generative questions, we synthesize a CultureQuestion-like object
  //    from the generative result stored in scratchpad.questionMetadata.
  const currentQuestion = resolveCurrentQuestion(pendingTurn, transcript.scratchpad);

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

  const coercedTheme = coerceProbePattern(llmResult.running_theme_to_add);
  if (coercedTheme && !transcript.scratchpad.runningThemes.includes(coercedTheme)) {
    transcript.scratchpad.runningThemes.push(coercedTheme);
    if (transcript.scratchpad.runningThemes.length > 5) {
      transcript.scratchpad.runningThemes.shift();
    }
  }

  // 4. Update coverage.
  if (pendingTurn.probeOf === null) {
    const coverageDelta = scoreTurnCoverage(llmResult.star_slots);
    if (coverageDelta > 0) {
      const primary = currentQuestion.dimensions[0]!;
      transcript.scratchpad.dimensionCoverage[primary] =
        (transcript.scratchpad.dimensionCoverage[primary] ?? 0) + 1;
    }
  }

  // 5. Decide: probe, next, or terminate?
  const probesRemaining = currentQuestion.maxProbes - transcript.scratchpad.probesUsedForCurrentQ;
  const wantsProbe = llmResult.probe_needed && probesRemaining > 0;

  if (wantsProbe && llmResult.probe_text) {
    const newIdx = transcript.turns.length;
    transcript.turns.push({
      idx: newIdx,
      questionId: pendingTurn.questionId,
      questionText: llmResult.probe_text,
      probeOf: pendingTurn.questionId,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });
    transcript.scratchpad.probesUsedForCurrentQ += 1;

    return {
      action: 'probe',
      transcript,
      probeQuestion: { questionId: pendingTurn.questionId, text: llmResult.probe_text },
      acknowledgment: llmResult.acknowledgment,
      reasoning: llmResult.reasoning,
    };
  }

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

  // 7. Generate the next question via the generative planner.
  const plannerCtx = await buildCultureInterviewContext({
    db: input.db,
    candidateId: input.candidateId,
    assessmentId: input.assessmentId,
    mode: input.mode,
    transcript,
    teamContext: input.teamContext,
  });

  const generativeResult = await runGenerativeTurnPlanner(input.provider, plannerCtx);

  if (generativeResult) {
    const newIdx = transcript.turns.length;
    const turn: CultureTurn = {
      idx: newIdx,
      questionId: generativeId(generativeResult, newIdx),
      questionText: generativeResult.question,
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    };
    transcript.turns.push(turn);
    appendQuestionMetadata(transcript.scratchpad, generativeResult);

    return {
      action: 'next',
      transcript,
      nextQuestion: { questionId: turn.questionId, text: turn.questionText },
      acknowledgment: llmResult.acknowledgment,
      reasoning: llmResult.reasoning,
    };
  }

  // 8. Generative planner failed — fall back to static bank.
  //    We cannot call staticAdvanceCultureInterview here because we have
  //    already attached the candidate answer and run turn analysis. The
  //    static function expects a pending turn. Instead, pick the next
  //    static question directly and append it.
  console.warn('[advanceAdaptiveCultureInterview] Generative planner failed; falling back to static bank.');
  const askedIds = new Set(transcript.turns.map((t) => t.questionId));

  // Prevent semantic duplicates: if a generative question already covered a
  // dimension, block static questions whose primary dimension matches.
  // Generative IDs (gen-*) and static IDs are in different namespaces, so
  // pickNextQuestion would otherwise surface a near-duplicate.
  const generativeDimensions = new Set<string>();
  for (const meta of transcript.scratchpad.questionMetadata ?? []) {
    generativeDimensions.add(meta.targetDimension);
  }
  for (const q of CULTURE_QUESTION_BANK) {
    if (generativeDimensions.has(q.dimensions[0]!)) {
      askedIds.add(q.id);
    }
  }

  const { pickNextQuestion } = await import('./cultureQuestionBank');
  const nextStatic = pickNextQuestion({
    coverage: transcript.scratchpad.dimensionCoverage,
    askedIds,
    seniority: input.seniority,
    roleOverlayId: input.roleOverlayId,
    runningThemes: transcript.scratchpad.runningThemes,
    probeBank: input.probeBank,
  });

  if (!nextStatic) {
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
    questionId: nextStatic.id,
    questionText: nextStatic.text,
    probeOf: null,
    candidateResponse: null,
    starSlots: null,
    timestamp: new Date().toISOString(),
  });

  return {
    action: 'next',
    transcript,
    nextQuestion: { questionId: nextStatic.id, text: nextStatic.text },
    acknowledgment: llmResult.acknowledgment,
    reasoning: llmResult.reasoning,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generativeId(result: GenerativeTurnResult, idx: number): string {
  return `gen-${result.targetDimension}-${idx}`;
}

function appendQuestionMetadata(scratchpad: CultureScratchpad, result: GenerativeTurnResult): void {
  if (!scratchpad.questionMetadata) scratchpad.questionMetadata = [];
  scratchpad.questionMetadata.push({
    questionText: result.question,
    targetDimension: result.targetDimension,
    personalizationAnchors: result.personalizationAnchors,
  });
}

/**
 * Resolve the "current question" for turn analysis. For generative questions
 * we synthesize a CultureQuestion-like object from the metadata stored in the
 * scratchpad. For static questions we look up the bank.
 */
import { getQuestionById } from './cultureQuestionBank';

interface SynthesizedQuestion {
  id: string;
  dimensions: CompetencyDimension[];
  text: string;
  maxProbes: number;
  probes: Record<string, string>;
  expectedSlots: StarSlot[];
  seniority: import('./cultureQuestionBank').SeniorityTag[];
}

function resolveCurrentQuestion(
  pendingTurn: CultureTurn,
  scratchpad: CultureScratchpad,
): SynthesizedQuestion {
  // Check if this is a generative question (starts with 'gen-')
  if (pendingTurn.questionId.startsWith('gen-')) {
    // Find metadata for this question
    const meta = scratchpad.questionMetadata?.find((m) => m.questionText === pendingTurn.questionText);
    const targetDimension = (meta?.targetDimension ?? 'ownership') as CompetencyDimension;

    // Use the probe strategy from the generative result if available.
    // We don't store the full probeStrategy in metadata (to keep transcript small),
    // so we use a generic probe library. In practice the LLM turn analysis
    // prompt instructs the model to generate probes grounded in the candidate's
    // actual words, so the static probe library is just a hint.
    return {
      id: pendingTurn.questionId,
      dimensions: [targetDimension],
      text: pendingTurn.questionText,
      maxProbes: 2,
      probes: {
        missing_S: 'Can you set the scene for me — when was this and who was involved?',
        missing_T: 'What was your specific responsibility in that situation?',
        missing_A: 'What did you personally do? Walk me through your actions.',
        missing_R: 'What was the outcome? How do you know it worked?',
        vague_outcome: 'Can you give me a concrete measure of success?',
      },
      expectedSlots: ['S', 'T', 'A', 'R'],
      seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
    };
  }

  // Static bank question — look it up
  const bankQ = getQuestionById(pendingTurn.questionId);
  if (bankQ) {
    return {
      id: bankQ.id,
      dimensions: bankQ.dimensions,
      text: bankQ.text,
      maxProbes: bankQ.maxProbes,
      probes: bankQ.probes as Record<string, string>,
      expectedSlots: bankQ.expectedSlots,
      seniority: bankQ.seniority,
    };
  }

  // Unknown question ID — synthesize a minimal object so the FSM doesn't crash
  return {
    id: pendingTurn.questionId,
    dimensions: ['ownership'],
    text: pendingTurn.questionText,
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically do?',
      missing_R: 'What was the result?',
    },
    expectedSlots: ['S', 'T', 'A', 'R'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
  };
}

// ─── Termination (copied from cultureAgent.ts for self-containment) ──────────

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

  if (questionsAsked >= maxQuestions) return 'hard_cap';
  if (questionsAsked < minQuestions) return null;

  const coverage = transcript.scratchpad.dimensionCoverage;
  const allCovered = COMPETENCY_DIMENSIONS.every((dim) => (coverage[dim] ?? 0) >= 1);
  if (allCovered) return 'coverage_complete';

  return null;
}

// ─── LLM turn analysis (copied from cultureAgent.ts) ─────────────────────────

async function runTurnAnalysis(
  provider: LLMProvider | null,
  ctx: AgentTurnContext,
): Promise<AgentTurnJsonResponse> {
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
    console.error('[cultureAgentAdaptive] LLM call failed:', err);
    return mockTurnResponse(ctx);
  }

  if (!content) {
    console.warn('[cultureAgentAdaptive] LLM returned empty content. Falling back to mock.');
    return mockTurnResponse(ctx);
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseAgentTurnJsonResponse(parsed);
  } catch (err) {
    console.error('[cultureAgentAdaptive] Failed to parse JSON:', content.slice(0, 300), err);
    return mockTurnResponse(ctx);
  }
}

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

function scoreTurnCoverage(slots: Record<StarSlot, { present: boolean; specificity: number }>): number {
  let adequate = 0;
  for (const k of STAR_KEYS) {
    const s = slots[k];
    if (s.present && s.specificity >= 1) adequate += 1;
  }
  return adequate >= 3 ? 1 : 0;
}

function mockTurnResponse(ctx: AgentTurnContext): AgentTurnJsonResponse {
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

// ─── Transcript cloning ──────────────────────────────────────────────────────

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
      mode: t.scratchpad.mode ?? 'profile_builder',
      questionMetadata: t.scratchpad.questionMetadata
        ? t.scratchpad.questionMetadata.map((m) => ({ ...m }))
        : [],
    },
  };
}

function distinctQuestionsAsked(t: CultureTranscript): number {
  const ids = new Set<string>();
  for (const turn of t.turns) {
    if (turn.probeOf === null) ids.add(turn.questionId);
  }
  return ids.size;
}
