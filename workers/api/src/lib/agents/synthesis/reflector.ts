/**
 * Synthesis Reflector — Evaluates interview completeness against goals.
 *
 * Pure deterministic check. No LLM. Looks at domain coverage, knowledge keys,
 * and exchange density to decide whether the synthesis is strong, adequate, or thin.
 *
 * If gaps exist, produces a user-facing continuation prompt.
 */

import type { Domain, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';

const DOMAIN_ORDER: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];

function coverageIndex(c: DomainCoverage): number {
  return DOMAIN_ORDER.indexOf(c);
}

const MIN_ACCEPTABLE_COVERAGE: DomainCoverage = 'covered';

export interface SynthesisGap {
  /** Which RCD section / domain is thin. */
  section: string;
  /** What's missing. */
  missing: string[];
  /** Number of evidence quotes (exchanges with answers). */
  evidenceCount: number;
  /** Whether to recommend continuing the interview. */
  recommendedAction: 'continue_interview' | 'acceptable_gap';
  /** Which domain to target if continuing. */
  targetDomain: Domain;
}

export interface SynthesisReflection {
  /** Overall quality assessment. */
  overallQuality: 'strong' | 'adequate' | 'thin';
  /** List of gaps. Empty when quality is strong. */
  gaps: SynthesisGap[];
  /** User-facing prompt when gaps exist. */
  userPrompt?: string;
}

/**
 * Reflect on the interview state and decide if synthesis is good enough.
 *
 * Rules:
 * - All domains >= MIN_ACCEPTABLE_COVERAGE → strong
 * - All domains >= 'partial' AND <= 1 domain at 'partial' → adequate
 * - Any domain < 'partial' OR >= 2 domains at 'partial' → thin
 */
export function reflectOnSynthesis(state: InterviewState): SynthesisReflection {
  const domains = Object.keys(state.coverage) as Domain[];
  const gaps: SynthesisGap[] = [];

  for (const domain of domains) {
    const coverage = state.coverage[domain] ?? 'none';
    const idx = coverageIndex(coverage);
    const minIdx = coverageIndex(MIN_ACCEPTABLE_COVERAGE);

    if (idx >= minIdx) continue; // good enough

    // Count evidence for this domain (all exchanges that have answers)
    // Note: in a future enhancement we could tag exchanges with domains.
    const evidenceCount = state.exchanges.filter((ex) => ex.answer && ex.answer.trim().length > 0).length;

    const domainKs = state.knowledgeState[domain];
    const knowledgeKeys = domainKs && typeof domainKs === 'object' && !Array.isArray(domainKs)
      ? Object.keys(domainKs)
      : [];

    const missing: string[] = [];
    if (idx < coverageIndex('partial')) {
      missing.push('Insufficient coverage — domain barely probed');
    } else {
      missing.push('Coverage is partial — needs deeper stories and laddering');
    }
    if (knowledgeKeys.length < 3) {
      missing.push(`Only ${knowledgeKeys.length} knowledge keys extracted`);
    }

    gaps.push({
      section: domain,
      missing,
      evidenceCount,
      recommendedAction: idx < coverageIndex('partial') ? 'continue_interview' : 'acceptable_gap',
      targetDomain: domain,
    });
  }

  // Determine overall quality
  const thinDomains = domains.filter((d) => coverageIndex(state.coverage[d] ?? 'none') < coverageIndex('partial'));
  const partialDomains = domains.filter((d) => state.coverage[d] === 'partial');

  let overallQuality: SynthesisReflection['overallQuality'];
  if (gaps.length === 0) {
    overallQuality = 'strong';
  } else if (thinDomains.length === 0 && partialDomains.length <= 1) {
    overallQuality = 'adequate';
  } else {
    overallQuality = 'thin';
  }

  // Build user prompt when there are actionable gaps
  const actionableGaps = gaps.filter((g) => g.recommendedAction === 'continue_interview');
  let userPrompt: string | undefined;
  if (actionableGaps.length > 0) {
    const domainNames = actionableGaps.map((g) => g.section).join(', ');
    userPrompt = `I'm thin on ${domainNames}. Continue interviewing to cover these areas?`;
  }

  return {
    overallQuality,
    gaps,
    userPrompt,
  };
}
