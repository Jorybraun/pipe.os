/**
 * Culture Interview — Generative Turn Planner (ADR-029 v2).
 *
 * Replaces the static question bank (`pickNextQuestion`) with an LLM-driven
 * turn planner that generates personalized questions based on candidate
 * background + role context document (RCD).
 *
 * Every generated question carries `personalizationAnchors` — an audit-trail
 * field explaining which candidate or RCD details were used. This satisfies
 * explainability requirements under EU AI Act Art 14 and NYC LL 144.
 *
 * The planner is a SINGLE prompt call that produces:
 *   - the next question text
 *   - the target competency dimension
 *   - the expected STAR slots
 *   - a probe strategy for missing slots
 *   - personalization anchors for the audit trail
 *
 * On parse failure or provider absence, the caller falls back to the static
 * bank via `staticFallbackPickNextQuestion`.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import type { CompetencyDimension, StarSlot } from './cultureQuestionBank';
import { COMPETENCY_DIMENSIONS } from './cultureQuestionBank';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenerativeTurnResult {
  /** The exact question text the candidate sees. */
  question: string;
  /** Primary dimension this question targets. */
  targetDimension: CompetencyDimension;
  /** Which STAR slots we expect the candidate to cover. */
  targetSlots: StarSlot[];
  /** Probe templates keyed by deficiency — used by the turn FSM. */
  probeStrategy: {
    missing_S?: string;
    missing_T?: string;
    missing_A?: string;
    missing_R?: string;
    vague_outcome?: string;
  };
  /** Audit-trail field: which candidate/RCD details grounded this question. */
  personalizationAnchors: string[];
  /** Internal reasoning for why this question was chosen. */
  reasoning: string;
}

export interface GenerativePlannerContext {
  /** Interview mode — drives the prompt's objective. */
  mode: 'profile_builder' | 'role_fit';
  /** Candidate background assembled by `buildCultureInterviewContext`. */
  candidate: {
    experiences: Array<{ company: string; role: string; durationMonths: number; highlights: string[] }>;
    projects: Array<{ name: string; description: string; technologies: string[] }>;
    skills: string[];
    priorScreening: PriorScreeningSummary | null;
  };
  /** Role context assembled from the RCD. */
  role: {
    teamStories: Array<{ domain: string; narrative: string; archetype: string }>;
    conflicts: Array<{ topic: string; resolution: string }>;
    dealbreakers: Array<{ pattern: string; jobRelatednessNote: string }>;
    cultureProfile: Record<string, number>;
    barsOverrides: Array<{ dimension: string; anchorLevel: number; overrideAnchorText: string }>;
  };
  /** Current coverage per dimension (from transcript scratchpad). */
  coverage: Record<CompetencyDimension, number>;
  /** How many questions have been asked so far. */
  turnsUsed: number;
  /** Question texts already asked this session (dedup guard). */
  priorQuestions: string[];
  /** Running themes from earlier turns (closed vocabulary). */
  runningThemes: string[];
  /** Max questions for this session. */
  maxQuestions: number;
  /** Min questions before termination is allowed. */
  minQuestions: number;
}

export interface PriorScreeningSummary {
  coveredDimensions: CompetencyDimension[];
  thinDimensions: CompetencyDimension[];
  keyQuotes: string[];
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

export function buildGenerativePlannerSystemPrompt(): string {
  return `You are an experienced engineering hiring manager conducting a behavioral interview. You have read the candidate's full background and the team's Role Context Document. Your goal is to elicit STAR-format behavioral evidence.

# Rules
1. NEVER ask a generic question. Every question MUST reference at least one specific detail from the candidate's background or the team's context.
2. Do NOT repeat questions that have already been asked.
3. Do NOT ask about dimensions with coverage >= 1.0 unless in role_fit mode with thin evidence.
4. In role_fit mode: if a prior screening exists, skip dimensions already well-covered and go deeper on thin ones.
5. Tone: conversational, curious, sharp — not HR-formal.
6. The question must be answerable as a STAR story (Situation, Task, Action, Result).

# STAR slot rubric (for targetSlots)
S = Situation: concrete context (when, where, with whom)
T = Task: the specific thing that was THEIRS to do
A = Action: what THEY specifically did (first person, not "we")
R = Result: concrete measurable outcome + reflection

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "question": "string — the exact question text the candidate sees",
  "targetDimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness",
  "targetSlots": ["S", "T", "A", "R"],
  "probeStrategy": {
    "missing_S": "probe text if candidate skips situation",
    "missing_A": "probe text if candidate skips actions",
    "missing_R": "probe text if candidate skips result",
    "vague_outcome": "probe text if outcome lacks specificity"
  },
  "personalizationAnchors": ["strings explaining which candidate/RCD details were used"],
  "reasoning": "internal reasoning for why this question was chosen"
}

Return ONLY the JSON object.`;
}

export function buildGenerativePlannerUserMessage(ctx: GenerativePlannerContext): string {
  const { mode, candidate, role, coverage, turnsUsed, priorQuestions, runningThemes, maxQuestions, minQuestions } = ctx;

  const experienceBlock = candidate.experiences.length > 0
    ? candidate.experiences.map((e) =>
        `- ${e.role} at ${e.company} (${e.durationMonths}mo): ${e.highlights.join('; ')}`
      ).join('\n')
    : '  (no experiences on file)';

  const projectBlock = candidate.projects.length > 0
    ? candidate.projects.map((p) =>
        `- ${p.name}: ${p.description} [${p.technologies.join(', ')}]`
      ).join('\n')
    : '  (no projects on file)';

  const skillsBlock = candidate.skills.length > 0
    ? candidate.skills.join(', ')
    : '(none on file)';

  const teamStoryBlock = role.teamStories.length > 0
    ? role.teamStories.map((s) => `- ${s.domain} (${s.archetype}): ${s.narrative}`).join('\n')
    : '  (no team stories on file)';

  const conflictBlock = role.conflicts.length > 0
    ? role.conflicts.map((c) => `- ${c.topic}: ${c.resolution}`).join('\n')
    : '  (no conflict records on file)';

  const dealbreakerBlock = role.dealbreakers.length > 0
    ? role.dealbreakers.map((d) => `- ${d.pattern} (${d.jobRelatednessNote})`).join('\n')
    : '  (no dealbreakers on file)';

  const coverageBlock = COMPETENCY_DIMENSIONS.map((d) => `  ${d}: ${coverage[d] ?? 0}`).join('\n');

  const priorBlock = priorQuestions.length > 0
    ? priorQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
    : '  (none yet)';

  const themesBlock = runningThemes.length > 0
    ? runningThemes.map((t) => `  - ${t}`).join('\n')
    : '  (none yet)';

  const priorScreeningBlock = candidate.priorScreening
    ? `Prior screening covered: ${candidate.priorScreening.coveredDimensions.join(', ')}
Thin dimensions from prior screening: ${candidate.priorScreening.thinDimensions.join(', ')}
Key quotes from prior screening:
${candidate.priorScreening.keyQuotes.map((q) => `  - "${q}"`).join('\n')}`
    : '  (no prior screening)';

  return `# Interview mode: ${mode}
# Turn budget: ${turnsUsed} used / ${maxQuestions} max (min ${minQuestions} before early termination)

# Candidate background
## Experiences
${experienceBlock}

## Projects
${projectBlock}

## Skills
${skillsBlock}

## Prior screening summary
${priorScreeningBlock}

# Role context (from RCD)
## Team stories
${teamStoryBlock}

## Conflicts
${conflictBlock}

## Dealbreakers to avoid surfacing directly
${dealbreakerBlock}

# Current dimension coverage
${coverageBlock}

# Questions already asked this session (DO NOT REPEAT)
${priorBlock}

# Running themes from earlier turns
${themesBlock}

# Your task
Generate the NEXT question for this candidate. It must:
- Reference at least one specific detail from their background OR the team's context
- Target an uncovered or thin dimension
- Be phrased as a single, natural question (not a list)
- Assume the candidate will answer with a STAR story

Produce the JSON object now. Nothing else.`;
}

// ─── LLM call + parse ────────────────────────────────────────────────────────

export async function runGenerativeTurnPlanner(
  provider: LLMProvider | null,
  ctx: GenerativePlannerContext,
): Promise<GenerativeTurnResult | null> {
  if (!provider) {
    // No provider — generative mode cannot run. Caller falls back to static bank.
    return null;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildGenerativePlannerSystemPrompt() },
    { role: 'user', content: buildGenerativePlannerUserMessage(ctx) },
  ];

  let content: string;
  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 1024 });
    content = (completion.content ?? '').trim();
  } catch (err) {
    console.error('[generativePlanner] LLM call failed:', err);
    return null;
  }

  if (!content) {
    console.warn('[generativePlanner] LLM returned empty content.');
    return null;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parseGenerativeTurnResult(parsed);
  } catch (err) {
    console.error('[generativePlanner] Failed to parse JSON:', content.slice(0, 300), err);
    return null;
  }
}

// ─── JSON parser (strict with safe fallbacks) ────────────────────────────────

function parseGenerativeTurnResult(raw: unknown): GenerativeTurnResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const question = typeof r.question === 'string' ? r.question.trim() : '';
  if (question.length === 0) return null;

  const targetDimension = parseCompetencyDimension(r.targetDimension);
  if (!targetDimension) return null;

  const targetSlots = parseTargetSlots(r.targetSlots);
  const probeStrategy = parseProbeStrategy(r.probeStrategy);
  const personalizationAnchors = parseStringArray(r.personalizationAnchors);
  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim() : '';

  return {
    question,
    targetDimension,
    targetSlots,
    probeStrategy,
    personalizationAnchors,
    reasoning,
  };
}

function parseCompetencyDimension(v: unknown): CompetencyDimension | null {
  if (typeof v !== 'string') return null;
  const dim = v.trim().toLowerCase() as CompetencyDimension;
  return COMPETENCY_DIMENSIONS.includes(dim) ? dim : null;
}

function parseTargetSlots(v: unknown): StarSlot[] {
  if (!Array.isArray(v)) return ['S', 'T', 'A', 'R'];
  const valid: StarSlot[] = ['S', 'T', 'A', 'R'];
  return v.filter((s): s is StarSlot => typeof s === 'string' && valid.includes(s as StarSlot));
}

function parseProbeStrategy(v: unknown): GenerativeTurnResult['probeStrategy'] {
  const out: GenerativeTurnResult['probeStrategy'] = {};
  if (!v || typeof v !== 'object') return out;
  const r = v as Record<string, unknown>;
  for (const key of ['missing_S', 'missing_T', 'missing_A', 'missing_R', 'vague_outcome'] as const) {
    const val = r[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      out[key] = val.trim();
    }
  }
  return out;
}

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string').map((s) => s.trim());
}
