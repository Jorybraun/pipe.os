/**
 * Scorer Agent — Multi-Turn Code Review Scoring Pipeline
 *
 * Calls Devstral (Mistral) to score a completed review session across 3 dimensions:
 * - Technical (30%) — bug detection, accuracy, design awareness
 * - Conversation (30%) — pushback handling, clarity, thread resolution
 * - Practice (25%) — prioritization, coverage, verdict quality
 * - Effectiveness (15%) — deterministic, no LLM
 *
 * Then synthesizes a narrative summary via a 4th LLM call.
 *
 * Same pattern as implementerAgent.ts: Devstral by default, Anthropic as fallback.
 * When MISTRAL_API_KEY is not set, returns mock responses for testing.
 */

import {
  TECHNICAL_SCORER_PROMPT,
  CONVERSATION_SCORER_PROMPT,
  PRACTICE_SCORER_PROMPT,
  SYNTHESIZER_PROMPT,
} from './scorerPrompts';
import { getMockScoreReport } from './mockResponses';

import {
  computeEffectiveness,
  weightedAvg,
  assignBand,
  countReviewerComments,
  TECH_WEIGHTS,
  CONV_WEIGHTS,
  PRACTICE_WEIGHTS,
  type PlantedBug,
  type DimensionScores,
  type EffectivenessScore,
} from './scoring';

// ─── Types ──────────────────────────────────────────────────────────────────

export type { PlantedBug, DimensionScores, EffectivenessScore };

export type LLMProvider = 'workers-ai' | 'mistral' | 'anthropic';

export interface ScorerInput {
  apiKey: string;
  provider?: LLMProvider;
  /** Workers AI binding — required when provider is 'workers-ai' */
  ai?: Ai;
  /** Full transcript JSON (rounds + verdict) */
  transcript: unknown;
  /** Ground truth planted bugs */
  groundTruth: PlantedBug[];
  /** Code diff for the scorer to verify claims against */
  diff?: string | null;
  /** PR context for the scorer */
  prTitle?: string | null;
  prDescription?: string | null;
  instructions?: string | null;
}

export interface TechnicalScore extends DimensionScores {
  bug_detection: number;
  root_cause_depth: number;
  technical_accuracy: number;
  design_awareness: number;
  fix_quality: number;
  false_positive_discipline: number;
  severity_calibration: number;
}

export interface ConversationScore extends DimensionScores {
  pushback_handling: number;
  explanation_clarity: number;
  guidance_effectiveness: number;
  clarifying_questions: number;
  fix_verification: number;
  thread_resolution: number;
  concession_quality: number;
  teaching_depth: number;
}

export interface PracticeScore extends DimensionScores {
  bug_prioritization: number;
  accuracy_discipline: number;
  comment_substance: number;
  verdict_quality: number;
  craft_observations: number;
  coverage: number;
  positive_recognition: number;
}

export interface ScoreReport {
  technical: { score: number; dimensions: TechnicalScore; bugs_found: number[]; bugs_missed: number[]; false_positive_count: number; summary: string };
  conversation: { score: number; dimensions: ConversationScore; defenses: number; caves: number; threads_resolved: number; threads_dangling: number; summary: string };
  practice: { score: number; dimensions: PracticeScore; summary: string };
  effectiveness: EffectivenessScore;
  overall: { score: number; band: 'strong' | 'adequate' | 'weak'; narrative: string; strengths: string[]; growth_areas: string[] };
}

// ─── LLM API calls (same as implementerAgent) ──────────────────────────────

interface MistralChoice {
  message: { role: string; content: string };
}

interface MistralResponse {
  choices: MistralChoice[];
}

interface AnthropicMessage {
  content: Array<{ type: string; text: string }>;
}

async function callMistral(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'devstral-latest',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[scorerAgent] Mistral API error', { status: response.status, body: errorText });
    throw new Error(`[scorerAgent] Mistral API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as MistralResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropic(apiKey: string, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[scorerAgent] Anthropic API error', { status: response.status, body: errorText });
    throw new Error(`[scorerAgent] Anthropic API ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as AnthropicMessage;
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const response = await ai.run(
    '@cf/qwen/qwen2.5-coder-32b-instruct',
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
    },
  );

  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) chunks.push(new TextDecoder().decode(result.value));
    }
    return chunks.join('').trim();
  }

  return (response as { response?: string }).response?.trim() ?? '';
}

/** Stored reference to AI binding, set by scoreReviewSession */
let _ai: Ai | undefined;

async function callLLM(apiKey: string, provider: LLMProvider, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  if (provider === 'workers-ai') {
    if (!_ai) throw new Error('[scorerAgent] Workers AI binding not available.');
    return callWorkersAI(_ai, systemPrompt, userMessage, maxTokens);
  }
  return provider === 'anthropic'
    ? callAnthropic(apiKey, systemPrompt, userMessage, maxTokens)
    : callMistral(apiKey, systemPrompt, userMessage, maxTokens);
}

// ─── JSON extraction ────────────────────────────────────────────────────────

function extractJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

// ─── User message builders ──────────────────────────────────────────────────

function buildTechnicalUserMessage(transcript: unknown, groundTruth: PlantedBug[], prContext: string, diff?: string | null): string {
  const diffSection = diff ? `## Code Diff\n${diff.slice(0, 50_000)}\n\n` : '';
  return `## PR Context
${prContext}

${diffSection}## Ground Truth — Planted Bugs
${JSON.stringify(groundTruth, null, 2)}

## Review Transcript
${JSON.stringify(transcript, null, 2)}

Score this review's technical quality. Return a JSON object with all 7 dimension scores (1-10), comment_evaluations, bugs_found, bugs_missed, false_positive_count, tradeoffs_identified, and a 2-3 sentence summary.`;
}

function buildConversationUserMessage(transcript: unknown): string {
  return `## Review Transcript
${JSON.stringify(transcript, null, 2)}

Score this review's conversation dynamics. Return a JSON object with all 8 dimension scores (1-10), thread_evaluations, defenses, caves_without_evaluating, threads_resolved, threads_dangling, and a summary.`;
}

function buildPracticeUserMessage(transcript: unknown, groundTruth: PlantedBug[], diff?: string | null): string {
  const diffSection = diff ? `## Code Diff\n${diff.slice(0, 50_000)}\n\n` : '';
  return `${diffSection}## Ground Truth — Planted Bugs
${JSON.stringify(groundTruth, null, 2)}

## Review Transcript
${JSON.stringify(transcript, null, 2)}

Score this review's practical quality. Return a JSON object with all 7 dimension scores (1-10), bugs_found_ids, bugs_missed_ids, false_positive_count, files_reviewed, files_in_pr, coverage_ratio, reviews_tests, nit_ratio, verdict_type, and a summary.`;
}

function buildSynthesizerUserMessage(tech: unknown, conv: unknown, practice: unknown, effectiveness: EffectivenessScore): string {
  return `## Technical Score (30%)
${JSON.stringify(tech, null, 2)}

## Conversation Score (30%)
${JSON.stringify(conv, null, 2)}

## Practice Score (25%)
${JSON.stringify(practice, null, 2)}

## Effectiveness Score (15%)
${JSON.stringify(effectiveness, null, 2)}

Write the hiring assessment narrative. Return JSON with: { "narrative": "...", "strengths": ["..."], "growth_areas": ["..."] }`;
}

// ─── Main scoring function ──────────────────────────────────────────────────

/**
 * Scores a completed review session by calling Devstral 4 times:
 * 1. Technical scorer
 * 2. Conversation scorer
 * 3. Practice scorer
 * 4. Synthesizer
 *
 * Plus one deterministic effectiveness computation.
 *
 * Throws if API key is missing or any LLM call fails.
 */
export async function scoreReviewSession(input: ScorerInput): Promise<ScoreReport> {
  const { apiKey, provider = 'workers-ai', ai, transcript, groundTruth, diff, prTitle, prDescription, instructions } = input;

  // Store AI binding for use in callLLM
  _ai = ai;

  // Return mock score report when API key is not configured (for testing)
  if (!apiKey && provider !== 'workers-ai') {
    console.log('[scorerAgent] No API key configured. Returning mock score report for testing.');
    return getMockScoreReport();
  }

  if (provider === 'workers-ai' && !ai) {
    throw new Error('[scorerAgent] Workers AI binding not available.');
  }
  if (provider !== 'workers-ai' && !apiKey) {
    throw new Error('[scorerAgent] No API key configured. Set MISTRAL_API_KEY or ANTHROPIC_API_KEY.');
  }

  const prContext = [
    prTitle != null ? `Title: ${prTitle}` : '',
    prDescription != null ? `Description: ${prDescription}` : '',
    instructions != null ? `Instructions: ${instructions}` : '',
  ].filter(Boolean).join('\n');

  // Run technical + conversation + practice in parallel
  const [techRaw, convRaw, practiceRaw] = await Promise.all([
    callLLM(apiKey, provider, TECHNICAL_SCORER_PROMPT, buildTechnicalUserMessage(transcript, groundTruth, prContext, diff), 3000),
    callLLM(apiKey, provider, CONVERSATION_SCORER_PROMPT, buildConversationUserMessage(transcript), 2048),
    callLLM(apiKey, provider, PRACTICE_SCORER_PROMPT, buildPracticeUserMessage(transcript, groundTruth, diff), 2048),
  ]);

  // Parse scorer outputs
  const techResult = extractJson<Record<string, unknown>>(techRaw);
  const convResult = extractJson<Record<string, unknown>>(convRaw);
  const practiceResult = extractJson<Record<string, unknown>>(practiceRaw);

  // Extract dimension scores
  const techDimensions: TechnicalScore = {
    bug_detection: Number(techResult.bug_detection) || 5,
    root_cause_depth: Number(techResult.root_cause_depth) || 5,
    technical_accuracy: Number(techResult.technical_accuracy) || 5,
    design_awareness: Number(techResult.design_awareness) || 5,
    fix_quality: Number(techResult.fix_quality) || 5,
    false_positive_discipline: Number(techResult.false_positive_discipline) || 5,
    severity_calibration: Number(techResult.severity_calibration) || 5,
  };

  const convDimensions: ConversationScore = {
    pushback_handling: Number(convResult.pushback_handling) || 5,
    explanation_clarity: Number(convResult.explanation_clarity) || 5,
    guidance_effectiveness: Number(convResult.guidance_effectiveness) || 5,
    clarifying_questions: Number(convResult.clarifying_questions) || 5,
    fix_verification: Number(convResult.fix_verification) || 5,
    thread_resolution: Number(convResult.thread_resolution) || 5,
    concession_quality: Number(convResult.concession_quality) || 5,
    teaching_depth: Number(convResult.teaching_depth) || 5,
  };

  const practiceDimensions: PracticeScore = {
    bug_prioritization: Number(practiceResult.bug_prioritization) || 5,
    accuracy_discipline: Number(practiceResult.accuracy_discipline) || 5,
    comment_substance: Number(practiceResult.comment_substance) || 5,
    verdict_quality: Number(practiceResult.verdict_quality) || 5,
    craft_observations: Number(practiceResult.craft_observations) || 5,
    coverage: Number(practiceResult.coverage) || 5,
    positive_recognition: Number(practiceResult.positive_recognition) || 5,
  };

  // Weighted averages (scaled 0-100)
  const techScore = weightedAvg(techDimensions, TECH_WEIGHTS);
  const convScore = weightedAvg(convDimensions, CONV_WEIGHTS);
  const practiceScore = weightedAvg(practiceDimensions, PRACTICE_WEIGHTS);

  // Effectiveness (deterministic)
  const bugsFound = Array.isArray(techResult.bugs_found) ? (techResult.bugs_found as number[]) : [];
  const bugsMissed = Array.isArray(techResult.bugs_missed) ? (techResult.bugs_missed as number[]) : [];
  const falsePositiveCount = Number(techResult.false_positive_count) || 0;
  const totalComments = countReviewerComments(transcript);
  const effectiveness = computeEffectiveness(bugsFound, bugsMissed, groundTruth, falsePositiveCount, totalComments);

  // Overall composite
  const overallScore = Math.round(
    techScore * 0.30 + convScore * 0.30 + practiceScore * 0.25 + effectiveness.score * 0.15,
  );
  const band = assignBand(overallScore);

  // Synthesizer call
  const synthRaw = await callLLM(
    apiKey, provider, SYNTHESIZER_PROMPT,
    buildSynthesizerUserMessage(
      { score: techScore, dimensions: techDimensions, summary: techResult.summary },
      { score: convScore, dimensions: convDimensions, summary: convResult.summary },
      { score: practiceScore, dimensions: practiceDimensions, summary: practiceResult.summary },
      effectiveness,
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
    console.error('[scorerAgent] Failed to parse synthesizer output, using fallback narrative');
  }

  return {
    technical: {
      score: techScore,
      dimensions: techDimensions,
      bugs_found: bugsFound,
      bugs_missed: bugsMissed,
      false_positive_count: falsePositiveCount,
      summary: typeof techResult.summary === 'string' ? techResult.summary : '',
    },
    conversation: {
      score: convScore,
      dimensions: convDimensions,
      defenses: Number(convResult.defenses) || 0,
      caves: Number(convResult.caves_without_evaluating) || 0,
      threads_resolved: Number(convResult.threads_resolved) || 0,
      threads_dangling: Number(convResult.threads_dangling) || 0,
      summary: typeof convResult.summary === 'string' ? convResult.summary : '',
    },
    practice: {
      score: practiceScore,
      dimensions: practiceDimensions,
      summary: typeof practiceResult.summary === 'string' ? practiceResult.summary : '',
    },
    effectiveness,
    overall: {
      score: overallScore,
      band,
      narrative,
      strengths,
      growth_areas: growthAreas,
    },
  };
}
