/**
 * Depth Evaluator — Deterministic domain depth check.
 *
 * After ~6 questions in a domain, evaluates whether we have gone deep enough
 * to move on, or whether 2-3 follow-ups are warranted.
 *
 * Pure function. No LLM. <1ms.
 */

import type { Domain, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';

const DOMAIN_ORDER: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];

function coverageIndex(c: DomainCoverage): number {
  return DOMAIN_ORDER.indexOf(c);
}

export interface DepthEvaluation {
  /** True if the domain has been explored deeply enough. */
  isDeep: boolean;
  /** Human-readable explanation. */
  reasoning: string;
  /** Number of follow-up questions recommended (0-3). */
  recommendedFollowUps: number;
}

/**
 * Evaluate whether a domain has been explored deeply enough.
 *
 * Heuristics (ordered):
 * 1. Coverage >= 'covered' → deep (0 follow-ups)
 * 2. Coverage === 'partial' + >= 3 knowledge keys → adequate (0 follow-ups)
 * 3. Coverage === 'partial' + < 3 knowledge keys → shallow (2 follow-ups)
 * 4. Coverage <= 'sparse' → shallow (3 follow-ups)
 */
export function evaluateDomainDepth(domain: Domain, state: InterviewState): DepthEvaluation {
  const coverage = state.coverage[domain] ?? 'none';
  const idx = coverageIndex(coverage);

  // Count knowledge keys for this domain
  const domainKs = state.knowledgeState[domain];
  const knowledgeKeyCount = domainKs && typeof domainKs === 'object' && !Array.isArray(domainKs)
    ? Object.keys(domainKs).length
    : 0;

  // Heuristic 1: explicitly covered or deep
  if (idx >= coverageIndex('covered')) {
    return {
      isDeep: true,
      reasoning: `${domain} coverage is ${coverage} — sufficient depth reached.`,
      recommendedFollowUps: 0,
    };
  }

  // Heuristic 2: partial with enough knowledge keys
  if (coverage === 'partial' && knowledgeKeyCount >= 3) {
    return {
      isDeep: true,
      reasoning: `${domain} coverage is partial but ${knowledgeKeyCount} knowledge keys extracted — adequate depth.`,
      recommendedFollowUps: 0,
    };
  }

  // Heuristic 3: partial but thin
  if (coverage === 'partial') {
    return {
      isDeep: false,
      reasoning: `${domain} coverage is partial with only ${knowledgeKeyCount} knowledge keys — need follow-ups.`,
      recommendedFollowUps: 2,
    };
  }

  // Heuristic 4: sparse or none
  const followUps = coverage === 'sparse' ? 2 : 3;
  return {
    isDeep: false,
    reasoning: `${domain} coverage is ${coverage} — insufficient depth. ${followUps} follow-up questions recommended.`,
    recommendedFollowUps: followUps,
  };
}
