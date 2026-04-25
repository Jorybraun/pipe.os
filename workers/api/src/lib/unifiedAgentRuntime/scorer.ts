/**
 * Unified Agent Runtime — Scorer
 *
 * Generic multi-agent scoring orchestrator.
 */

import type { LLMProvider, LLMMessage } from '../llm/types';
import type {
  AgentSession,
  ScoreReport,
  ScoreDimension,
  ScoringConfig,
  ScoringDimensionConfig,
} from './types';
import { callProvider } from './provider';

function buildDimensionMessages(
  config: ScoringDimensionConfig,
  session: AgentSession,
): LLMMessage[] {
  const transcript = session.transcript.turns.map((t) => ({
    question: t.questionText,
    response: t.candidateResponse,
    metadata: t.metadata,
  }));

  return [
    { role: 'system', content: config.promptTemplate },
    {
      role: 'user',
      content: JSON.stringify(
        {
          transcript,
          scratchpad: session.transcript.scratchpad,
          agentType: session.agentType,
        },
        null,
        2,
      ),
    },
  ];
}

function parseDimensionOutput(raw: string, config: ScoringDimensionConfig): ScoreDimension {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {
      id: config.id,
      score: 0,
      weight: config.weight,
      evidenceQuotes: [],
      confidence: 0,
    };
  }

  const scoreRaw = Number(parsed.score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(5, Math.round(scoreRaw))) : 0;

  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, Math.round(confidenceRaw * 100) / 100))
    : 0;

  const evidence = Array.isArray(parsed.evidenceQuotes)
    ? (parsed.evidenceQuotes as string[]).filter((s): s is string => typeof s === 'string')
    : [];

  return {
    id: config.id,
    score,
    weight: config.weight,
    evidenceQuotes: evidence,
    confidence,
  };
}

function validateGrounding(
  dimensions: ScoreDimension[],
  session: AgentSession,
): string[] {
  const transcriptText = session.transcript.turns
    .map((t) => `${t.questionText} ${t.candidateResponse ?? ''}`)
    .join(' ')
    .toLowerCase();

  const ungrounded: string[] = [];
  for (const dim of dimensions) {
    for (const quote of dim.evidenceQuotes) {
      if (quote.trim().length > 0 && !transcriptText.includes(quote.toLowerCase())) {
        ungrounded.push(`${dim.id}: "${quote.slice(0, 80)}"`);
      }
    }
  }
  return ungrounded;
}

export async function scoreSession(
  provider: LLMProvider | null,
  session: AgentSession,
  config: ScoringConfig,
): Promise<ScoreReport> {
  if (!provider || config.dimensions.length === 0) {
    return {
      dimensions: [],
      narrative: 'No scoring configuration or provider available.',
      recommendation: undefined,
    };
  }

  const dimensionResults = await Promise.all(
    config.dimensions.map(async (dimConfig) => {
      const messages = buildDimensionMessages(dimConfig, session);
      try {
        const result = await callProvider(provider, messages, {
          forceJson: true,
          maxTokens: 1024,
          tools: undefined,
          budgetLabel: 'scorer',
          signal: undefined,
        });
        return parseDimensionOutput(result.content, dimConfig);
      } catch (err) {
        console.error(`[scorer] Dimension ${dimConfig.id} failed:`, err);
        return {
          id: dimConfig.id,
          score: 0,
          weight: dimConfig.weight,
          evidenceQuotes: [],
          confidence: 0,
        };
      }
    }),
  );

  if (config.groundingRequirement) {
    const ungrounded = validateGrounding(dimensionResults, session);
    if (ungrounded.length > 0) {
      console.warn('[scorer] Ungrounded evidence detected:', ungrounded);
      const transcriptText = session.transcript.turns
        .map((t) => `${t.questionText} ${t.candidateResponse ?? ''}`)
        .join(' ')
        .toLowerCase();
      for (const dim of dimensionResults) {
        const hasUngrounded = dim.evidenceQuotes.some(
          (q) =>
            q.trim().length > 0 &&
            !transcriptText.includes(q.toLowerCase()),
        );
        if (hasUngrounded) {
          dim.confidence = Math.max(0, dim.confidence - 0.3);
        }
      }
    }
  }

  let narrative: string | undefined;
  let recommendation: ScoreReport['recommendation'];

  if (config.synthesisTemplate) {
    try {
      const synthMessages: LLMMessage[] = [
        { role: 'system', content: config.synthesisTemplate },
        {
          role: 'user',
          content: JSON.stringify(
            {
              dimensions: dimensionResults.map((d) => ({
                id: d.id,
                score: d.score,
                weight: d.weight,
                evidence: d.evidenceQuotes,
              })),
            },
            null,
            2,
          ),
        },
      ];

      const synthResult = await callProvider(provider, synthMessages, {
        forceJson: true,
        maxTokens: 1024,
        tools: undefined,
        budgetLabel: 'scorer',
        signal: undefined,
      });

      const cleaned = synthResult.content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      if (typeof parsed.narrative === 'string') narrative = parsed.narrative;
      if (parsed.recommendation === 'hire' || parsed.recommendation === 'flag' || parsed.recommendation === 'pass') {
        recommendation = parsed.recommendation;
      }
    } catch (err) {
      console.error('[scorer] Synthesis failed:', err);
    }
  }

  return {
    dimensions: dimensionResults,
    narrative,
    recommendation,
  };
}
