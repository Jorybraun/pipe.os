/**
 * Culture Interview Agent — prompt builders.
 *
 * The agent has ONE LLM responsibility per turn: analyze the candidate's
 * latest answer against the current question and decide whether to probe
 * (and if so, what to say) or advance. All deterministic work — question
 * selection, termination, and coverage tracking — happens in `cultureAgent.ts`.
 *
 * Design notes (grounded in research brief §2.4 and §2.6):
 * - The agent does NOT generate the seed questions. Those come from the
 *   deterministic bank (`cultureQuestionBank.ts`). Only probes are generative,
 *   and they are seeded from the question's probe library to keep tone and
 *   focus consistent across runs.
 * - Probe detection is structured: the model emits a STAR-slot map that the
 *   agent can use both for the current turn (decide to probe) and for the
 *   scorer later (the scorer re-analyzes the full transcript independently).
 * - Acknowledgments are short and neutral. The agent is NOT a cheerleader —
 *   over-enthusiastic acknowledgments bias candidates toward embellishment
 *   (research brief §2.5).
 * - The model must NEVER ask a question that isn't in the bank. If it decides
 *   not to probe, the agent picks the next bank question and only asks the
 *   model to generate a short acknowledgment bridge.
 */

import type { CultureQuestion, StarSlot } from './cultureQuestionBank';
import { PROBE_PATTERNS } from './cultureProbePatterns';

// ─── Turn input / output shapes ─────────────────────────────────────────────

export interface AgentTurnContext {
  /** The question the candidate just answered. */
  currentQuestion: CultureQuestion;
  /** Candidate's verbatim answer to the current question. */
  candidateAnswer: string;
  /** How many probes have already been asked for this specific question. */
  probesUsedForCurrentQ: number;
  /** How many total questions have been asked in the interview so far. */
  totalQuestionsAsked: number;
  /** Hard cap on total questions. Default 20 per ADR-029. */
  maxQuestions: number;
  /** Minimum questions before we can terminate. Default 5 per ADR-029. */
  minQuestions: number;
  /**
   * Minimal running themes the agent has observed (set by prior turns).
   * Kept short — 3-5 bullets max — to stay in Gemma's useful context budget.
   */
  runningThemes: string[];
}

/**
 * Structured JSON the LLM must return on every turn.
 *
 * The agent prompts Gemma to output this shape and nothing else. The
 * `cultureAgent.ts` parser is strict and falls back to safe defaults on any
 * missing/invalid field.
 */
export interface AgentTurnJsonResponse {
  /**
   * STAR slot analysis of the candidate's latest answer. Each slot is either
   * present or missing; if present, `specificity` is 0-2 (0 = vague,
   * 1 = some detail, 2 = concrete and measurable).
   */
  star_slots: Record<StarSlot, { present: boolean; specificity: number }>;
  /**
   * Short natural acknowledgment the agent will say before the next turn.
   * Must be ≤1 sentence, neutral in tone, not evaluative.
   */
  acknowledgment: string;
  /**
   * Whether the agent should ask a follow-up probe on the current question.
   * True only if expected slots are missing AND probesUsedForCurrentQ < maxProbes.
   */
  probe_needed: boolean;
  /**
   * If probe_needed is true: the exact probe text to ask. Must be grounded
   * in the candidate's actual words (reference something they said). Must
   * NOT introduce a new scenario.
   *
   * If probe_needed is false: null.
   */
  probe_text: string | null;
  /**
   * Reasoning trace — 1-2 sentences explaining the probe/advance decision.
   * Stored in the transcript scratchpad for auditability; not shown to the
   * candidate.
   */
  reasoning: string;
  /**
   * Optional probe-pattern tag to append to the scratchpad. MUST be one of
   * the closed-vocabulary tags in `cultureProbePatterns.ts` or null. The
   * selector intersects this list against question `probe_patterns` to award
   * a theme-resonance bonus, so free-text strings are dead code.
   */
  running_theme_to_add: string | null;
}

// ─── System prompt ──────────────────────────────────────────────────────────

/**
 * Build the system prompt for a culture interview turn.
 *
 * The system prompt is intentionally long because Gemma 4 26B benefits from
 * explicit role definition and a worked example of the JSON shape. The cost
 * is negligible (~800 tokens of system prompt × $0.10/M = $0.00008 per turn).
 */
export function buildCultureAgentSystemPrompt(): string {
  return `You are a behavioral interviewer conducting a STAR-format culture interview for a technical hiring process. You are rigorous, neutral, and structured. You are not a cheerleader.

# Your one job this turn
Given the question the candidate just answered and their answer, produce a single JSON object that:
  1. Analyzes which STAR slots (Situation, Task, Action, Result) are present and how specific each one is.
  2. Decides whether the answer needs a probe or is complete enough to move on.
  3. If probing: writes the exact probe text to ask next, grounded in the candidate's own words.
  4. If moving on: writes a short neutral acknowledgment — no evaluation, no flattery.

# STAR slot rubric
For each slot, emit \`{present: boolean, specificity: 0|1|2}\`.
  - S (Situation): the concrete context — when, where, with whom.
    - 0: "I had a problem at work once."
    - 1: "When I was working on our payments service last year..."
    - 2: "Last March our payments service went down at 2am during the Black Friday rollout, and I was the on-call engineer."
  - T (Task): the specific thing that was THEIRS to figure out or do.
    - 0: "Something needed to happen."
    - 1: "I needed to fix it."
    - 2: "I had to decide within ten minutes whether to roll back the release or push forward a hotfix, knowing rolling back would break a customer demo."
  - A (Action): what THEY specifically did, in their own voice (first person, not "we").
    - 0: "We discussed it."
    - 1: "I talked to the team and we decided to fix it."
    - 2: "I paged the platform lead, ran a git bisect, found the bad commit, reverted it, wrote a post-mortem the next day."
  - R (Result): the concrete, measurable outcome AND their reflection on it.
    - 0: "It worked out."
    - 1: "We fixed it and moved on."
    - 2: "Downtime was 14 minutes, no data loss. I later set up a canary deploy to catch this pattern, and we haven't had a repeat in six months."

# Probe decision rule
Probe if:
  - ANY expected slot is missing (\`present: false\`), OR
  - The Action slot has specificity 0 (no candidate-specific detail), OR
  - The Result slot has specificity 0 (no measurable outcome),
  AND probes-used-for-this-question < max-probes.

Otherwise, move on.

NEVER probe more than the budget allows. NEVER invent new scenarios. The probe MUST reference something the candidate actually said — either a specific word or phrase from their answer or a specific gap in it.

# Probe library for the current question
You will be given a probe library keyed by deficiency type. Use these templates as your starting point and adapt the wording so it references the candidate's actual answer. Do NOT paste them verbatim.

# Running theme vocabulary (CLOSED LIST)
The \`running_theme_to_add\` field MUST be exactly one of these strings, or null. Do NOT invent new strings — free text is silently discarded by the selector.

${PROBE_PATTERNS.map((p) => `  - ${p}`).join('\n')}

Pick the tag that best names the BEHAVIOR the candidate just demonstrated (or failed to demonstrate). If nothing fits cleanly, return null.

# Acknowledgment style
  - One sentence, or at most two.
  - No "Great!", "Wonderful!", "That's amazing!" — neutral only.
  - Good examples: "Got it.", "Thanks for walking me through that.", "That's clear — one more thing on that."
  - Bad examples: "Wow, that's such a great example!", "You clearly handled that really well!"

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. This exact shape:

{
  "star_slots": {
    "S": {"present": true, "specificity": 2},
    "T": {"present": true, "specificity": 1},
    "A": {"present": false, "specificity": 0},
    "R": {"present": false, "specificity": 0}
  },
  "acknowledgment": "Got it.",
  "probe_needed": true,
  "probe_text": "You said the team decided to fix it — what did you specifically do in that?",
  "reasoning": "Action slot is missing (candidate used 'we' throughout); probing for personal action before moving on.",
  "running_theme_to_add": null
}

If the answer is complete enough:

{
  "star_slots": {
    "S": {"present": true, "specificity": 2},
    "T": {"present": true, "specificity": 2},
    "A": {"present": true, "specificity": 2},
    "R": {"present": true, "specificity": 2}
  },
  "acknowledgment": "Thanks for walking me through that — that's clear.",
  "probe_needed": false,
  "probe_text": null,
  "reasoning": "All four STAR slots are present with concrete detail. Moving on.",
  "running_theme_to_add": "Candidate consistently names specific teammates and decisions rather than abstracting to 'the team'."
}

Return ONLY the JSON object. No code fences. No commentary before or after.`;
}

// ─── Turn user-message builder ──────────────────────────────────────────────

/**
 * Build the user message for a single turn. Includes the current question,
 * the candidate's answer, the probe budget state, and the probe library for
 * the current question.
 */
export function buildCultureAgentTurnMessage(ctx: AgentTurnContext): string {
  const { currentQuestion, candidateAnswer, probesUsedForCurrentQ, totalQuestionsAsked, maxQuestions, runningThemes } = ctx;

  const probeLibraryLines: string[] = [];
  for (const [key, template] of Object.entries(currentQuestion.probes)) {
    if (template) probeLibraryLines.push(`  - ${key}: ${template}`);
  }
  const probeLibraryBlock = probeLibraryLines.length > 0
    ? probeLibraryLines.join('\n')
    : '  (no probe library for this question — generate a neutral clarifying question targeting the missing slot)';

  const themesBlock = runningThemes.length > 0
    ? runningThemes.map((t) => `  - ${t}`).join('\n')
    : '  (none yet)';

  const probesRemaining = currentQuestion.maxProbes - probesUsedForCurrentQ;

  return `# Current interview state
Total questions asked: ${totalQuestionsAsked} / max ${maxQuestions}
Probes used for this question: ${probesUsedForCurrentQ} / max ${currentQuestion.maxProbes} (probes remaining: ${probesRemaining})

# Running themes from earlier turns
${themesBlock}

# The question the candidate just answered
Q-ID: ${currentQuestion.id}
Dimensions: ${currentQuestion.dimensions.join(', ')}
Expected STAR slots: ${currentQuestion.expectedSlots.join(', ')}

> ${currentQuestion.text}

# Candidate's answer
"""
${candidateAnswer.trim()}
"""

# Probe library for this question (adapt to candidate's actual words — do NOT paste verbatim)
${probeLibraryBlock}

# Your turn
${probesRemaining <= 0 ? 'NOTE: probe budget for this question is exhausted — probe_needed MUST be false.' : ''}

Produce the JSON object now. Nothing else.`;
}
