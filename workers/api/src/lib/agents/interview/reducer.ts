/**
 * Interview State Machine — Pure Reducer
 *
 * A deterministic, LLM-free state machine for role-discovery interviewing.
 *
 *   interviewReducer(state, action) → newState
 *
 * The reducer is pure: same (state, action) always produces the same newState.
 * It runs in <10ms — no I/O, no LLM calls.
 *
 * Phase selection logic is extracted from buildPhaseDirective (prompts.ts)
 * and made self-contained so the reducer needs no external LLM-phase input.
 */

import type {
  DomainCoverage,
  ConversationPhase,
  EvpCategory,
  ExtractedStory,
  QualificationStatus,
} from '../../../types';
import type { InterviewState, InterviewAction, CreateInterviewStateInput, DomainCompletionStatus } from './types';
import { DOMAIN_COLUMN_ORDER } from './types';

// ─── Domain coverage ordering ────────────────────────────────────────────────

const DOMAIN_ORDER: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];

function coverageGte(a: DomainCoverage, threshold: DomainCoverage): boolean {
  return DOMAIN_ORDER.indexOf(a) >= DOMAIN_ORDER.indexOf(threshold);
}

const DEFAULT_EVP_COVERAGE: Record<EvpCategory, DomainCoverage> = {
  Rewards: 'none',
  Opportunity: 'none',
  Work: 'none',
  People: 'none',
  Organisation: 'none',
};

const DEFAULT_QUALIFICATION: QualificationStatus = {
  economicBuyerIdentified: false,
  championIdentified: false,
  decisionProcessMapped: false,
  budgetApproved: false,
  timelineUrgency: 'UNKNOWN',
};

const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;

// ─── Helpers to read typed values from the untyped knowledge state ───────────

export function readDomainCoverage(
  ks: Record<string, Record<string, unknown>>,
): Record<string, DomainCoverage> {
  const raw = ks['_coverage'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return Object.fromEntries(SIX_DOMAINS.map((d) => [d, 'none' as DomainCoverage]));
  }
  const result: Record<string, DomainCoverage> = {};
  for (const domain of SIX_DOMAINS) {
    const val = (raw as Record<string, unknown>)[domain];
    result[domain] =
      typeof val === 'string' && DOMAIN_ORDER.includes(val as DomainCoverage)
        ? (val as DomainCoverage)
        : 'none';
  }
  return result;
}

export function readEvpCoverage(ks: Record<string, Record<string, unknown>>): Record<EvpCategory, DomainCoverage> {
  const raw = ks['_evpCoverage'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_EVP_COVERAGE };
  }
  const result = { ...DEFAULT_EVP_COVERAGE };
  for (const key of Object.keys(DEFAULT_EVP_COVERAGE) as EvpCategory[]) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === 'string' && DOMAIN_ORDER.includes(val as DomainCoverage)) {
      result[key] = val as DomainCoverage;
    }
  }
  return result;
}

export function readStories(ks: Record<string, Record<string, unknown>>): ExtractedStory[] {
  const raw = ks['_stories'];
  if (Array.isArray(raw)) return raw as ExtractedStory[];
  return [];
}

export function readProbesDelivered(ks: Record<string, Record<string, unknown>>): number {
  const raw = ks['_probesDelivered'];
  return typeof raw === 'number' ? raw : 0;
}

export function readSoulProbesDelivered(ks: Record<string, Record<string, unknown>>): number {
  const raw = ks['_soulProbesDelivered'];
  return typeof raw === 'number' ? raw : 0;
}

export function readEnableSoulTrack(
  ks: Record<string, Record<string, unknown>>,
  baseline: Record<string, unknown>,
): boolean {
  const ksFlag = ks['_enableSoulTrack'];
  if (typeof ksFlag === 'boolean') return ksFlag;
  const baselineFlag = baseline['enableSoulTrack'];
  return typeof baselineFlag === 'boolean' ? baselineFlag : false;
}

export function readBooleanFlag(ks: Record<string, Record<string, unknown>>, key: string): boolean {
  const raw = ks[key];
  return Boolean(raw);
}

// ─── Phase selection (extracted + adapted from buildPhaseDirective) ──────────

interface PhaseSelectionInput {
  questionsAsked: number;
  questionBudget: number;
  domainCoverage: Record<string, DomainCoverage>;
  evpCoverage: Record<EvpCategory, DomainCoverage>;
  storiesExtracted: ExtractedStory[];
  mustHavesPrioritized: boolean;
  frictionProbed: boolean;
  dayInLifeProbed: boolean;
  probesDelivered: number;
  soulProbesDelivered: number;
  enableSoulTrack: boolean;
}

export interface PhaseSelectionResult {
  phase: ConversationPhase;
  focusGoal: string;
  urgentGaps: string[];
  synthesisAllowed: boolean;
  reasoning: string;
}

/**
 * Pure phase-selection predicates.
 * Each returns { match, phase, focusGoal, gaps } where gaps are strings to
 * append to urgentGaps when this phase is selected.
 */
function phaseRules(input: PhaseSelectionInput) {
  const {
    questionsAsked,
    domainCoverage,
    evpCoverage,
    storiesExtracted,
    mustHavesPrioritized,
    frictionProbed,
    dayInLifeProbed,
    probesDelivered,
    soulProbesDelivered,
    enableSoulTrack,
  } = input;

  // Signal probes: 6 total. Personality probes (7-8) are only in default mode.
  const signalProbesDone = enableSoulTrack ? probesDelivered >= 6 : probesDelivered >= 8;
  const soulProbesDone = soulProbesDelivered >= 6;

  const blindDomains = () =>
    Object.entries(domainCoverage)
      .filter(([, c]) => !coverageGte(c, 'sparse'))
      .map(([d]) => d);

  const shallowDomains = () =>
    Object.entries(domainCoverage)
      .filter(([, c]) => !coverageGte(c, 'partial'))
      .map(([d]) => d);

  const uncoveredEvp = () =>
    Object.entries(evpCoverage)
      .filter(([, c]) => c === 'none')
      .map(([d]) => d);

  return [
    {
      match: questionsAsked < 2,
      phase: 'CONTEXT' as ConversationPhase,
      focusGoal: 'Establish rapport and context before beginning the calibrated probes.',
      gaps: ['Warm-up not yet complete'],
    },
    {
      match: !signalProbesDone,
      phase: 'DISCOVERY' as ConversationPhase,
      focusGoal: enableSoulTrack
        ? `Deliver signal probe ${probesDelivered + 1} of 6. Ask exactly one probe, follow energy with at most one drilling question, then move on.`
        : `Deliver probe ${probesDelivered + 1} of 8. Ask exactly one probe, follow energy with at most one drilling question, then move on.`,
      gaps: [
        `Probe ${probesDelivered + 1} not yet delivered`,
        ...(storiesExtracted.length === 0 ? ['No concrete stories extracted yet'] : []),
        ...(blindDomains().length > 0 ? [`Blind domains: ${blindDomains().join(', ')}`] : []),
        ...(!dayInLifeProbed ? ['Day-in-the-life not yet probed'] : []),
      ],
    },
    {
      match: enableSoulTrack && !soulProbesDone,
      phase: 'SOUL' as ConversationPhase,
      focusGoal: `Deliver soul probe ${soulProbesDelivered + 1} of 6. Ask for behavior, not abstract values. Follow energy with at most ONE drilling follow-up.`,
      gaps: [
        `Soul probe ${soulProbesDelivered + 1} not yet delivered`,
        ...(storiesExtracted.length === 0 ? ['No concrete stories extracted yet'] : []),
      ],
    },
    {
      match: !mustHavesPrioritized,
      phase: 'PRIORITIZE' as ConversationPhase,
      focusGoal: 'Force the participant to rank must-haves and identify true non-negotiables.',
      gaps: [
        'Must-haves not yet prioritized',
        ...(shallowDomains().length > 0 ? [`Shallow domains: ${shallowDomains().join(', ')}`] : []),
      ],
    },
    {
      match: uncoveredEvp().length > 0 || !frictionProbed,
      phase: 'EVP_FRICTION' as ConversationPhase,
      focusGoal:
        'Surface EVP truth and honest friction. Extract what makes this role genuinely attractive and what might surprise a candidate.',
      gaps: [
        'EVP/friction not fully probed',
        ...(uncoveredEvp().length > 0 ? [`Uncovered EVP categories: ${uncoveredEvp().join(', ')}`] : []),
      ],
    },
    {
      match: true, // default
      phase: 'WRAP_UP' as ConversationPhase,
      focusGoal: 'Confirm understanding and close cleanly. Brief summary + accuracy check.',
      gaps: [],
    },
  ] as const;
}

/**
 * Deterministic phase selection — no LLM call, no latency overhead.
 *
 * Phase selection order (RD-26):
 *   1. CONTEXT        — fewer than 2 Qs
 *   2. DISCOVERY      — probes incomplete
 *   3. PRIORITIZE     — must-haves not yet ranked
 *   4. EVP_FRICTION   — any EVP category uncovered OR friction not probed
 *   5. WRAP_UP        — default; synthesis gates checked here
 */
export function selectPhase(input: PhaseSelectionInput): PhaseSelectionResult {
  const { questionsAsked, questionBudget, storiesExtracted, mustHavesPrioritized, frictionProbed, dayInLifeProbed, probesDelivered, soulProbesDelivered, enableSoulTrack } =
    input;

  const budgetExhausted = questionsAsked >= questionBudget;
  const signalProbesDone = enableSoulTrack ? probesDelivered >= 6 : probesDelivered >= 8;
  const soulProbesDone = soulProbesDelivered >= 6;

  // Gates for synthesisAllowed (RD-42)
  const allGatesPass =
    mustHavesPrioritized &&
    frictionProbed &&
    dayInLifeProbed &&
    storiesExtracted.length >= 1 &&
    signalProbesDone &&
    (!enableSoulTrack || soulProbesDone);

  const rules = phaseRules(input);
  const selected = rules.find((r) => r.match)!;

  const urgentGaps = [...selected.gaps];
  if (selected.phase === 'WRAP_UP' && !allGatesPass) {
    urgentGaps.push('Synthesis gates not fully passed');
  }

  const synthesisAllowed = budgetExhausted || allGatesPass;

  const reasoning = synthesisAllowed
    ? `Phase ${selected.phase}. All gates passed — synthesis allowed.`
    : `Phase ${selected.phase}. Gates pending: ${[
        !signalProbesDone && (enableSoulTrack ? `${6 - probesDelivered} signal probes remaining` : `${8 - probesDelivered} probes remaining`),
        enableSoulTrack && !soulProbesDone && `${6 - soulProbesDelivered} soul probes remaining`,
        !mustHavesPrioritized && 'must-haves not ranked',
        !frictionProbed && 'friction not probed',
        storiesExtracted.length === 0 && 'no stories',
      ]
        .filter(Boolean)
        .join('; ')}.`;

  return {
    phase: selected.phase,
    focusGoal: selected.focusGoal,
    urgentGaps,
    synthesisAllowed,
    reasoning,
  };
}

// ─── Merge a knowledge-state update into the existing knowledge state ────────

export function mergeKnowledgeState(
  existing: Record<string, Record<string, unknown>>,
  update: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result = { ...existing };
  for (const [domain, fields] of Object.entries(update)) {
    result[domain] = { ...(result[domain] ?? {}), ...fields };
  }
  return result;
}

// ─── Initial state factory ───────────────────────────────────────────────────

export function createInitialState(input: CreateInterviewStateInput): InterviewState {
  const ks = input.seedKnowledgeState ?? {};
  const questionsAsked = 0;
  const domainCoverage = readDomainCoverage(ks);
  const enableSoulTrack = readEnableSoulTrack(ks, input.baseline);

  const phaseResult = selectPhase({
    questionsAsked,
    questionBudget: input.questionBudget,
    domainCoverage,
    evpCoverage: readEvpCoverage(ks),
    storiesExtracted: readStories(ks),
    mustHavesPrioritized: readBooleanFlag(ks, '_mustHavesPrioritized'),
    frictionProbed: readBooleanFlag(ks, '_frictionProbed'),
    dayInLifeProbed: readBooleanFlag(ks, '_dayInLifeProbed'),
    probesDelivered: readProbesDelivered(ks),
    soulProbesDelivered: readSoulProbesDelivered(ks),
    enableSoulTrack,
  });

  // Initialize per-domain tracking for column-by-column flow
  const domainCompletion: Record<string, DomainCompletionStatus> = {};
  const domainQuestionsDelivered: Record<string, number> = {};
  for (const d of DOMAIN_COLUMN_ORDER) {
    domainCompletion[d] = 'pending';
    domainQuestionsDelivered[d] = 0;
  }

  return {
    baseline: input.baseline,
    participantRole: input.participantRole,
    questionBudget: input.questionBudget,
    exchanges: [],
    knowledgeState: ks,
    coverage: domainCoverage,
    phase: phaseResult.phase,
    questionsAsked,
    synthesisReady: phaseResult.synthesisAllowed,
    reasoning: phaseResult.reasoning,
    urgentGaps: phaseResult.urgentGaps,
    questionStack: [],
    currentDomain: null,
    domainCompletion,
    domainQuestions: {},
    domainQuestionsDelivered,
    domainFollowUpsDelivered: 0,
  };
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function interviewReducer(
  state: InterviewState,
  action: InterviewAction,
): InterviewState {
  switch (action.type) {
    case 'ANSWER': {
      // 1. Merge optional knowledge-state update from the previous question generator
      let knowledgeState = state.knowledgeState;
      if (action.knowledgeStateUpdate && Object.keys(action.knowledgeStateUpdate).length > 0) {
        knowledgeState = mergeKnowledgeState(knowledgeState, action.knowledgeStateUpdate);
      }

      // 2. Apply optional domain-coverage override from the previous question generator
      let coverage = state.coverage;
      if (action.domainCoverage) {
        coverage = { ...coverage, ...action.domainCoverage };
        // Also persist into knowledgeState so phase selection reads it
        knowledgeState = {
          ...knowledgeState,
          _coverage: { ...coverage },
        };
      }

      // 3. Append the answered exchange (mutate a copy)
      const lastExchange = state.exchanges[state.exchanges.length - 1];
      if (!lastExchange) {
        // No exchange to answer — this is a logic error in the caller
        return state;
      }
      const exchanges = state.exchanges.map((ex, idx) =>
        idx === state.exchanges.length - 1 ? { ...ex, answer: action.answer } : ex,
      );

      // 4. Increment counter
      const questionsAsked = state.questionsAsked + 1;
      const budgetExhausted = questionsAsked >= state.questionBudget;

      // 5. Track per-domain progress (column-by-column flow)
      let domainQuestionsDelivered = state.domainQuestionsDelivered ? { ...state.domainQuestionsDelivered } : {};
      let domainFollowUpsDelivered = state.domainFollowUpsDelivered ?? 0;
      if (state.currentDomain) {
        domainQuestionsDelivered[state.currentDomain] = (domainQuestionsDelivered[state.currentDomain] ?? 0) + 1;
        if (state.domainCompletion?.[state.currentDomain] === 'follow_up') {
          domainFollowUpsDelivered += 1;
        }
      }

      // 6. Re-compute phase from updated knowledge state
      const phaseResult = selectPhase({
        questionsAsked,
        questionBudget: state.questionBudget,
        domainCoverage: coverage,
        evpCoverage: readEvpCoverage(knowledgeState),
        storiesExtracted: readStories(knowledgeState),
        mustHavesPrioritized: readBooleanFlag(knowledgeState, '_mustHavesPrioritized'),
        frictionProbed: readBooleanFlag(knowledgeState, '_frictionProbed'),
        dayInLifeProbed: readBooleanFlag(knowledgeState, '_dayInLifeProbed'),
        probesDelivered: readProbesDelivered(knowledgeState),
        soulProbesDelivered: readSoulProbesDelivered(knowledgeState),
        enableSoulTrack: readEnableSoulTrack(knowledgeState, state.baseline),
      });

      return {
        ...state,
        exchanges,
        knowledgeState,
        coverage,
        phase: phaseResult.phase,
        questionsAsked,
        synthesisReady: budgetExhausted || phaseResult.synthesisAllowed,
        reasoning: phaseResult.reasoning,
        urgentGaps: phaseResult.urgentGaps,
        domainQuestionsDelivered,
        domainFollowUpsDelivered,
      };
    }

    case 'SKIP': {
      // Skip the current question — treat it as answered with empty text
      const exchanges = state.exchanges.map((ex, idx) =>
        idx === state.exchanges.length - 1 ? { ...ex, answer: '' } : ex,
      );
      const questionsAsked = state.questionsAsked + 1;
      const budgetExhausted = questionsAsked >= state.questionBudget;

      const phaseResult = selectPhase({
        questionsAsked,
        questionBudget: state.questionBudget,
        domainCoverage: state.coverage,
        evpCoverage: readEvpCoverage(state.knowledgeState),
        storiesExtracted: readStories(state.knowledgeState),
        mustHavesPrioritized: readBooleanFlag(state.knowledgeState, '_mustHavesPrioritized'),
        frictionProbed: readBooleanFlag(state.knowledgeState, '_frictionProbed'),
        dayInLifeProbed: readBooleanFlag(state.knowledgeState, '_dayInLifeProbed'),
        probesDelivered: readProbesDelivered(state.knowledgeState),
        soulProbesDelivered: readSoulProbesDelivered(state.knowledgeState),
        enableSoulTrack: readEnableSoulTrack(state.knowledgeState, state.baseline),
      });

      return {
        ...state,
        exchanges,
        phase: phaseResult.phase,
        questionsAsked,
        synthesisReady: budgetExhausted || phaseResult.synthesisAllowed,
        reasoning: phaseResult.reasoning,
        urgentGaps: phaseResult.urgentGaps,
      };
    }

    case 'CACHE_DOMAIN_QUESTIONS': {
      return {
        ...state,
        currentDomain: action.domain,
        domainQuestions: {
          ...state.domainQuestions,
          [action.domain]: action.questions,
        },
        domainCompletion: {
          ...(state.domainCompletion ?? {}),
          [action.domain]: 'asking',
        },
      };
    }

    case 'FORCE_SYNTHESIZE': {
      return {
        ...state,
        synthesisReady: true,
        phase: 'WRAP_UP',
        reasoning: 'Forced synthesis.',
        urgentGaps: [],
      };
    }

    default:
      return state;
  }
}
