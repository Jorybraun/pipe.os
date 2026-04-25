/**
 * Unified Agent Runtime — Eval Gate
 *
 * Generic quality gate. Evaluates a candidate turn across multiple dimensions
 * and returns an approval verdict based on a configurable rule.
 */

import type { LLMProvider, LLMMessage } from '../llm/types';
import type {
  AgentSession,
  AgentTurn,
  EvalConfig,
  EvalDimension,
  EvalDimensionConfig,
  EvalGateResult,
  ApprovalRule,
} from './types';
import { callProvider } from './provider';

function buildDimensionMessages(
  config: EvalDimensionConfig,
  candidate: AgentTurn,
  session: AgentSession,
): LLMMessage[] {
  return [
    { role: 'system', content: config.promptTemplate },
    {
      role: 'user',
      content: JSON.stringify(
        {
          candidateQuestion: candidate.questionText,
          turnIndex: candidate.idx,
          transcriptTurns: session.transcript.turns.map((t) => ({
            question: t.questionText,
            response: t.candidateResponse,
          })),
          scratchpad: session.transcript.scratchpad,
        },
        null,
        2,
      ),
    },
  ];
}

function parseDimensionOutput(raw: string): EvalDimension {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {
      id: 'unknown',
      verdict: 'fail',
      score: 0,
      reason: 'Dimension output was not valid JSON',
    };
  }

  const verdictRaw = parsed.verdict;
  const verdict: EvalDimension['verdict'] =
    verdictRaw === 'pass' || verdictRaw === 'fail' || verdictRaw === 'warn'
      ? verdictRaw
      : 'fail';

  const scoreRaw = Number(parsed.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, Math.round(scoreRaw * 100) / 100)) : 0;

  return {
    id: typeof parsed.id === 'string' ? parsed.id : 'unknown',
    verdict,
    score,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
  };
}

function applyApprovalRule(
  dimensions: EvalDimension[],
  rule: ApprovalRule,
  minScore: number | undefined,
): boolean {
  if (dimensions.length === 0) return true;

  switch (rule) {
    case 'all_pass':
      return dimensions.every((d) => d.verdict === 'pass');

    case 'no_fail':
      return dimensions.every((d) => d.verdict !== 'fail');

    case 'weighted': {
      const totalWeight = dimensions.reduce((sum, d, i) => {
        // weight is not on EvalDimension; use 1 as default
        return sum + 1;
      }, 0);
      if (totalWeight === 0) return true;
      const weightedScore = dimensions.reduce((sum, d) => sum + d.score, 0);
      const normalized = weightedScore / totalWeight;
      const threshold = minScore ?? 0.6;
      return normalized >= threshold;
    }

    default:
      return false;
  }
}

export async function runEvalGate(
  provider: LLMProvider | null,
  candidate: AgentTurn,
  session: AgentSession,
  config: EvalConfig,
): Promise<EvalGateResult> {
  if (!provider || config.dimensions.length === 0) {
    return { approved: true, dimensions: [], rewrite: undefined };
  }

  const dimensionResults = await Promise.all(
    config.dimensions.map(async (dimConfig) => {
      const messages = buildDimensionMessages(dimConfig, candidate, session);
      try {
        const result = await callProvider(provider, messages, {
          forceJson: true,
          maxTokens: 512,
          tools: undefined,
          budgetLabel: 'evaluator',
          signal: undefined,
        });
        const parsed = parseDimensionOutput(result.content);
        parsed.id = dimConfig.id;
        return parsed;
      } catch (err) {
        console.error(`[evalGate] Dimension ${dimConfig.id} failed:`, err);
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
    rewrite: undefined,
  };
}
