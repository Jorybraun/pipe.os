/**
 * Implementation Scorer Prompts — structured prompt builders for each
 * Sherlock dimension. Designed for Gemma-3-27b-it via Workers AI.
 */

import type { SherlockDimension } from './types';
import { ANCHOR_BY_DIMENSION } from './types';

export interface ScorerPromptInput {
  /** Candidate's code submission (file contents or single string) */
  submissionText: string;
  /** Challenge instructions / task description */
  challengeInstructions: string;
  /** Optional repo context (README, issue description, etc.) */
  repoContext?: string | undefined;
  /** Telemetry features if available */
  telemetry?: {
    tdd_ratio: number | null;
    debug_strategy_pattern: string | null;
    ai_collaboration_style: string | null;
  };
}

function buildBasePrompt(input: ScorerPromptInput, dimension: SherlockDimension): string {
  const anchor = ANCHOR_BY_DIMENSION[dimension];
  const telemetryBlock = input.telemetry
    ? `
Telemetry (if available):
- TDD ratio (test files / total files): ${input.telemetry.tdd_ratio ?? 'unknown'}
- Debug strategy pattern: ${input.telemetry.debug_strategy_pattern ?? 'unknown'}
- AI collaboration style: ${input.telemetry.ai_collaboration_style ?? 'unknown'}
`
    : '';

  return `You are an expert software engineering assessor scoring a candidate's code submission.

## Task
Evaluate the candidate's submission on the dimension: **${dimension}**

## BARS Rubric (Behaviorally Anchored Rating Scale)
${anchor}

## Challenge Instructions
${input.challengeInstructions}

${input.repoContext ? `## Repo / Issue Context\n${input.repoContext}\n` : ''}
${telemetryBlock}
## Candidate Submission
\`\`\`
${input.submissionText.slice(0, 6000)}
\`\`\`
${input.submissionText.length > 6000 ? '\n(Submission truncated to ~6000 chars for token limits)\n' : ''}

## Instructions
Respond with **only** a JSON object in this exact shape:
{
  "bars_score": number,        // 1–5 integer
  "evidence_quotes": string[], // 1–3 verbatim excerpts from the submission that justify the score
  "reasoning": string,         // 2–3 sentences explaining why this score was chosen
  "confidence": number         // 0.0–1.0 epistemic confidence
}

Do not include markdown formatting, explanations outside the JSON, or any other text.
`;
}

export function buildReasoningDecompositionPrompt(input: ScorerPromptInput): string {
  return buildBasePrompt(input, 'reasoning_decomposition');
}

export function buildCodeConstructionPrompt(input: ScorerPromptInput): string {
  return buildBasePrompt(input, 'code_construction');
}

export function buildAdaptabilityPrompt(input: ScorerPromptInput): string {
  return buildBasePrompt(input, 'adaptability');
}

export function buildDebuggingMaintenancePrompt(input: ScorerPromptInput): string {
  return buildBasePrompt(input, 'debugging_maintenance');
}
