/**
 * Comprehension Scorer — Blind Comprehension Review Scoring Pipeline
 *
 * Scores a completed comprehension review session across 4 dimensions:
 * - Question Quality (30%) — strategic questioning, depth progression
 * - Comprehension (30%) — insight coverage, mental model accuracy
 * - Decision Quality (25%) — verdict alignment, rationale quality
 * - Efficiency (15%) — deterministic, no LLM
 *
 * Then synthesizes a narrative summary via a 4th LLM call.
 *
 * Same provider pattern as scorerAgent.ts.
 */

import {
  QUESTION_QUALITY_SCORER_PROMPT,
  COMPREHENSION_SCORER_PROMPT,
  DECISION_QUALITY_SCORER_PROMPT,
  COMPREHENSION_SYNTHESIZER_PROMPT,
} from './comprehensionScorerPrompts';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LLMProvider = 'workers-ai' | 'google-ai';

export class ComprehensionScorerUnavailableError extends Error {
  readonly provider: LLMProvider;

  constructor(provider: LLMProvider, reason: string) {
    super(reason);
    this.name = 'ComprehensionScorerUnavailableError';
    this.provider = provider;
  }
}

export interface KeyInsight {
  id: number;
  category: string;
  insight: string;
  depth: string;
  importance: string;
}

export interface ComprehensionGroundTruth {
  mode: 'comprehension';
  keyInsights: KeyInsight[];
  idealVerdict: string;
  idealRationale: string;
}

export interface ComprehensionScorerInput {
  apiKey: string;
  provider?: LLMProvider;
  ai?: Ai;
  transcript: unknown;
  groundTruth: ComprehensionGroundTruth;
  prTitle?: string | null;
  prDescription?: string | null;
  instructions?: string | null;
}

export interface ComprehensionScoreReport {
  question_quality: { score: number; dimensions: Record<string, number>; summary: string };
  comprehension: { score: number; dimensions: Record<string, number>; insights_discovered: number[]; insights_missed: number[]; summary: string };
  decision_quality: { score: number; dimensions: Record<string, number>; summary: string };
  efficiency: { score: number; questions_to_insight_ratio: number; round_efficiency: number; redundancy_score: number };
  overall: { score: number; band: 'strong' | 'adequate' | 'weak'; narrative: string; strengths: string[]; growth_areas: string[] };
}

// ─── LLM calls (same pattern as scorerAgent) ───────────────────────────────

let _ai: Ai | undefined;

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const response = await ai.run('@cf/qwen/qwen2.5-coder-32b-instruct', {
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
    max_tokens: maxTokens,
  });
  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const chunks: string[] = [];
    let done = false;
    while (!done) { const r = await reader.read(); done = r.done; if (r.value) chunks.push(new TextDecoder().decode(r.value)); }
    return chunks.join('').trim();
  }
  const raw = (response as { response?: unknown }).response;
  if (typeof raw === 'string') return raw.trim();
  if (raw != null) return String(raw).trim();
  return '';
}

async function callGoogleAI(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const model = 'gemma-4-31b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[comprehensionScorer] Google AI error', { status: response.status, body: errorText });
    throw new Error(`[comprehensionScorer] Google AI ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
}

async function callLLM(apiKey: string, provider: LLMProvider, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  if (provider === 'workers-ai') {
    if (!_ai) throw new Error('[comprehensionScorer] Workers AI binding not available.');
    return callWorkersAI(_ai, systemPrompt, userMessage, maxTokens);
  }
  if (provider === 'google-ai') return callGoogleAI(apiKey, systemPrompt, userMessage, maxTokens);
  throw new Error(`[comprehensionScorer] Unknown provider: ${provider}`);
}

// ─── JSON extraction ────────────────────────────────────────────────────────

function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

// ─── Dimension weights ──────────────────────────────────────────────────────

const QQ_WEIGHTS: Record<string, number> = {
  strategic_questioning: 0.25, depth_progression: 0.20, specificity: 0.20,
  coverage: 0.15, efficiency: 0.10, probing_skill: 0.10,
};

const COMP_WEIGHTS: Record<string, number> = {
  insight_coverage: 0.25, mental_model_accuracy: 0.25, context_synthesis: 0.20,
  misconception_avoidance: 0.15, depth_of_understanding: 0.15,
};

const DQ_WEIGHTS: Record<string, number> = {
  verdict_alignment: 0.25, rationale_quality: 0.25, tradeoff_awareness: 0.20,
  risk_identification: 0.15, proportionality: 0.15,
};

function weightedAvg(dimensions: Record<string, number>, weights: Record<string, number>): number {
  let sum = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const val = dimensions[key];
    if (val === undefined) {
      throw new Error(`Missing weighted score dimension: ${key}`);
    }
    sum += val * weight;
    totalWeight += weight;
  }
  return Math.round((sum / totalWeight) * 10);
}

function requireDimensionScores(
  provider: LLMProvider,
  scorerName: string,
  result: Record<string, unknown>,
  weights: Record<string, number>,
): Record<string, number> {
  const dimensions: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    const raw = result[key];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      throw new ComprehensionScorerUnavailableError(
        provider,
        `Comprehension scorer ${scorerName} did not return a valid score for ${key}.`,
      );
    }
    dimensions[key] = value;
  }
  return dimensions;
}

function assignBand(score: number): 'strong' | 'adequate' | 'weak' {
  if (score >= 75) return 'strong';
  if (score >= 45) return 'adequate';
  return 'weak';
}

// ─── Deterministic efficiency scorer ────────────────────────────────────────

function computeEfficiency(
  transcript: unknown,
  insightsDiscovered: number[],
  totalInsights: number,
): { score: number; questions_to_insight_ratio: number; round_efficiency: number; redundancy_score: number } {
  const t = transcript as { exchanges?: unknown[] };
  const exchanges = Array.isArray(t?.exchanges) ? t.exchanges : [];
  const totalQuestions = exchanges.length;

  if (totalQuestions === 0) {
    return { score: 0, questions_to_insight_ratio: 0, round_efficiency: 0, redundancy_score: 100 };
  }

  // Insight ratio: insights found / questions asked, scaled 0-100
  const rawRatio = totalInsights > 0 ? insightsDiscovered.length / totalInsights : 0;
  const questionsToInsightRatio = totalQuestions > 0 ? insightsDiscovered.length / totalQuestions : 0;
  const ratioScore = Math.min(100, Math.round(rawRatio * 100));

  // Round efficiency: reward finding insights early (first half of rounds)
  const halfwayPoint = Math.ceil(totalQuestions / 2);
  const earlyInsights = insightsDiscovered.length; // simplified: we don't track when each was discovered
  const roundEfficiency = Math.min(100, Math.round((earlyInsights / Math.max(1, totalInsights)) * 100));

  // Redundancy: penalize if many questions (heuristic: >8 questions for <4 insights is redundant)
  const redundancyScore = totalQuestions <= 4 ? 100
    : totalQuestions <= 6 ? 85
    : totalQuestions <= 8 ? 70
    : 50;

  const score = Math.round(ratioScore * 0.40 + roundEfficiency * 0.30 + redundancyScore * 0.30);

  return { score, questions_to_insight_ratio: questionsToInsightRatio, round_efficiency: roundEfficiency, redundancy_score: redundancyScore };
}

// ─── User message builders ──────────────────────────────────────────────────

function buildQuestionQualityUserMessage(transcript: unknown, prContext: string): string {
  return `## PR Context\n${prContext}\n\n## Comprehension Review Transcript\n${JSON.stringify(transcript, null, 2)}\n\nScore this candidate's question quality. Return the JSON object as instructed.`;
}

function buildComprehensionUserMessage(transcript: unknown, groundTruth: ComprehensionGroundTruth, prContext: string): string {
  return `## PR Context\n${prContext}\n\n## Key Insights (Ground Truth)\n${JSON.stringify(groundTruth.keyInsights, null, 2)}\n\n## Comprehension Review Transcript\n${JSON.stringify(transcript, null, 2)}\n\nScore this candidate's comprehension depth. Return the JSON object as instructed.`;
}

function buildDecisionQualityUserMessage(transcript: unknown, groundTruth: ComprehensionGroundTruth): string {
  return `## Ideal Verdict: ${groundTruth.idealVerdict}\n## Ideal Rationale: ${groundTruth.idealRationale}\n\n## Comprehension Review Transcript (includes candidate's verdict and rationale)\n${JSON.stringify(transcript, null, 2)}\n\nScore this candidate's decision quality. Return the JSON object as instructed.`;
}

function buildSynthesizerUserMessage(
  qq: unknown, comp: unknown, dq: unknown,
  eff: { score: number; questions_to_insight_ratio: number; round_efficiency: number; redundancy_score: number },
): string {
  return `## Question Quality Score (30%)\n${JSON.stringify(qq, null, 2)}\n\n## Comprehension Score (30%)\n${JSON.stringify(comp, null, 2)}\n\n## Decision Quality Score (25%)\n${JSON.stringify(dq, null, 2)}\n\n## Efficiency Score (15%)\n${JSON.stringify(eff, null, 2)}\n\nWrite the hiring assessment narrative. Return the JSON object as instructed.`;
}

// ─── Main scoring function ──────────────────────────────────────────────────

export async function scoreComprehensionSession(input: ComprehensionScorerInput): Promise<ComprehensionScoreReport> {
  const { apiKey, provider = 'workers-ai', ai, transcript, groundTruth, prTitle, prDescription, instructions } = input;

  _ai = ai;

  if (!apiKey && provider === 'google-ai') {
    throw new ComprehensionScorerUnavailableError(
      provider,
      'Google AI API key is not configured for comprehension scoring.',
    );
  }

  if (provider === 'workers-ai' && !ai) {
    throw new ComprehensionScorerUnavailableError(
      provider,
      'Workers AI binding is not available for comprehension scoring.',
    );
  }

  const prContext = [
    prTitle != null ? `Title: ${prTitle}` : '',
    prDescription != null ? `Description: ${prDescription}` : '',
    instructions != null ? `Instructions: ${instructions}` : '',
  ].filter(Boolean).join('\n');

  // Run 3 LLM scorers in parallel
  const [qqRaw, compRaw, dqRaw] = await Promise.all([
    callLLM(apiKey, provider, QUESTION_QUALITY_SCORER_PROMPT, buildQuestionQualityUserMessage(transcript, prContext), 2048),
    callLLM(apiKey, provider, COMPREHENSION_SCORER_PROMPT, buildComprehensionUserMessage(transcript, groundTruth, prContext), 3000),
    callLLM(apiKey, provider, DECISION_QUALITY_SCORER_PROMPT, buildDecisionQualityUserMessage(transcript, groundTruth), 2048),
  ]);

  // Parse scorer outputs
  let qqResult: Record<string, unknown>;
  let compResult: Record<string, unknown>;
  let dqResult: Record<string, unknown>;
  try {
    qqResult = extractJson<Record<string, unknown>>(qqRaw);
    compResult = extractJson<Record<string, unknown>>(compRaw);
    dqResult = extractJson<Record<string, unknown>>(dqRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ComprehensionScorerUnavailableError(
      provider,
      `Comprehension scorer provider returned invalid JSON: ${message}`,
    );
  }

  // Extract dimensions
  const qqDimensions = requireDimensionScores(provider, 'question_quality', qqResult, QQ_WEIGHTS);
  const compDimensions = requireDimensionScores(provider, 'comprehension', compResult, COMP_WEIGHTS);
  const dqDimensions = requireDimensionScores(provider, 'decision_quality', dqResult, DQ_WEIGHTS);

  // Weighted averages (scaled 0-100)
  const qqScore = weightedAvg(qqDimensions, QQ_WEIGHTS);
  const compScore = weightedAvg(compDimensions, COMP_WEIGHTS);
  const dqScore = weightedAvg(dqDimensions, DQ_WEIGHTS);

  // Insights discovered/missed
  const insightsDiscovered = Array.isArray(compResult.insights_discovered) ? (compResult.insights_discovered as number[]) : [];
  const insightsMissed = Array.isArray(compResult.insights_missed) ? (compResult.insights_missed as number[]) : [];

  // Deterministic efficiency
  const efficiency = computeEfficiency(transcript, insightsDiscovered, groundTruth.keyInsights.length);

  // Overall composite
  const overallScore = Math.round(
    qqScore * 0.30 + compScore * 0.30 + dqScore * 0.25 + efficiency.score * 0.15,
  );
  const band = assignBand(overallScore);

  // Synthesizer
  const synthRaw = await callLLM(
    apiKey, provider, COMPREHENSION_SYNTHESIZER_PROMPT,
    buildSynthesizerUserMessage(
      { score: qqScore, dimensions: qqDimensions, summary: qqResult.summary },
      { score: compScore, dimensions: compDimensions, insights_discovered: insightsDiscovered, insights_missed: insightsMissed, summary: compResult.summary },
      { score: dqScore, dimensions: dqDimensions, summary: dqResult.summary },
      efficiency,
    ),
    1024,
  );

  let narrative = `Overall score: ${overallScore}/100 (${band})`;
  let strengths: string[] = [];
  let growthAreas: string[] = [];

  try {
    const synthResult = extractJson<Record<string, unknown>>(synthRaw);
    if (typeof synthResult.narrative === 'string') narrative = synthResult.narrative;
    if (Array.isArray(synthResult.strengths)) strengths = synthResult.strengths as string[];
    if (Array.isArray(synthResult.growth_areas)) growthAreas = synthResult.growth_areas as string[];
  } catch {
    console.error('[comprehensionScorer] Failed to parse synthesizer output, using fallback narrative');
  }

  return {
    question_quality: {
      score: qqScore,
      dimensions: qqDimensions,
      summary: typeof qqResult.summary === 'string' ? qqResult.summary : '',
    },
    comprehension: {
      score: compScore,
      dimensions: compDimensions,
      insights_discovered: insightsDiscovered,
      insights_missed: insightsMissed,
      summary: typeof compResult.summary === 'string' ? compResult.summary : '',
    },
    decision_quality: {
      score: dqScore,
      dimensions: dqDimensions,
      summary: typeof dqResult.summary === 'string' ? dqResult.summary : '',
    },
    efficiency,
    overall: {
      score: overallScore,
      band,
      narrative,
      strengths,
      growth_areas: growthAreas,
    },
  };
}
