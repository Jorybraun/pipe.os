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
 * Architecture: column-by-column domain flow.
 * - No probe counting. No soul probe counting. No budget enforcement.
 * - Domain advancement and depth decisions happen in the domain orchestrator.
 * - The reducer only applies user actions to state.
 */

import type {
  DomainCoverage,
  ConversationPhase,
  EvpCategory,
  ExtractedStory,
} from '../../../types';
import type { InterviewState, InterviewAction, CreateInterviewStateInput } from './types';
import { DOMAIN_COLUMN_ORDER } from './types';

// ─── Domain coverage ordering ────────────────────────────────────────────────

const DOMAIN_ORDER: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];

function coverageGte(a: DomainCoverage, threshold: DomainCoverage): boolean {
  return DOMAIN_ORDER.indexOf(a) >= DOMAIN_ORDER.indexOf(threshold);
}

// ─── Helpers to read typed values from the untyped knowledge state ───────────

export function readDomainCoverage(
  ks: Record<string, Record<string, unknown>>,
): Record<string, DomainCoverage> {
  const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;
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
  const DEFAULT_EVP_COVERAGE: Record<EvpCategory, DomainCoverage> = {
    Rewards: 'none',
    Opportunity: 'none',
    Work: 'none',
    People: 'none',
    Organisation: 'none',
  };
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

// ─── Phase selection (legacy support for roleContexts routes) ─────────────────

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

export function selectPhase(input: PhaseSelectionInput): PhaseSelectionResult {
  const { questionsAsked, questionBudget, storiesExtracted, mustHavesPrioritized, frictionProbed, dayInLifeProbed, probesDelivered, soulProbesDelivered, enableSoulTrack } =
    input;

  const budgetExhausted = questionsAsked >= questionBudget;
  const signalProbesDone = enableSoulTrack ? probesDelivered >= 6 : probesDelivered >= 8;
  const soulProbesDone = soulProbesDelivered >= 6;

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
  const domainCompletion: Record<string, import('./types').DomainCompletionStatus> = {};
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
    knowledgeState: input.seedKnowledgeState ?? {},
    coverage: readDomainCoverage(input.seedKnowledgeState ?? {}),
    phase: 'CONTEXT',
    questionsAsked: 0,
    synthesisReady: false,
    reasoning: 'Phase CONTEXT. Warm-up not yet complete.',
    urgentGaps: ['Warm-up not yet complete'],
    currentDomain: null,
    domainCompletion,
    domainQuestions: {},
    domainQuestionsDelivered,
    domainFollowUpsDelivered: 0,
    questionStack: [],
  };
}

// ─── Deterministic reducer ───────────────────────────────────────────────────

export function interviewReducer(
  state: InterviewState,
  action: InterviewAction,
): InterviewState {
  switch (action.type) {
    case 'ANSWER': {
      // 1. Append the answered exchange (mutate a copy)
      const lastIdx = state.exchanges.length - 1;
      const exchanges =
        lastIdx >= 0
          ? state.exchanges.map((ex, idx) =>
              idx === lastIdx ? { ...ex, answer: action.answer } : ex,
            )
          : state.exchanges;

      // 2. Increment counter
      const questionsAsked = state.questionsAsked + 1;

      // 3. Apply optional domain-coverage override
      let coverage = state.coverage;
      if (action.domainCoverage && Object.keys(action.domainCoverage).length > 0) {
        coverage = { ...coverage, ...action.domainCoverage };
      }

      // 4. Track per-domain progress
      let domainQuestionsDelivered = { ...state.domainQuestionsDelivered };
      let domainFollowUpsDelivered = state.domainFollowUpsDelivered;
      if (state.currentDomain) {
        domainQuestionsDelivered[state.currentDomain] =
          (domainQuestionsDelivered[state.currentDomain] ?? 0) + 1;
        if (state.domainCompletion[state.currentDomain] === 'follow_up') {
          domainFollowUpsDelivered += 1;
        }
      }

      return {
        ...state,
        exchanges,
        coverage,
        questionsAsked,
        domainQuestionsDelivered,
        domainFollowUpsDelivered,
      };
    }

    case 'SKIP': {
      // Skip the current question — treat it as answered with empty text
      const lastIdx = state.exchanges.length - 1;
      const exchanges =
        lastIdx >= 0
          ? state.exchanges.map((ex, idx) =>
              idx === lastIdx ? { ...ex, answer: '' } : ex,
            )
          : state.exchanges;

      return {
        ...state,
        exchanges,
        questionsAsked: state.questionsAsked + 1,
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
          ...state.domainCompletion,
          [action.domain]: 'asking',
        },
      };
    }

    case 'FORCE_SYNTHESIZE': {
      return {
        ...state,
        synthesisReady: true,
        phase: 'WRAP_UP',
      };
    }

    default:
      return state;
  }
}
