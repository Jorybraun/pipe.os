/**
 * Culture Interview Agent — FSM + analysis loop (ADR-029).
 *
 * Drives a single turn of the culture interview using the explicit v2 state
 * machine (reducer + phase architecture). The public API is unchanged so
 * callers (route handlers) require no modifications.
 *
 * Internal flow:
 *   1. Reconstruct InterviewStateV2 from the v1 CultureTranscript.
 *   2. Run LLM turn analysis (retained per evaluator-agent requirement).
 *   3. Dispatch reducer actions (ANSWER / DRILL_ANSWER / ADVANCE_PHASE / DRILL).
 *   4. Query buildPhaseDirective() for phase transitions.
 *   5. Pick next question via bank selector, biased by rankCoverageGaps().
 *   6. Serialize v2 state back to v1-compatible CultureTranscript.
 *
 * Deterministic work (phase, coverage, termination, selection) lives outside
 * the LLM path. The LLM's only job is STAR slot analysis + probe text.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import {
  CULTURE_QUESTION_BANK,
  COMPETENCY_DIMENSIONS,
  pickNextQuestion,
  getQuestionById,
  emptyCoverage,
  CULTURE_BANK_SIZE,
  type CultureQuestion,
  type CompetencyDimension,
  type SeniorityTag,
  type StarSlot,
} from './cultureQuestionBank';
import {
  PROFILE_PROBE_BANK,
  PROFILE_PROBE_DIMENSIONS,
  pickNextProfileProbe,
  getProfileProbeById,
  emptyProfileCoverage,
  PROFILE_PROBE_BANK_SIZE,
  type ProfileProbe,
} from './profileProbeBank';
import {
  buildCultureAgentSystemPrompt,
  buildCultureAgentTurnMessage,
  type AgentTurnContext,
  type AgentTurnJsonResponse,
} from './cultureAgentPrompts';
import { coerceProbePattern } from './cultureProbePatterns';
import {
  runGenerativeTurnPlanner,
  type GenerativePlannerContext,
  type GenerativeTurnResult,
} from './cultureGenerativePlanner';
import type { RoleOverlayId } from './cultureRoleOverlay';
import type { RoleProbeBank } from './cultureProbeBank';
import { evaluateCoverageTermination } from './candidateCoverage';
import type { InterviewPhase } from './cultureInterviewState';
import {
  reconstructStateFromTranscript,
  serializeStateToTranscript,
  seedQuestionsAsked,
  findPendingTurnIndex,
} from './cultureInterviewState';
import type { ContextualTurnRecord } from './cultureInterviewState';
import {
  decomposeAnswerContextually,
  buildConversationGraphView,
  type ContextualDecomposition,
} from './cultureContextualDecomposition';
import { cultureInterviewReducer } from './cultureInterviewReducer';
import { buildPhaseDirective } from './culturePhaseDirective';

// ─── Transcript shape ────────────────────────────────────────────────────────

export interface CultureTurn {
  idx: number;
  questionId: string;
  questionText: string;
  probeOf: string | null;
  candidateResponse: string | null;
  starSlots: Record<StarSlot, { present: boolean; specificity: number }> | null;
  timestamp: string;
  /** V2: which phase this turn belonged to (optional for backward compat). */
  phase?: InterviewPhase;
  /** R2 key for an associated video recording of this answer. */
  videoR2Key?: string;
}

export interface QuestionMetadata {
  questionText: string;
  targetDimension: string;
  personalizationAnchors: string[];
  /** Set for generative (gen-*) questions so the FSM can resolve them later. */
  questionId?: string;
  expectedSlots?: StarSlot[];
  probes?: Record<string, string>;
}

export interface CultureScratchpad {
  dimensionCoverage: Record<string, number>;
  probesUsedForCurrentQ: number;
  runningThemes: string[];
  mode?: 'profile_builder' | 'role_fit';
  questionMetadata?: QuestionMetadata[];
  /** Contextual conversation graph accumulated across turns (ADR-050). */
  contextualTurns?: ContextualTurnRecord[];
  /** Consecutive answers that yielded no new contextual material. */
  noNewMaterialStreak?: number;
  /** V2 FSM fields (optional — added by culture-agent redesign). */
  phase?: InterviewPhase;
  phaseHistory?: Array<{ phase: InterviewPhase; enteredAt: number }>;
  currentDrill?: { targetTurnIndex: number; attempts: number; maxAttempts: number } | null;
}

export interface CultureTranscript {
  turns: CultureTurn[];
  scratchpad: CultureScratchpad;
}

export function defaultCultureTranscript(): CultureTranscript {
  return {
    turns: [],
    scratchpad: {
      dimensionCoverage: emptyProfileCoverage(),
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode: 'profile_builder',
      questionMetadata: [],
    },
  };
}

// ─── Public: start and advance ───────────────────────────────────────────────

export interface StartCultureInterviewInput {
  seniority?: SeniorityTag | null;
  roleOverlayId?: RoleOverlayId | null;
  probeBank?: RoleProbeBank | undefined;
  mode?: 'profile_builder' | 'role_fit';
}

export interface StartCultureInterviewResult {
  transcript: CultureTranscript;
  nextQuestion: {
    questionId: string;
    text: string;
  };
}

export function startCultureInterview(
  input: StartCultureInterviewInput = {},
): StartCultureInterviewResult {
  const mode = input.mode ?? 'profile_builder';

  // Build a fresh transcript and reconstruct v2 state.
  const transcript: CultureTranscript = {
    turns: [],
    scratchpad: {
      dimensionCoverage:
        mode === 'profile_builder' ? emptyProfileCoverage() : emptyCoverage(),
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode,
      questionMetadata: [],
    },
  };

  let state = reconstructStateFromTranscript(transcript);
  state = cultureInterviewReducer(state, { type: 'START' });

  if (mode === 'profile_builder') {
    const first = pickNextProfileProbe({
      coverage: state.scratchpad.dimensionCoverage,
      askedIds: new Set(),
    });
    if (!first) {
      throw new Error('Profile probe bank is empty — cannot start interview.');
    }
    state = {
      ...state,
      turns: [
        ...state.turns,
        {
          idx: 0,
          questionId: first.id,
          questionText: first.text,
          probeOf: null,
          candidateResponse: null,
          starSlots: null,
          timestamp: new Date().toISOString(),
          phase: state.phase,
        },
      ],
    };
    return {
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      nextQuestion: { questionId: first.id, text: first.text },
    };
  }

  // role_fit mode
  const first = pickNextQuestion({
    coverage: state.scratchpad.dimensionCoverage,
    askedIds: new Set(),
    seniority: input.seniority,
    roleOverlayId: input.roleOverlayId,
    runningThemes: [],
    probeBank: input.probeBank,
  });
  if (!first) {
    throw new Error('Culture interview bank is empty — cannot start interview.');
  }

  state = {
    ...state,
    turns: [
      ...state.turns,
      {
        idx: 0,
        questionId: first.id,
        questionText: first.text,
        probeOf: null,
        candidateResponse: null,
        starSlots: null,
        timestamp: new Date().toISOString(),
        phase: state.phase,
      },
    ],
  };

  return {
    transcript: serializeStateToTranscript(state) as CultureTranscript,
    nextQuestion: { questionId: first.id, text: first.text },
  };
}

export interface AdvanceCultureInterviewInput {
  provider: LLMProvider | null;
  transcript: CultureTranscript;
  candidateAnswer: string;
  maxQuestions?: number;
  minQuestions?: number;
  seniority?: SeniorityTag | null;
  roleOverlayId?: RoleOverlayId | null;
  probeBank?: RoleProbeBank | undefined;
  /**
   * Candidate + role context for the generative turn planner (ADR-029 v2).
   * When present (and a provider exists), the next question is generated by
   * the LLM instead of pulled from the static bank. Null/undefined falls
   * back to the static bank selector.
   */
  generativeContext?: GenerativePlannerContext | null;
}

export type AdvanceCultureInterviewResult =
  | {
      action: 'probe';
      transcript: CultureTranscript;
      probeQuestion: { questionId: string; text: string };
      acknowledgment: string;
      reasoning: string;
      contextualDecomposition?: ContextualDecomposition | null;
    }
  | {
      action: 'next';
      transcript: CultureTranscript;
      nextQuestion: { questionId: string; text: string };
      acknowledgment: string;
      reasoning: string;
      contextualDecomposition?: ContextualDecomposition | null;
    }
  | {
      action: 'terminate';
      transcript: CultureTranscript;
      terminationReason:
        | 'hard_cap'
        | 'coverage_complete'
        | 'bank_exhausted'
        | 'no_new_material';
      reasoning: string;
      contextualDecomposition?: ContextualDecomposition | null;
    };

const DEFAULT_MAX_QUESTIONS = CULTURE_BANK_SIZE;
const DEFAULT_MIN_QUESTIONS = 5;
const PROFILE_BUILDER_MAX_QUESTIONS = PROFILE_PROBE_BANK_SIZE;
const PROFILE_BUILDER_MIN_QUESTIONS = 5;

export async function advanceCultureInterview(
  input: AdvanceCultureInterviewInput,
): Promise<AdvanceCultureInterviewResult> {
  const mode = input.transcript.scratchpad.mode ?? 'profile_builder';
  const maxQuestions =
    input.maxQuestions ??
    (mode === 'profile_builder'
      ? PROFILE_BUILDER_MAX_QUESTIONS
      : DEFAULT_MAX_QUESTIONS);
  const minQuestions =
    input.minQuestions ??
    (mode === 'profile_builder'
      ? PROFILE_BUILDER_MIN_QUESTIONS
      : DEFAULT_MIN_QUESTIONS);

  // 1. Reconstruct v2 state.
  let state = reconstructStateFromTranscript(input.transcript);
  state = {
    ...state,
    config: { ...state.config, minQuestions, maxQuestions },
  };

  // 2. Find pending turn.
  const pendingTurnIdx = findPendingTurnIndex(state);
  if (pendingTurnIdx < 0) {
    throw new Error(
      'advanceCultureInterview called but no pending turn exists in transcript.',
    );
  }
  const pendingTurn = state.turns[pendingTurnIdx]!;

  // 3. Resolve current question for LLM analysis.
  const currentQuestion = resolveCurrentQuestion(
    pendingTurn,
    mode,
    state.scratchpad.questionMetadata,
  );

  // 4. Run LLM turn analysis.
  const turnContext: AgentTurnContext = {
    currentQuestion,
    candidateAnswer: input.candidateAnswer,
    probesUsedForCurrentQ: state.scratchpad.probesUsedForCurrentQ,
    totalQuestionsAsked: seedQuestionsAsked(state),
    maxQuestions,
    minQuestions,
    runningThemes: state.scratchpad.runningThemes,
  };
  // Contextual decomposition (ADR-050) runs alongside the legacy STAR
  // analysis: every answer is broken into typed semantic statements; generic
  // answers are discarded and the discard is what triggers the probe.
  const priorPhrases = (input.transcript.scratchpad.contextualTurns ?? []).flatMap(
    (t) => t.statements.map((s) => s.phrase),
  );
  const [llmResultRaw, decomposition] = await Promise.all([
    runTurnAnalysis(input.provider, turnContext),
    decomposeAnswerContextually(input.provider, {
      question: pendingTurn.questionText,
      answer: input.candidateAnswer,
      priorPhrases,
    }),
  ]);
  let llmResult = llmResultRaw;

  // Sanitize probe_text: smaller models (Llama 3.1 8B) sometimes return the
  // probe key (e.g. "missing_A") instead of the human-readable text.
  if (llmResult.probe_text && currentQuestion.probes) {
    const key = llmResult.probe_text.trim();
    const lookup = (currentQuestion.probes as Record<string, string | undefined>)[key];
    if (lookup && typeof lookup === 'string') {
      llmResult = { ...llmResult, probe_text: lookup };
    }
  }

  // 5. Dispatch answer action.
  if (state.phase === 'drilling') {
    state = cultureInterviewReducer(state, {
      type: 'DRILL_ANSWER',
      answer: input.candidateAnswer,
      starSlots: llmResult.star_slots,
    });
  } else {
    state = cultureInterviewReducer(state, {
      type: 'ANSWER',
      answer: input.candidateAnswer,
      turnIndex: pendingTurnIdx,
      starSlots: llmResult.star_slots,
    });
  }

  // 6. Update running themes.
  const coercedTheme = coerceProbePattern(llmResult.running_theme_to_add);
  if (coercedTheme && !state.scratchpad.runningThemes.includes(coercedTheme)) {
    state = {
      ...state,
      scratchpad: {
        ...state.scratchpad,
        runningThemes: [...state.scratchpad.runningThemes, coercedTheme].slice(
          -5,
        ),
      },
    };
  }

  // 6b. Record the contextual decomposition + no-new-material streak.
  if (decomposition) {
    state = {
      ...state,
      scratchpad: {
        ...state.scratchpad,
        contextualTurns: [
          ...(state.scratchpad.contextualTurns ?? []),
          {
            turnIdx: pendingTurnIdx,
            statements: decomposition.statements,
            edges: decomposition.edges,
            discarded: decomposition.discarded,
          },
        ],
        noNewMaterialStreak: decomposition.discarded
          ? (state.scratchpad.noNewMaterialStreak ?? 0) + 1
          : 0,
      },
    };
  }

  // 7. Decide whether to drill based on LLM result + budget + phase.
  const probesRemaining =
    currentQuestion.maxProbes - state.scratchpad.probesUsedForCurrentQ;
  const canProbe =
    state.phase === 'rapport_building' ||
    state.phase === 'probing' ||
    state.phase === 'drilling';

  // Dedup guard: never ask a probe whose text was already asked this session.
  // Without this, the LLM (or mock fallback) can paste the same probe-library
  // template verbatim after each answer, repeating the probe back-to-back.
  const askedTexts = new Set(state.turns.map((t) => normalizeQuestionText(t.questionText)));

  // ADR-050: when contextual decomposition ran, IT owns the probe decision —
  // probe only when the answer was discarded (no concrete material), using
  // the decomposition's own probe text (quotes the candidate's words). The
  // legacy STAR-gap probe path applies only when decomposition is unavailable.
  const probeText = decomposition
    ? decomposition.discarded
      ? decomposition.probe
      : null
    : llmResult.probe_text;
  const probeWanted = decomposition
    ? decomposition.discarded && decomposition.probe !== null
    : llmResult.probe_needed;
  const probeIsDuplicate =
    probeText !== null && askedTexts.has(normalizeQuestionText(probeText));

  if (
    probeWanted &&
    probesRemaining > 0 &&
    probeText &&
    !probeIsDuplicate &&
    canProbe
  ) {
    if (!state.currentDrill) {
      state = cultureInterviewReducer(state, {
        type: 'DRILL',
        targetTurnIndex: pendingTurnIdx,
      });
    }
    // Ensure phase is drilling.
    if (state.phase !== 'drilling') {
      state = cultureInterviewReducer(state, {
        type: 'ADVANCE_PHASE',
        nextPhase: 'drilling',
      });
    }
    state = {
      ...state,
      turns: [
        ...state.turns,
        {
          idx: state.turns.length,
          questionId: pendingTurn.questionId,
          questionText: probeText,
          probeOf: pendingTurn.questionId,
          candidateResponse: null,
          starSlots: null,
          timestamp: new Date().toISOString(),
          phase: 'drilling',
        },
      ],
      scratchpad: {
        ...state.scratchpad,
        probesUsedForCurrentQ: state.scratchpad.probesUsedForCurrentQ + 1,
      },
    };
    return {
      action: 'probe',
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      probeQuestion: {
        questionId: pendingTurn.questionId,
        text: probeText,
      },
      acknowledgment: llmResult.acknowledgment,
      reasoning: llmResult.reasoning,
      contextualDecomposition: decomposition,
    };
  }

  // 8. No probe wanted. If we're in drilling, force back to probing.
  if (state.phase === 'drilling') {
    state = cultureInterviewReducer(state, {
      type: 'ADVANCE_PHASE',
      nextPhase: 'probing',
    });
  }

  // 9. Check general phase directive.
  const directive = buildPhaseDirective(state);
  if (directive.nextPhase !== state.phase) {
    state = cultureInterviewReducer(state, {
      type: 'ADVANCE_PHASE',
      nextPhase: directive.nextPhase,
    });
  }

  // 9. Terminal phases.
  if (state.phase === 'scoring' || state.phase === 'complete') {
    return {
      action: 'terminate',
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      terminationReason: 'coverage_complete',
      reasoning: llmResult.reasoning,
      contextualDecomposition: decomposition,
    };
  }

  // 10. Termination check.
  const questionsAsked = seedQuestionsAsked(state);
  const termination = evaluateCoverageTermination({
    coverageState: state.coverage,
    questionsAsked,
    minQuestions,
    maxQuestions,
  });
  if (termination) {
    return {
      action: 'terminate',
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      terminationReason: termination,
      reasoning: llmResult.reasoning,
      contextualDecomposition: decomposition,
    };
  }

  // 10b. ADR-050 stop rule: consecutive answers that decompose to nothing new
  // mean the conversation has stopped yielding material — stop asking, within
  // the existing min/max caps.
  if (
    decomposition &&
    (state.scratchpad.noNewMaterialStreak ?? 0) >= 2 &&
    questionsAsked >= minQuestions
  ) {
    return {
      action: 'terminate',
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      terminationReason: 'no_new_material',
      reasoning: llmResult.reasoning,
      contextualDecomposition: decomposition,
    };
  }

  // 11. Pick next question.
  const askedIds = new Set(state.turns.map((t) => t.questionId));
  let next: ProfileProbe | CultureQuestion | null = null;

  if (mode === 'profile_builder') {
    next = pickNextProfileProbe({
      coverage: state.scratchpad.dimensionCoverage,
      askedIds,
    });
  } else {
    // Generative path (ADR-029 v2): ask the LLM planner for a personalized
    // question grounded in candidate background + RCD. Falls back to the
    // static bank on provider absence, parse failure, or duplicate output.
    if (input.generativeContext && input.provider) {
      // ADR-050: hand the planner the live conversation graph so the next
      // question targets missing context (Action w/o BECAUSE, Outcome w/o
      // owning Action, …) instead of a generic dimension sweep.
      const contextualTurns = state.scratchpad.contextualTurns ?? [];
      const graphView =
        contextualTurns.length > 0
          ? buildConversationGraphView(contextualTurns)
          : null;
      const plannerCtx: GenerativePlannerContext = {
        ...input.generativeContext,
        coverage: { ...state.scratchpad.dimensionCoverage },
        turnsUsed: questionsAsked,
        priorQuestions: state.turns
          .filter((t) => t.probeOf === null)
          .map((t) => t.questionText),
        runningThemes: [...state.scratchpad.runningThemes],
        maxQuestions,
        minQuestions,
        conversationGraph: graphView,
      };
      const { result: generated, reason } = await runGenerativeTurnPlanner(input.provider, plannerCtx);
      
      if (!generated) {
        console.warn('[cultureAgent] Generative planner returned no question — falling back to static bank.', { reason });
        // Log metric for monitoring
        console.log(JSON.stringify({
          event: 'culture.planner_fallback',
          reason,
          hasConversationGraph: graphView !== null,
          missingContextCount: graphView?.missingContext.length ?? 0,
        }));
      } else if (askedTexts.has(normalizeQuestionText(generated.question))) {
        console.warn('[cultureAgent] Generative planner produced a duplicate question — falling back to static bank.');
        console.log(JSON.stringify({
          event: 'culture.planner_duplicate',
          question: generated.question,
        }));
      }
      
      if (
        generated &&
        !askedTexts.has(normalizeQuestionText(generated.question))
      ) {
        const genId = `gen-${generated.targetDimension}-${questionsAsked}`;
        next = generativeResultToQuestion(genId, generated);
        state = {
          ...state,
          scratchpad: {
            ...state.scratchpad,
            questionMetadata: [
              ...(state.scratchpad.questionMetadata ?? []),
              {
                questionId: genId,
                questionText: generated.question,
                targetDimension: generated.targetDimension,
                personalizationAnchors: generated.personalizationAnchors,
                expectedSlots: generated.targetSlots,
                probes: { ...generated.probeStrategy },
              },
            ],
          },
        };
      }
    }

    if (!next) {
      if (!input.generativeContext || !input.provider) {
        console.warn('[cultureAgent] Generative path unavailable (context or provider missing) — using static bank.');
      }
      // Static bank fallback — selector biases toward least-covered dimensions.
      next = pickNextQuestion({
        coverage: state.scratchpad.dimensionCoverage,
        askedIds,
        seniority: input.seniority,
        roleOverlayId: input.roleOverlayId,
        runningThemes: state.scratchpad.runningThemes,
        probeBank: input.probeBank,
      });
    }
  }

  if (!next) {
    return {
      action: 'terminate',
      transcript: serializeStateToTranscript(state) as CultureTranscript,
      terminationReason: 'bank_exhausted',
      reasoning: llmResult.reasoning,
      contextualDecomposition: decomposition,
    };
  }

  // 12. Add next question turn.
  state = {
    ...state,
    turns: [
      ...state.turns,
      {
        idx: state.turns.length,
        questionId: next.id,
        questionText: next.text,
        probeOf: null,
        candidateResponse: null,
        starSlots: null,
        timestamp: new Date().toISOString(),
        phase: state.phase,
      },
    ],
    scratchpad: {
      ...state.scratchpad,
      probesUsedForCurrentQ: 0,
    },
  };

  return {
    action: 'next',
    transcript: serializeStateToTranscript(state) as CultureTranscript,
    nextQuestion: { questionId: next.id, text: next.text },
    acknowledgment: llmResult.acknowledgment,
    reasoning: llmResult.reasoning,
    contextualDecomposition: decomposition,
  };
}

// ─── Question resolution (bank + synthetic) ──────────────────────────────────

function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function generativeResultToQuestion(
  id: string,
  result: GenerativeTurnResult,
): CultureQuestion {
  return {
    id,
    dimensions: [result.targetDimension],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
    text: result.question,
    expectedSlots: result.targetSlots.length > 0 ? result.targetSlots : ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: { ...result.probeStrategy },
    tags: [],
  };
}

function resolveCurrentQuestion(
  pendingTurn: { questionId: string; questionText: string },
  mode: 'profile_builder' | 'role_fit',
  questionMetadata?: QuestionMetadata[],
): CultureQuestion {
  // Generative questions resolve from session metadata (their probe strategy
  // and target dimension were produced by the planner, not the bank).
  if (pendingTurn.questionId.startsWith('gen-')) {
    const meta = questionMetadata?.find(
      (m) => m.questionId === pendingTurn.questionId || m.questionText === pendingTurn.questionText,
    );
    if (meta) {
      return {
        id: pendingTurn.questionId,
        dimensions: [meta.targetDimension as CompetencyDimension],
        seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
        text: pendingTurn.questionText,
        expectedSlots: (meta.expectedSlots as StarSlot[] | undefined) ?? ['S', 'T', 'A', 'R'],
        maxProbes: 2,
        probes: meta.probes ?? {},
        tags: [],
      };
    }
  }

  if (mode === 'profile_builder') {
    const probe = getProfileProbeById(pendingTurn.questionId);
    if (probe) {
      return {
        id: probe.id,
        dimensions: [probe.dimension as CompetencyDimension],
        seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
        text: probe.text,
        expectedSlots: probe.expectedSlots as StarSlot[],
        maxProbes: probe.maxProbes,
        probes: probe.probes as Record<string, string>,
        tags: probe.tags,
      };
    }
  } else {
    const bankQ = getQuestionById(pendingTurn.questionId);
    if (bankQ) {
      return bankQ;
    }
  }

  // Unknown question — synthesize minimal object so the FSM doesn't crash.
  return {
    id: pendingTurn.questionId,
    dimensions: ['ownership'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff', 'manager'],
    text: pendingTurn.questionText,
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically do?',
      missing_R: 'What was the result?',
    },
    tags: [],
  };
}

// ─── LLM turn analysis ───────────────────────────────────────────────────────

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
    const completion = await provider.complete(messages, {
      forceJson: true,
      maxTokens: 768,
    });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[cultureAgent] LLM call failed:', err);
    return mockTurnResponse(ctx);
  }

  if (!content) {
    console.warn(
      '[cultureAgent] LLM returned empty content. Falling back to mock.',
    );
    return mockTurnResponse(ctx);
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseAgentTurnJsonResponse(parsed);
  } catch (err) {
    console.error(
      '[cultureAgent] Failed to parse JSON:',
      content.slice(0, 300),
      err,
    );
    return mockTurnResponse(ctx);
  }
}

// ─── JSON response parsing ──────────────────────────────────────────────────

const STAR_KEYS: StarSlot[] = ['S', 'T', 'A', 'R'];

function parseAgentTurnJsonResponse(raw: unknown): AgentTurnJsonResponse {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    star_slots: parseStarSlots(r.star_slots),
    acknowledgment:
      typeof r.acknowledgment === 'string' ? r.acknowledgment.trim() : '',
    probe_needed: r.probe_needed === true,
    probe_text:
      typeof r.probe_text === 'string' && r.probe_text.trim().length > 0
        ? r.probe_text.trim()
        : null,
    reasoning: typeof r.reasoning === 'string' ? r.reasoning.trim() : '',
    running_theme_to_add:
      typeof r.running_theme_to_add === 'string' &&
      r.running_theme_to_add.trim().length > 0
        ? r.running_theme_to_add.trim()
        : null,
  };
}

function parseStarSlots(
  raw: unknown,
): Record<StarSlot, { present: boolean; specificity: number }> {
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

// ─── Mock response (no-provider fallback) ────────────────────────────────────

function mockTurnResponse(ctx: AgentTurnContext): AgentTurnJsonResponse {
  const wantsProbe =
    ctx.probesUsedForCurrentQ === 0 && ctx.candidateAnswer.trim().length < 200;
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
      ? (ctx.currentQuestion.probes.missing_A ??
        'What did you specifically do in that situation?')
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
