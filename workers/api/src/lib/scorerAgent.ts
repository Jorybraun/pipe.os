/**
 * Scorer Agent — 6-Dimension BARS Code Review Scoring Pipeline
 *
 * Calls Devstral (Mistral) to score a completed review session across 6 BARS dimensions:
 *
 * Scorer A (needs ground truth):
 *   1. Issue Identification Depth (20%)
 *   3. Prioritization Accuracy (15%)
 *   5. Revision Evaluation (20%)
 *
 * Scorer B (no ground truth — communication quality):
 *   2. Reasoning & Explanation Quality (20%)
 *   4. Question Formation (15%)
 *   6. AI Direction (10%, seniority-adjusted)
 *
 * Effectiveness (15% of composite): deterministic bug-matching, no LLM.
 * Synthesizer: narrative summary for hiring managers.
 *
 * Same pattern as implementerAgent.ts: Devstral by default, Anthropic as fallback.
 * When MISTRAL_API_KEY is not set, returns mock responses for testing.
 */

import {
  SCORER_A_PROMPT,
  SCORER_B_PROMPT,
  SYNTHESIZER_PROMPT,
} from './scorerPrompts';
import { getMockScoreReport } from './mockResponses';
import { type DimensionId } from './scorerRubric';

import {
  computeEffectiveness,
  computeOverallScore,
  assignBand,
  countReviewerComments,
  type PlantedBug,
  type BarsDimensionScores,
  type EffectivenessScore,
} from './scoring';

// ─── Types ──────────────────────────────────────────────────────────────────

export type { PlantedBug, BarsDimensionScores, EffectivenessScore };

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
  /** Candidate seniority level — affects AI direction weight */
  level?: 'junior' | 'mid' | 'senior';
  /**
   * Optional dispositional weights from the Role Context Document (ADR-036 §3).
   * Keys may be trait names (`pragmatism`, `rigor`, `communication`) or direct
   * dimension IDs. Values are clamped to [0.5, 1.5] per dimension before being
   * applied to the seniority-adjusted base weights — sign-preservation is
   * invariant.
   */
  dispositionalWeights?: Record<string, number>;
}

/** Evidence attached to each scorer's output */
export interface ScorerEvidence {
  issue_identification_evidence?: string;
  prioritization_evidence?: string;
  revision_evaluation_evidence?: string;
  reasoning_quality_evidence?: string;
  question_formation_evidence?: string;
  ai_direction_evidence?: string;
}

/** Metrics extracted by Scorer A from ground truth comparison */
export interface ScorerAMetrics {
  bugs_found: number[];
  bugs_missed: number[];
  bugs_found_pct: number;
  false_positive_count: number;
  true_finding_count: number;
  approved_with_unfound_critical: boolean;
  cave_ratio: number;
  fix_verifications: number;
}

export interface ScoreReport {
  /** All 6 BARS dimension scores (1-5 each) */
  dimensions: BarsDimensionScores;
  /** Evidence supporting each dimension score */
  evidence: ScorerEvidence;
  /** Metrics from ground truth comparison */
  metrics: ScorerAMetrics;
  /** Deterministic effectiveness score */
  effectiveness: EffectivenessScore;
  /** Overall composite and narrative */
  overall: {
    score: number;
    band: 'strong' | 'adequate' | 'weak';
    narrative: string;
    strengths: string[];
    growth_areas: string[];
  };
  /** Scorer summaries */
  scorer_a_summary: string;
  scorer_b_summary: string;
}

// ─── Legacy types (kept for backward compatibility during migration) ────────

export interface DimensionScores {
  [key: string]: number;
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

  const raw = (response as { response?: unknown }).response;
  if (typeof raw === 'string') return raw.trim();
  if (raw != null) {
    console.warn('[scorerAgent] Workers AI response.response is not a string:', typeof raw);
    return String(raw).trim();
  }
  return '';
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

function buildScorerAUserMessage(
  transcript: unknown,
  groundTruth: PlantedBug[],
  prContext: string,
  diff?: string | null,
): string {
  const diffSection = diff ? `## Code Diff\n${diff.slice(0, 50_000)}\n\n` : '';
  return `## PR Context
${prContext}

${diffSection}## Ground Truth — Planted Bugs
${JSON.stringify(groundTruth, null, 2)}

## Review Transcript
${JSON.stringify(transcript, null, 2)}

Score this review on the 3 ground-truth dimensions (issue_identification, prioritization, revision_evaluation). Each score 1-5. Return a JSON object with all dimension scores, evidence, metrics, and a summary.`;
}

function buildScorerBUserMessage(transcript: unknown): string {
  return `## Review Transcript
${JSON.stringify(transcript, null, 2)}

Score this review on the 3 communication dimensions (reasoning_quality, question_formation, ai_direction). Each score 1-5. Return a JSON object with all dimension scores, evidence quotes, and a summary.`;
}

function buildSynthesizerUserMessage(
  dimensions: BarsDimensionScores,
  effectiveness: EffectivenessScore,
  scorerASummary: string,
  scorerBSummary: string,
): string {
  return `## Dimension Scores (1-5 each)
${JSON.stringify(dimensions, null, 2)}

## Effectiveness Score (0-100)
${JSON.stringify(effectiveness, null, 2)}

## Scorer A Summary (ground-truth dimensions)
${scorerASummary}

## Scorer B Summary (communication dimensions)
${scorerBSummary}

Write the hiring assessment narrative. Return JSON with: { "narrative": "...", "strengths": ["..."], "growth_areas": ["..."] }`;
}

// ─── Main scoring function ──────────────────────────────────────────────────

/**
 * Scores a completed review session using the 6-dimension BARS rubric.
 *
 * Pipeline:
 * 1. Scorer A (ground truth) + Scorer B (communication) — in parallel
 * 2. Deterministic effectiveness computation
 * 3. Overall composite = BARS × 0.85 + Effectiveness × 0.15
 * 4. Synthesizer for narrative
 */
export async function scoreReviewSession(input: ScorerInput): Promise<ScoreReport> {
  const {
    apiKey, provider = 'workers-ai', ai, transcript, groundTruth,
    diff, prTitle, prDescription, instructions, level = 'mid',
    dispositionalWeights,
  } = input;

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

  // Run Scorer A + Scorer B in parallel
  const [scorerARaw, scorerBRaw] = await Promise.all([
    callLLM(apiKey, provider, SCORER_A_PROMPT, buildScorerAUserMessage(transcript, groundTruth, prContext, diff), 3000),
    callLLM(apiKey, provider, SCORER_B_PROMPT, buildScorerBUserMessage(transcript), 2048),
  ]);

  // Parse scorer outputs
  const scorerA = extractJson<Record<string, unknown>>(scorerARaw);
  const scorerB = extractJson<Record<string, unknown>>(scorerBRaw);

  // Extract dimension scores (1-5, default to 3 = midpoint)
  const dimensions: BarsDimensionScores = {
    issue_identification: clampScore(Number(scorerA.issue_identification) || 3),
    prioritization: clampScore(Number(scorerA.prioritization) || 3),
    revision_evaluation: clampScore(Number(scorerA.revision_evaluation) || 3),
    reasoning_quality: clampScore(Number(scorerB.reasoning_quality) || 3),
    question_formation: clampScore(Number(scorerB.question_formation) || 3),
    ai_direction: clampScore(Number(scorerB.ai_direction) || 3),
  };

  // Extract evidence
  const scorerAEvidence = (scorerA.evidence ?? {}) as Record<string, string>;
  const scorerBEvidence = (scorerB.evidence ?? {}) as Record<string, string>;
  const evidence: ScorerEvidence = {
    issue_identification_evidence: scorerAEvidence.issue_identification_evidence,
    prioritization_evidence: scorerAEvidence.prioritization_evidence,
    revision_evaluation_evidence: scorerAEvidence.revision_evaluation_evidence,
    reasoning_quality_evidence: scorerBEvidence.reasoning_quality_evidence,
    question_formation_evidence: scorerBEvidence.question_formation_evidence,
    ai_direction_evidence: scorerBEvidence.ai_direction_evidence,
  };

  // Extract metrics from Scorer A
  const metricsRaw = (scorerA.metrics ?? {}) as Record<string, unknown>;
  const metrics: ScorerAMetrics = {
    bugs_found: Array.isArray(metricsRaw.bugs_found) ? (metricsRaw.bugs_found as number[]) : [],
    bugs_missed: Array.isArray(metricsRaw.bugs_missed) ? (metricsRaw.bugs_missed as number[]) : [],
    bugs_found_pct: Number(metricsRaw.bugs_found_pct) || 0,
    false_positive_count: Number(metricsRaw.false_positive_count) || 0,
    true_finding_count: Number(metricsRaw.true_finding_count) || 0,
    approved_with_unfound_critical: Boolean(metricsRaw.approved_with_unfound_critical),
    cave_ratio: Number(metricsRaw.cave_ratio) || 0,
    fix_verifications: Number(metricsRaw.fix_verifications) || 0,
  };

  // Effectiveness (deterministic)
  const totalComments = countReviewerComments(transcript);
  const effectiveness = computeEffectiveness(
    metrics.bugs_found, metrics.bugs_missed, groundTruth,
    metrics.false_positive_count, totalComments,
  );

  // Overall composite (with optional dispositional weight overlay from RCD)
  const overallScore = computeOverallScore(dimensions, effectiveness, level, dispositionalWeights);
  const band = assignBand(overallScore);

  // Synthesizer call
  const scorerASummary = typeof scorerA.summary === 'string' ? scorerA.summary : '';
  const scorerBSummary = typeof scorerB.summary === 'string' ? scorerB.summary : '';

  const synthRaw = await callLLM(
    apiKey, provider, SYNTHESIZER_PROMPT,
    buildSynthesizerUserMessage(dimensions, effectiveness, scorerASummary, scorerBSummary),
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
    dimensions,
    evidence,
    metrics,
    effectiveness,
    overall: {
      score: overallScore,
      band,
      narrative,
      strengths,
      growth_areas: growthAreas,
    },
    scorer_a_summary: scorerASummary,
    scorer_b_summary: scorerBSummary,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a score to the valid 1-5 range. */
function clampScore(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score)));
}
