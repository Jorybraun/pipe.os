/**
 * Synthesis Generator — Stateless LLM Call
 *
 * Takes an InterviewState and produces a candidate persona + job description.
 * Single LLM call. No tool loop. No hidden state.
 */

import type { LLMProvider, LLMMessage } from '../../llm/types';
import type { DomainCoverage, CandidatePersona } from '../../../types';
import type { InterviewState } from '../interview/types';
import { buildSynthesisPrompt } from './prompt';
import { cleanSkillArray, cleanCareerSignal } from '../../roleAgent/sanitize';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SynthesisResult {
  reasoning: string;
  persona: CandidatePersona;
  jobDescription: string;
  /** Legacy one-liner for backwards compatibility. */
  synthesis: string;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
}

// ─── Parsing utilities (extracted from roleAgent.ts) ─────────────────────────

const VALID_COVERAGES: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];
const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;

function parseDomainCoverage(raw: unknown): Record<string, DomainCoverage> {
  const result: Record<string, DomainCoverage> = {};
  if (raw && typeof raw === 'object') {
    for (const domain of SIX_DOMAINS) {
      const val = (raw as Record<string, unknown>)[domain];
      result[domain] =
        typeof val === 'string' && VALID_COVERAGES.includes(val as DomainCoverage)
          ? (val as DomainCoverage)
          : 'none';
    }
  } else {
    for (const domain of SIX_DOMAINS) result[domain] = 'none';
  }
  return result;
}

function parseKnowledgeStateUpdate(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value as Record<string, unknown>;
    }
  }
  return result;
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parsePersona(raw: unknown): CandidatePersona {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    seniority: typeof r.seniority === 'string' ? r.seniority : 'Not specified',
    archetype: typeof r.archetype === 'string' ? r.archetype : 'Not specified',
    mustHaveSkills: cleanSkillArray(toStringArray(r.mustHaveSkills)),
    niceToHaveSkills: cleanSkillArray(toStringArray(r.niceToHaveSkills)),
    disposition: cleanSkillArray(toStringArray(r.disposition)),
    careerSignal: cleanCareerSignal(typeof r.careerSignal === 'string' ? r.careerSignal : 'Not specified'),
    redFlags: cleanSkillArray(toStringArray(r.redFlags)),
    dealbreakers: cleanSkillArray(toStringArray(r.dealbreakers)),
  };
}

function cleanJson(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function parseSynthesisResponse(parsed: Record<string, unknown>): SynthesisResult {
  const persona = parsePersona(parsed.persona);
  const jobDescription = typeof parsed.jobDescription === 'string' ? parsed.jobDescription : '';
  const legacySynthesis =
    typeof parsed.synthesis === 'string' && parsed.synthesis.length > 0
      ? parsed.synthesis
      : persona.archetype;

  return {
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    persona,
    jobDescription,
    synthesis: legacySynthesis,
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
  };
}

// ─── Generator ───────────────────────────────────────────────────────────────

export interface SynthesizeOptions {
  /** Max tokens for the completion. Default: 4096. */
  maxTokens?: number;
}

/**
 * Synthesize a persona and job description from a completed interview state.
 *
 * Stateless: same state + same provider → same prompt → deterministic output
 * (modulo model temperature).
 */
export async function synthesize(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: SynthesizeOptions = {},
): Promise<SynthesisResult> {
  if (!provider) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_SYNTHESIS_PROVIDER or ROLE_AGENT_PROVIDER.');
  }

  const { system, user } = buildSynthesisPrompt(state);
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const maxTokens = opts.maxTokens ?? 4096;

  const completion = await provider.complete(messages, { forceJson: true, maxTokens });
  const content = completion.content?.trim() ?? '';

  if (content.length === 0) {
    throw new Error('AI provider returned empty content');
  }

  const jsonText = cleanJson(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(`AI provider returned invalid JSON: ${content.slice(0, 300)}`);
  }

  return parseSynthesisResponse(parsed);
}
