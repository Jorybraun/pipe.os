/**
 * Turn Planner — Deterministic per-turn planning.
 *
 * Reads InterviewState and decides:
 *   - Which probe to use (if any)
 *   - What domain to target
 *   - What question type to use
 *   - What energy level to expect
 *   - Whether to drill or pivot
 *
 * Pure function. <1ms. No LLM.
 *
 * The plan is injected into the user prompt as structured guidance.
 * The Question Writer (LLM) receives this plan and the probe text,
 * then writes the actual conversational question.
 */

import type { ConversationPhase, DomainCoverage, Domain, ParticipantRole } from '../../../types';
import type { InterviewState } from '../interview/types';
import { buildProbePlan, getProbeCount, buildSoulProbePlan, getSoulProbeCount } from './probeLibrarian';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QuestionType =
  | 'introductory'
  | 'grand_tour'
  | 'example'
  | 'drilling'
  | 'direct'
  | 'hypothesis'
  | 'contrast';

export type EnergyLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface TurnPlan {
  /** Current conversation phase. */
  phase: ConversationPhase;
  /** Which probe to deliver this turn (if in DISCOVERY phase). */
  probeId?: string;
  /** Adapted probe text for this participant. */
  probeText?: string;
  /** Primary domain to advance. */
  targetDomain: Domain;
  /** Secondary domains this turn may touch. */
  secondaryDomains: Domain[];
  /** Recommended question type. */
  questionType: QuestionType;
  /** Detected energy level from last answer. */
  energy: EnergyLevel;
  /** Whether to drill deeper or pivot to a new topic. */
  strategy: 'drill' | 'pivot' | 'probe' | 'wrap';
  /** One-line directive for the question writer. */
  directive: string;
  /** Why this plan was chosen. */
  reasoning: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOMAIN_ORDER: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];

function coverageIndex(c: DomainCoverage): number {
  return DOMAIN_ORDER.indexOf(c);
}

function isBlind(c: DomainCoverage): boolean {
  return c === 'none';
}

function isShallow(c: DomainCoverage): boolean {
  return coverageIndex(c) < DOMAIN_ORDER.indexOf('partial');
}

/** Detect energy from the last answer length and content. */
function detectEnergy(lastAnswer: string | undefined): EnergyLevel {
  if (!lastAnswer) return 'unknown';
  const trimmed = lastAnswer.trim();
  if (trimmed.length < 15) return 'low';
  if (trimmed.length > 150) return 'high';
  // Check for story markers
  const storyMarkers = /\b(then|after|before|when|because|so|but|however|although)\b/gi;
  const matches = trimmed.match(storyMarkers);
  if (matches && matches.length >= 2) return 'high';
  return 'medium';
}

/** Pick the blind-est domain to target. */
function pickTargetDomain(
  coverage: Record<string, DomainCoverage>,
  preferred: Domain[],
): Domain {
  // First try the preferred domains in order
  for (const d of preferred) {
    if (isBlind(coverage[d] ?? 'none')) return d;
  }
  for (const d of preferred) {
    if (isShallow(coverage[d] ?? 'none')) return d;
  }
  // Fall back to the shallowest domain overall
  const domains = Object.keys(coverage) as Domain[];
  let shallowest: Domain = domains[0] ?? 'why';
  let shallowestIdx = coverageIndex(coverage[shallowest] ?? 'deep');
  for (const d of domains) {
    const idx = coverageIndex(coverage[d] ?? 'deep');
    if (idx < shallowestIdx) {
      shallowest = d;
      shallowestIdx = idx;
    }
  }
  return shallowest;
}

/** Decide question type based on phase, energy, and strategy. */
function pickQuestionType(
  phase: ConversationPhase,
  energy: EnergyLevel,
  strategy: TurnPlan['strategy'],
  questionsAsked: number,
): QuestionType {
  switch (phase) {
    case 'CONTEXT':
      return questionsAsked === 0 ? 'introductory' : 'grand_tour';

    case 'DISCOVERY':
      if (strategy === 'drill') return 'drilling';
      if (energy === 'high') return 'example';
      if (questionsAsked > 5) return 'direct';
      return 'example';

    case 'SOUL':
      // Soul probes are story requests. Always example type.
      return 'example';

    case 'PRIORITIZE':
      return 'contrast';

    case 'EVP_FRICTION':
      return 'hypothesis';

    case 'WRAP_UP':
      return 'direct';
  }
}

/** Decide strategy based on phase, energy, and probe state. */
function pickStrategy(
  phase: ConversationPhase,
  energy: EnergyLevel,
  probePlan: ReturnType<typeof buildProbePlan> | ReturnType<typeof buildSoulProbePlan>,
  lastAnswer: string | undefined,
): TurnPlan['strategy'] {
  if (phase === 'WRAP_UP') return 'wrap';
  if ((phase === 'DISCOVERY' || phase === 'SOUL') && probePlan) return 'probe';
  if (energy === 'high' && lastAnswer && lastAnswer.length > 50) return 'drill';
  return 'pivot';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a TurnPlan from the current InterviewState.
 *
 * This is the deterministic brain that decides what the question writer
 * should do this turn. All logic is rule-based; no LLM involved.
 */
export function buildTurnPlan(state: InterviewState): TurnPlan {
  const { phase, questionsAsked, coverage, exchanges, knowledgeState, participantRole } = state;

  // Read probe state
  const probesDelivered =
    typeof knowledgeState['_probesDelivered'] === 'number'
      ? (knowledgeState['_probesDelivered'] as number)
      : 0;

  // Select probe plan based on phase
  const probePlan = phase === 'DISCOVERY'
    ? buildProbePlan(probesDelivered, participantRole)
    : phase === 'SOUL'
      ? buildSoulProbePlan(
          typeof knowledgeState['_soulProbesDelivered'] === 'number'
            ? (knowledgeState['_soulProbesDelivered'] as number)
            : 0,
          participantRole,
        )
      : undefined;

  // Detect energy from last answer
  const lastExchange = exchanges[exchanges.length - 1];
  const lastAnswer = lastExchange?.answer;
  const energy = detectEnergy(lastAnswer);

  // Determine strategy
  const strategy = pickStrategy(phase, energy, probePlan, lastAnswer);

  // Determine target domain
  let targetDomain: Domain;
  let secondaryDomains: Domain[] = [];

  if (probePlan) {
    targetDomain = probePlan.primaryDomain;
    secondaryDomains = probePlan.secondaryDomains;
  } else {
    const allDomains: Domain[] = ['why', 'work', 'team', 'bar', 'codebase', 'process'];
    targetDomain = pickTargetDomain(coverage, allDomains);
    secondaryDomains = [];
  }

  // Determine question type
  const questionType = pickQuestionType(phase, energy, strategy, questionsAsked);

  // Build directive and reasoning
  let directive: string;
  let reasoning: string;

  const soulProbesDelivered =
    typeof knowledgeState['_soulProbesDelivered'] === 'number'
      ? (knowledgeState['_soulProbesDelivered'] as number)
      : 0;

  if (probePlan && phase === 'SOUL') {
    directive = `Deliver soul probe ${soulProbesDelivered + 1} of ${getSoulProbeCount()}. Ask for behavior, not abstract values. ${
      energy === 'high' ? 'They are engaged — follow energy with at most ONE drilling question.' : 'Keep it low-pressure.'
    }`;
    reasoning = `Phase ${phase}, soul probe ${probePlan.probe.id}, target=${targetDomain}, energy=${energy}, strategy=${strategy}`;
  } else if (probePlan) {
    directive = `Deliver probe ${probesDelivered + 1} of ${getProbeCount()}. Ask a warm, conversational version of the probe. ${
      energy === 'high' ? 'They are engaged — follow energy with at most ONE drilling question.' : 'Keep it low-pressure.'
    }`;
    reasoning = `Phase ${phase}, probe ${probePlan.probe.id}, target=${targetDomain}, energy=${energy}, strategy=${strategy}`;
  } else if (phase === 'PRIORITIZE') {
    directive = 'Force ranking. Make them choose between requirements. No list-making.';
    reasoning = `Phase ${phase}, target=${targetDomain}, energy=${energy}`;
  } else if (phase === 'EVP_FRICTION') {
    directive = 'Surface honest friction. Ask what would surprise a candidate or why someone great would leave for this.';
    reasoning = `Phase ${phase}, target=${targetDomain}, energy=${energy}`;
  } else if (phase === 'WRAP_UP') {
    directive = 'Briefly summarize what you have learned and ask for corrections.';
    reasoning = `Phase ${phase}, wrapping up.`;
  } else {
    directive = `Build rapport. Ask ONE easy, contextual question. Target domain: ${targetDomain}.`;
    reasoning = `Phase ${phase}, target=${targetDomain}, energy=${energy}`;
  }

  return {
    phase,
    probeId: probePlan?.probe.id,
    probeText: probePlan?.adaptedText,
    targetDomain,
    secondaryDomains,
    questionType,
    energy,
    strategy,
    directive,
    reasoning,
  };
}

/**
 * Build a concise plan instruction block for injection into the user prompt.
 */
export function buildPlanInstruction(plan: TurnPlan): string {
  const lines: string[] = [];

  lines.push('## Turn Plan');
  lines.push(`Phase: ${plan.phase}`);
  lines.push(`Strategy: ${plan.strategy}`);
  lines.push(`Target domain: ${plan.targetDomain}${plan.secondaryDomains.length > 0 ? ' (also: ' + plan.secondaryDomains.join(', ') + ')' : ''}`);
  lines.push(`Question type: ${plan.questionType}`);
  lines.push(`Energy: ${plan.energy}`);
  lines.push(`Directive: ${plan.directive}`);

  return lines.join('\n');
}
