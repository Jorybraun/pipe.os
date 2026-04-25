/**
 * Role Discovery Interview Evaluator
 *
 * Uses Qwen3-30b-a3b-fp8 on Workers AI (env.AI binding) to score
 * role-discovery interview transcripts on three dimensions:
 *
 *   1. Coverage   (0–1) — did all 3 RCD sections get populated?
 *   2. Specificity (0–1) — is content generic or concrete?
 *   3. Tone       (0–1) — is conversation natural or interrogative?
 *
 * Input: array of exchanges [{question, answer}]
 * Output: JSON {coverage, specificity, tone, reasoning}
 */

import { buildEvaluatorSystemPrompt, buildEvaluatorUserMessage } from './evaluatorPrompt';
import type { LLMProvider, LLMMessage } from '../llm/types';
import type { CandidateQuestion, DomainCoverage, EvalResult, RoleExchange } from '../../types';

const EVALUATOR_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

export interface DiscoveryExchange {
  question: string;
  answer: string;
}

export interface DiscoveryEvaluation {
  coverage: number;
  specificity: number;
  tone: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are an expert hiring-process evaluator. Your job is to score a Role Discovery interview transcript on exactly three dimensions.

Dimensions:
1. coverage (0–1): Did the interview populate all three RCD sections — Responsibilities, Requirements, and Context/Constraints? Score 1.0 if all three are well-represented in the answers; 0.0 if none are; interpolate for partial coverage.
2. specificity (0–1): Are the answers concrete (named tools, metrics, team sizes, deadlines) or generic ("we use agile", "fast-paced environment")? Score 1.0 for highly concrete; 0.0 for entirely boilerplate; interpolate.
3. tone (0–1): Is the conversation natural and collaborative, or does it feel like an interrogation / checkbox exercise? Score 1.0 for natural, 0.0 for rigidly interrogative; interpolate.

You MUST respond with a single valid JSON object and nothing else. No markdown code fences, no prose outside the JSON. Format:

{"coverage": <number 0–1>, "specificity": <number 0–1>, "tone": <number 0–1>, "reasoning": "<2–3 sentence explanation>"}

Clamp every score to [0, 1] with at most two decimal places.`;

function buildTranscriptUserMessage(exchanges: DiscoveryExchange[]): string {
  const transcript = exchanges
    .map((ex, i) => `Q${i + 1}: ${ex.question}\nA${i + 1}: ${ex.answer}`)
    .join('\n\n');

  return `Evaluate the following Role Discovery interview transcript:\n\n${transcript}`;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return trimmed;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

// ─── Parser helpers for EvalResult ──────────────────────────────────────────

function parseGoalAssessment(raw: unknown): EvalResult['goalAssessment'] {
  if (raw === 'aligned' || raw === 'mismatched' || raw === 'vague') return raw;
  return 'vague';
}

function parseCoverageAssessment(raw: unknown): EvalResult['coverageAssessment'] {
  if (raw === 'realistic' || raw === 'overstated' || raw === 'understated') return raw;
  return 'overstated';
}

function parseToneAssessment(raw: unknown): EvalResult['toneAssessment'] {
  if (raw === 'conversational' || raw === 'interrogative' || raw === 'leading') return raw;
  return 'interrogative';
}

function parseRedundancyCheck(raw: unknown): EvalResult['redundancyCheck'] {
  if (raw === 'novel' || raw === 'duplicate' || raw === 'near_duplicate') return raw;
  return 'duplicate';
}

// ─── Eval-gated question pipeline ───────────────────────────────────────────

/**
 * Evaluate a single candidate question through the quality gate.
 *
 * Uses the LLMProvider abstraction so it works with Cloudflare AI,
 * Google AI, or Vertex AI depending on env.ROLE_AGENT_PROVIDER.
 *
 * @param provider            — LLMProvider instance
 * @param candidate           — the question to validate
 * @param conversationHistory — last exchanges for redundancy check
 * @param currentCoverage     — current domain coverage map
 * @returns                   — EvalResult (approved or rejected)
 */
export async function evaluateQuestion(
  provider: LLMProvider,
  candidate: CandidateQuestion,
  conversationHistory: RoleExchange[],
  currentCoverage: Record<string, DomainCoverage>,
): Promise<EvalResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildEvaluatorSystemPrompt() },
    { role: 'user', content: buildEvaluatorUserMessage(candidate, conversationHistory, currentCoverage) },
  ];

  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 512 });
    const content = completion.content?.trim() ?? '';
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;

    const result: EvalResult = {
      approved: parsed.approved === true,
      goalAssessment: parseGoalAssessment(parsed.goalAssessment),
      coverageAssessment: parseCoverageAssessment(parsed.coverageAssessment),
      toneAssessment: parseToneAssessment(parsed.toneAssessment),
      redundancyCheck: parseRedundancyCheck(parsed.redundancyCheck),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
    };
    if (typeof parsed.suggestedRewrite === 'string') {
      result.suggestedRewrite = parsed.suggestedRewrite;
    }
    return result;
  } catch (err) {
    console.error('[evaluateQuestion] Evaluator call failed:', err);
    // Fail closed — reject on error
    return {
      approved: false,
      goalAssessment: 'vague',
      coverageAssessment: 'overstated',
      toneAssessment: 'interrogative',
      redundancyCheck: 'duplicate',
      reason: 'Evaluator failed — rejecting for safety',
    };
  }
}

// ─── Legacy transcript evaluator (unchanged) ────────────────────────────────

/**
 * Evaluate a role-discovery transcript using the Workers AI binding.
 *
 * @param ai        — env.AI binding
 * @param exchanges — array of {question, answer} objects
 * @returns         — {coverage, specificity, tone, reasoning}
 */
export async function evaluateDiscoveryTranscript(
  ai: Ai,
  exchanges: DiscoveryExchange[],
): Promise<DiscoveryEvaluation> {
  if (!exchanges || exchanges.length === 0) {
    return {
      coverage: 0,
      specificity: 0,
      tone: 0,
      reasoning: 'No exchanges provided.',
    };
  }

  const userMessage = buildTranscriptUserMessage(exchanges);

  let raw: unknown;
  try {
    raw = await ai.run(EVALUATOR_MODEL as Parameters<typeof ai.run>[0], {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[roleDiscovery/evaluator] ai.run failed:', msg);
    throw new Error(`[roleDiscovery/evaluator] Workers AI call failed: ${msg}`);
  }

  // Normalize response shape
  let text = '';
  if (typeof (raw as { response?: string }).response === 'string') {
    text = (raw as { response: string }).response.trim();
  } else {
    const any = raw as Record<string, unknown>;
    const choices = any['choices'] as Array<{ message?: { content?: string } }> | undefined;
    if (choices?.[0]?.message?.content) {
      text = choices[0].message.content.trim();
    }
  }

  if (!text) {
    console.error('[roleDiscovery/evaluator] Empty response. Raw:', JSON.stringify(raw).slice(0, 300));
    throw new Error('[roleDiscovery/evaluator] Workers AI returned empty response.');
  }

  const cleaned = stripJsonFences(text);

  let parsed: Partial<DiscoveryEvaluation>;
  try {
    parsed = JSON.parse(cleaned) as Partial<DiscoveryEvaluation>;
  } catch (err) {
    console.error('[roleDiscovery/evaluator] JSON parse failed. Cleaned text:', cleaned.slice(0, 500));
    throw new Error(`[roleDiscovery/evaluator] Failed to parse evaluator JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result: DiscoveryEvaluation = {
    coverage: clamp01(Number(parsed.coverage)),
    specificity: clamp01(Number(parsed.specificity)),
    tone: clamp01(Number(parsed.tone)),
    reasoning: typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
      ? parsed.reasoning.trim()
      : 'No reasoning provided by model.',
  };

  return result;
}
