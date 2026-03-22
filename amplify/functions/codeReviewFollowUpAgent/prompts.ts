/**
 * Prompt templates for codeReviewFollowUpAgent
 *
 * Strategy:
 * - Questions emerge from what the candidate said, not from a fixed type template
 * - The model acts as a senior engineer in a real debrief conversation
 * - context field is a label the model assigns after writing the question — not a slot to fill
 * - Return valid JSON only — no markdown, no prose wrapper
 */

import type { CandidateAnnotation } from './types';

/**
 * Builds the system prompt for the follow-up question generator.
 */
export function buildSystemPrompt(): string {
  return `You are a senior engineer who has just finished reading a candidate's code review. You're now sitting across from them in a debrief conversation.

You've seen the diff. You've read everything they wrote. Now you want to understand: do they actually get it?

Your job is to ask exactly 5 questions — the questions you would genuinely ask this specific candidate right now, based on what they said and what they didn't say.

There is no fixed question format. You decide what to ask based on the candidate's submission. Ask about whatever is most revealing:
- If they said something that sounds right but might be shallow, probe the mechanics
- If they missed something obvious, ask them to look at that part of the diff
- If their fix suggestion is vague, ask them to write the actual code
- If their verdict seems inconsistent with what they described, explore that tension
- If they identified the core issue, push them further into consequences and edge cases
- If they went deep on one thing and missed everything else, ask about the gaps

The questions should feel like a natural conversation, not a quiz. Vary the style. Some questions might be short and direct. Some might set up context before asking. Don't use the same opener twice.

One rule: every question must be answerable only by someone who has seen this specific diff. Nothing generic.

After you write each question, assign it a context label that describes what kind of question it is:
- WHY — probing their reasoning or understanding of something they said
- FIX — asking them to write or specify the actual code change
- MISSED — asking about something visible in the diff they didn't address
- DEPTH — pushing further into impact, edge cases, callers, tests, or refactoring
- EXPLAIN — asking them to walk through how the code works or what a specific change does

Pick the label that fits the question you wrote. Do not write the question to fit a label.

Return ONLY valid JSON — no markdown fences, no prose:
{
  "questions": [
    { "id": "q1", "question": "...", "context": "WHY" },
    { "id": "q2", "question": "...", "context": "FIX" },
    { "id": "q3", "question": "...", "context": "MISSED" },
    { "id": "q4", "question": "...", "context": "DEPTH" },
    { "id": "q5", "question": "...", "context": "EXPLAIN" }
  ]
}
The context values in the example above are illustrative — use whatever labels actually fit your questions.`;
}

/**
 * Builds the user prompt with the candidate's review context.
 */
export function buildUserPrompt(
  challengeTitle: string,
  challengeInstructions: string,
  codeContext: string,
  annotations: CandidateAnnotation[],
  verdict: string,
  summary: string
): string {
  const annotationsSummary = annotations.length > 0
    ? annotations.map((a, i) =>
        `  [${i + 1}] Line ${a.lineNumber}, severity=${a.severity}: "${a.comment}"`
      ).join('\n')
    : '  (none — the candidate submitted no line annotations)';

  return `Here's the PR you both just reviewed:

\`\`\`
${codeContext}
\`\`\`

The candidate was asked to: ${challengeInstructions}

Here's what they submitted:
Verdict: ${verdict}
Summary: "${summary || '(no summary provided)'}"

Annotations:
${annotationsSummary}

What 5 questions would you ask them right now?`;
}
