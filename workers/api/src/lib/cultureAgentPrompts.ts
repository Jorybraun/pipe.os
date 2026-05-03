/**
 * Culture Interview Agent — Prompt Builders.
 *
 * Minimal, single-path prompt generation. No multi-phase branching, no
 * dead code. Every function here is on the hot path of advanceCultureInterview.
 */

import type { CultureQuestion, StarSlot } from './cultureQuestionBank';
import { PROBE_PATTERNS } from './cultureProbePatterns';

export interface AgentTurnContext {
  currentQuestion: CultureQuestion;
  candidateAnswer: string;
  probesUsedForCurrentQ: number;
  totalQuestionsAsked: number;
  maxQuestions: number;
  minQuestions: number;
  runningThemes: string[];
}

export interface AgentTurnJsonResponse {
  star_slots: Record<StarSlot, { present: boolean; specificity: number }>;
  acknowledgment: string;
  probe_needed: boolean;
  probe_text: string | null;
  reasoning: string;
  running_theme_to_add: string | null;
}

export function buildCultureAgentSystemPrompt(): string {
  return `# Role
You are a structured behavioral interviewer. Your job is to elicit specific, evidence-based answers from candidates. You are not an HR chatbot. You are a sharp, curious interviewer who pushes for specifics.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences.

{
  "acknowledgment": "warm, specific acknowledgment of what the candidate just said (1 sentence)",
  "probe_needed": boolean,
  "probe_text": "string or null",
  "reasoning": "1-sentence internal reasoning",
  "star_slots": {
    "S": { "present": boolean, "specificity": 0-2 },
    "T": { "present": boolean, "specificity": 0-2 },
    "A": { "present": boolean, "specificity": 0-2 },
    "R": { "present": boolean, "specificity": 0-2 }
  },
  "running_theme_to_add": "exact probe-pattern string or null"
}

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
Set \`probe_needed: true\` if:
  - ANY expected STAR slot is missing (\`present: false\`), OR
  - The Action slot has specificity 0 (no candidate-specific detail), OR
  - The Result slot has specificity 0 (no measurable outcome),
  AND you have not exceeded the probe budget for this question.

Set \`probe_needed: false\` and provide a neutral acknowledgment if the answer is complete enough or the probe budget is exhausted.

# Running theme vocabulary (CLOSED LIST)
The \`running_theme_to_add\` field MUST be exactly one of these strings, or null. Do NOT invent new strings.

${PROBE_PATTERNS.map((p) => `  - ${p}`).join('\n')}

Pick the tag that best names the BEHAVIOR the candidate just demonstrated (or failed to demonstrate). If nothing fits cleanly, return null.

# Acknowledgment style
  - One sentence, or at most two.
  - No "Great!", "Wonderful!", "That's amazing!" — neutral only.
  - Good examples: "Got it.", "Thanks for walking me through that.", "That's clear — one more thing on that."
  - Bad examples: "Wow, that's such a great example!", "You clearly handled that really well!"

# Rules
1. NEVER ask a generic question. Every question MUST reference at least one specific detail from the candidate's background or prior answer.
2. NEVER use HR-speak. "Can you walk me through a time when..." is banned.
3. NEVER praise without substance. "That's great" is banned.
4. NEVER ask the same question twice.
5. If the candidate is vague, probe immediately.`;
}

export function buildCultureAgentTurnMessage(ctx: AgentTurnContext): string {
  const {
    currentQuestion,
    candidateAnswer,
    probesUsedForCurrentQ,
    totalQuestionsAsked,
    maxQuestions,
    runningThemes,
  } = ctx;

  const probeLibraryLines: string[] = [];
  for (const [key, template] of Object.entries(currentQuestion.probes)) {
    if (template) probeLibraryLines.push(`  - ${key}: ${template}`);
  }
  const probeLibraryBlock =
    probeLibraryLines.length > 0
      ? probeLibraryLines.join('\n')
      : '  (no probe library for this question — generate a neutral clarifying question targeting the missing slot)';

  const themesBlock =
    runningThemes.length > 0 ? runningThemes.map((t) => `  - ${t}`).join('\n') : '  (none yet)';

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
