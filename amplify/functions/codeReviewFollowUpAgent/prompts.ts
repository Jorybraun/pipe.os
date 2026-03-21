/**
 * Prompt templates for codeReviewFollowUpAgent
 *
 * Strategy:
 * - Reference specific candidate annotations by file/line/comment
 * - Mix question types: why did you flag X, what would you fix, did you notice Y,
 *   how would you prioritise these changes
 * - Exactly 5 SHORT_ANSWER questions
 * - Return valid JSON only — no markdown, no prose wrapper
 */

import type { CandidateAnnotation } from './types';

/**
 * Builds the system prompt for the follow-up question generator.
 */
export function buildSystemPrompt(): string {
  return `You are a senior engineering interviewer reviewing a candidate's code review submission.
Your job is to generate exactly 5 follow-up questions that probe the candidate's reasoning,
depth of understanding, and awareness of issues they may have missed.

CRITICAL RULES:
- Return ONLY a valid JSON object — no markdown fences, no prose, no explanation
- The JSON must have exactly one key: "questions" — an array of exactly 5 objects
- Each question object must have: "id" (string), "question" (string), "context" (string)
- Questions should be conversational and open-ended, like a real interview
- Mix question types across the 5:
  1. WHY question: probe reasoning behind a specific annotation they made
  2. FIX question: ask what their fix would look like for an issue they flagged
  3. MISSED question: ask about a significant issue they did NOT flag (pick one from the diff)
  4. PRIORITISATION question: ask how they would order the fixes they found
  5. DEPTH question: a conceptual question probing understanding of the underlying bug type

RESPONSE FORMAT (exactly):
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "context": "..."
    },
    ...
  ]
}`;
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
        `  [${i + 1}] File index ${a.fileIndex}, line ${a.lineNumber}, severity=${a.severity}: "${a.comment}"`
      ).join('\n')
    : '  (no annotations submitted)';

  return `CHALLENGE: ${challengeTitle}

INSTRUCTIONS TO CANDIDATE:
${challengeInstructions}

CODE/DIFF CONTEXT:
${codeContext}

CANDIDATE'S REVIEW:
Verdict: ${verdict}
Summary: "${summary}"

Annotations the candidate made:
${annotationsSummary}

Generate 5 follow-up questions based on the above. Reference specific annotations by their
number (e.g. "In annotation [2] you flagged...") where relevant. For the MISSED question,
pick a real issue visible in the diff that the candidate did not annotate.`;
}
