/**
 * Question Generator — Eval Gate
 *
 * Lightweight quality gate for generated interview questions.
 * Runs dimension evaluations in parallel. No UAR dependency.
 */

import type { LLMProvider, LLMMessage } from '../../llm/types';
import type { InterviewState } from '../interview/types';
import type { GeneratedQuestion } from './generator';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvalDimensionConfig {
  id: string;
  promptTemplate: string;
}

export interface EvalDimensionResult {
  id: string;
  verdict: 'pass' | 'fail' | 'warn';
  score: number;
  reason: string;
}

export interface EvalResult {
  approved: boolean;
  dimensions: EvalDimensionResult[];
}

export type ApprovalRule = 'all_pass' | 'no_fail' | 'weighted';

export interface EvalConfig {
  dimensions: EvalDimensionConfig[];
  approvalRule: ApprovalRule;
  minScore?: number;
}

// ─── Default dimensions for role-discovery questions ─────────────────────────

const BREVITY_PROMPT = `You are a brevity evaluator for interview questions.

Rules:
- question.text must be ≤ 15 words → pass
- 16-20 words → warn
- > 20 words → fail

Respond with JSON only:
{
  "verdict": "pass" | "warn" | "fail",
  "score": <0-1>,
  "reason": "<one sentence>"
}`;

const COVERAGE_PROMPT = `You are a coverage evaluator for interview questions.

Rules:
- The question should advance a domain that is NOT already "deep"
- If all domains are "deep", any domain is acceptable
- The expectedCoverage.to should be higher than expectedCoverage.from

Respond with JSON only:
{
  "verdict": "pass" | "warn" | "fail",
  "score": <0-1>,
  "reason": "<one sentence>"
}`;

const REDUNDANCY_PROMPT = `You are a redundancy evaluator for interview questions.

Rules:
- The question must not be substantially similar to any previously asked question
- Paraphrases of the same question count as redundant
- Follow-ups on the same topic with different framing are acceptable
- Use the previousAnswers to determine whether a follow-up adds new information

Respond with JSON only:
{
  "verdict": "pass" | "warn" | "fail",
  "score": <0-1>,
  "reason": "<one sentence>"
}`;

const PHASE_ALIGNMENT_PROMPT = `You are a phase-alignment evaluator for interview questions.

Rules:
- CONTEXT phase: introductory or grand_tour questions only
- DISCOVERY phase: example, drilling, direct, hypothesis questions
- PRIORITIZE phase: direct or contrast questions (convergent)
- EVP_FRICTION phase: direct or hypothesis questions
- WRAP_UP phase: summary + confirmation question only

Respond with JSON only:
{
  "verdict": "pass" | "warn" | "fail",
  "score": <0-1>,
  "reason": "<one sentence>"
}`;

const ACKNOWLEDGMENT_PROMPT = `You are an acknowledgment-quality evaluator for interview questions.

Rules:
- acknowledgment must reference something specific from the user's answer
- Empty/generic acknowledgments ("Got it", "Thanks") → warn
- acknowledgment that shows understanding of the answer → pass
- acknowledgment longer than 2 sentences → fail

Respond with JSON only:
{
  "verdict": "pass" | "warn" | "fail",
  "score": <0-1>,
  "reason": "<one sentence>"
}`;

export const DEFAULT_EVAL_DIMENSIONS: EvalDimensionConfig[] = [
  { id: 'brevity', promptTemplate: BREVITY_PROMPT },
  { id: 'coverage', promptTemplate: COVERAGE_PROMPT },
  { id: 'redundancy', promptTemplate: REDUNDANCY_PROMPT },
  { id: 'phase_alignment', promptTemplate: PHASE_ALIGNMENT_PROMPT },
  { id: 'acknowledgment_quality', promptTemplate: ACKNOWLEDGMENT_PROMPT },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildEvalMessages(
  dimConfig: EvalDimensionConfig,
  state: InterviewState,
  candidate: GeneratedQuestion,
): LLMMessage[] {
  const lastAnswer = state.exchanges[state.exchanges.length - 1]?.answer ?? '';
  const previousQuestions = state.exchanges.map((ex) => ex.question);
  const previousAnswers = state.exchanges.map((ex) => ex.answer ?? '');

  return [
    { role: 'system', content: dimConfig.promptTemplate },
    {
      role: 'user',
      content: JSON.stringify(
        {
          questionText: candidate.question.text,
          acknowledgment: candidate.acknowledgment,
          questionType: candidate.question.questionType,
          expectedCoverage: candidate.question.expectedCoverage,
          phase: state.phase,
          lastAnswer,
          previousQuestions,
          previousAnswers,
        },
        null,
        2,
      ),
    },
  ];
}

function parseDimensionOutput(id: string, raw: string): EvalDimensionResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { id, verdict: 'fail', score: 0, reason: 'Dimension output was not valid JSON' };
  }

  const verdictRaw = parsed.verdict;
  const verdict: EvalDimensionResult['verdict'] =
    verdictRaw === 'pass' || verdictRaw === 'fail' || verdictRaw === 'warn' ? verdictRaw : 'fail';

  const scoreRaw = Number(parsed.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, Math.round(scoreRaw * 100) / 100)) : 0;

  return {
    id,
    verdict,
    score,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
  };
}

function applyApprovalRule(dimensions: EvalDimensionResult[], rule: ApprovalRule, minScore?: number): boolean {
  if (dimensions.length === 0) return true;

  switch (rule) {
    case 'all_pass':
      return dimensions.every((d) => d.verdict === 'pass');
    case 'no_fail':
      return dimensions.every((d) => d.verdict !== 'fail');
    case 'weighted': {
      const avg = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
      return avg >= (minScore ?? 0.6);
    }
    default:
      return false;
  }
}

// ─── Eval gate ───────────────────────────────────────────────────────────────

export interface EvaluateQuestionOptions {
  config?: EvalConfig;
  maxTokens?: number;
}

/**
 * Evaluate a generated question across configured dimensions.
 *
 * Runs all dimensions in parallel. Returns approved=false if any dimension
 * fails (under all_pass) or if the weighted average is below threshold.
 */
export async function evaluateQuestion(
  state: InterviewState,
  candidate: GeneratedQuestion,
  provider: LLMProvider | null,
  opts: EvaluateQuestionOptions = {},
): Promise<EvalResult> {
  const config = opts.config ?? {
    dimensions: DEFAULT_EVAL_DIMENSIONS,
    approvalRule: 'no_fail',
  };

  if (!provider || config.dimensions.length === 0) {
    return { approved: true, dimensions: [] };
  }

  const dimensionResults = await Promise.all(
    config.dimensions.map(async (dimConfig) => {
      const messages = buildEvalMessages(dimConfig, state, candidate);
      try {
        const completion = await provider.complete(messages, { forceJson: true, maxTokens: opts.maxTokens ?? 512 });
        const parsed = parseDimensionOutput(dimConfig.id, completion.content ?? '');
        return parsed;
      } catch (err) {
        console.error(`[questionEval] Dimension ${dimConfig.id} failed:`, err);
        return {
          id: dimConfig.id,
          verdict: 'fail' as const,
          score: 0,
          reason: 'Dimension evaluation call failed',
        };
      }
    }),
  );

  const approved = applyApprovalRule(dimensionResults, config.approvalRule, config.minScore);

  return {
    approved,
    dimensions: dimensionResults,
  };
}
