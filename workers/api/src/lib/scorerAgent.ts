/**
 * Scorer Agent — 6-Dimension BARS Code Review Scoring Pipeline
 *
 * Scores a completed review session across 6 BARS dimensions:
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
 */

import {
  SCORER_A_PROMPT,
  SCORER_B_PROMPT,
  SYNTHESIZER_PROMPT,
} from './scorerPrompts';
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

export type LLMProvider = 'workers-ai' | 'vertex-ai' | 'google-ai' | 'kimi';

export interface ScorerInput {
  apiKey: string;
  provider?: LLMProvider;
  kimiBaseUrl?: string;
  kimiModel?: string;
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

// ─── LLM API calls ─────────────────────────────────────────────────────────

/**
 * Vertex AI via OpenAI-compatible chat/completions endpoint.
 * Uses Gemma 4 26B MaaS with Bearer token auth.
 * Endpoint: https://aiplatform.googleapis.com/v1/projects/{projectId}/locations/global/endpoints/openapi/chat/completions
 */
async function callVertexAI(
  accessToken: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
): Promise<string> {
  // Project ID is required for this endpoint
  const projectId = 'gen-lang-client-0669733210';
  const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      model: 'google/gemma-4-26b-a4b-it-maas',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[scorerAgent] Vertex AI error', { status: response.status, body: errorText });
    throw new Error(`[scorerAgent] Vertex AI ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * Google AI (Gemma) via generativelanguage.googleapis.com — API key auth.
 * Different from Vertex AI. Uses Gemma 3 27B which doesn't support systemInstruction,
 * so we merge the system prompt into the user message.
 */
async function callGoogleAI(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
): Promise<string> {
  const model = 'gemma-4-31b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemma doesn't support systemInstruction — merge into user message
  const combinedMessage = `${systemPrompt}\n\n---\n\n${userMessage}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: combinedMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[scorerAgent] Google AI error', { status: response.status, body: errorText });
    throw new Error(`[scorerAgent] Google AI ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('').trim();
}

/**
 * Workers AI scorer model — ADR-036 Phase 3 provisional pick.
 *
 * Must be a different family than the implementer (Qwen 2.5-Coder 32B) for
 * independence — scoring is a distinct judgment pass, and a same-family pair
 * bakes in shared biases (same rule as the ADR-032 implementer/classifier
 * separation). Gemma 4 26B is the strongest generalist-evaluation Workers AI
 * model already in the Pipe stack and gives us family diversity from Qwen.
 *
 * Provisional default pending the κ calibration harness: once we measure
 * Gemma vs Devstral vs Sonnet κ on a 30–50 fixture set, we keep whichever
 * model clears κ ≥ 0.75 cheapest. See ADR-032 scorer calibration.
 */
// Qwen 2.5 Coder 32B — trying this instead of Gemma 4 26B which is unreliable
const SCORER_WORKERS_AI_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const SCORER_WORKERS_AI_FALLBACK = '@cf/qwen/qwen3-30b-a3b-fp8';

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  console.log('[callWorkersAI] calling ai.run with model:', SCORER_WORKERS_AI_MODEL, 'prompt lengths:', systemPrompt.length, userMessage.length);

  let response: unknown;
  let modelUsed = SCORER_WORKERS_AI_MODEL;

  try {
    response = await ai.run(
      SCORER_WORKERS_AI_MODEL as Parameters<typeof ai.run>[0],
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
      },
    );
  } catch (err) {
    // Fallback to smaller model on 3050 (max retries exhausted) or similar errors
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('3050') || errMsg.includes('Max retries')) {
      console.warn('[callWorkersAI] Primary model failed, falling back to:', SCORER_WORKERS_AI_FALLBACK);
      modelUsed = SCORER_WORKERS_AI_FALLBACK;
      try {
        response = await ai.run(
          SCORER_WORKERS_AI_FALLBACK as Parameters<typeof ai.run>[0],
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            max_tokens: maxTokens,
          },
        );
      } catch (fallbackErr) {
        console.error('[callWorkersAI] Fallback model also failed:', fallbackErr);
        throw fallbackErr;
      }
    } else {
      console.error('[callWorkersAI] ai.run threw:', err);
      console.error('[callWorkersAI] error type:', typeof err);
      console.error('[callWorkersAI] error constructor:', (err as object)?.constructor?.name);
      if (err instanceof Error) {
        console.error('[callWorkersAI] error.message:', err.message);
        console.error('[callWorkersAI] error.cause:', (err as Error & { cause?: unknown }).cause);
      }
      throw err;
    }
  }

  console.log('[callWorkersAI] using model:', modelUsed);

  // Debug: log the raw response shape
  console.log('[callWorkersAI] response type:', typeof response);
  console.log('[callWorkersAI] response instanceof ReadableStream:', response instanceof ReadableStream);
  console.log('[callWorkersAI] response keys:', response ? Object.keys(response as object) : 'null/undefined');
  console.log('[callWorkersAI] response preview:', JSON.stringify(response)?.slice(0, 500));

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

/**
 * Kimi API via OpenAI-compatible chat/completions endpoint.
 * Uses kimi-for-coding (or KIMI_SCORER_MODEL override) with Bearer token auth.
 * Endpoint: https://api.kimi.com/coding/v1/chat/completions
 */
async function callKimi(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
  baseUrl = 'https://api.kimi.com/coding/v1',
  model = 'kimi-for-coding',
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Kilo-Code/1.0.0',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[scorerAgent] Kimi error', { status: response.status, body: errorText });
    throw new Error(`[scorerAgent] Kimi ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callLLM(
  apiKey: string,
  provider: LLMProvider,
  ai: Ai | undefined,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048,
  options: { kimiBaseUrl?: string; kimiModel?: string } = {},
): Promise<string> {
  if (provider === 'workers-ai') {
    if (!ai) throw new Error('[scorerAgent] Workers AI binding not available.');
    return callWorkersAI(ai, systemPrompt, userMessage, maxTokens);
  }
  if (provider === 'vertex-ai') {
    return callVertexAI(apiKey, systemPrompt, userMessage, maxTokens);
  }
  if (provider === 'google-ai') {
    return callGoogleAI(apiKey, systemPrompt, userMessage, maxTokens);
  }
  if (provider === 'kimi') {
    return callKimi(apiKey, systemPrompt, userMessage, maxTokens, options.kimiBaseUrl, options.kimiModel);
  }
  throw new Error(`[scorerAgent] Unknown provider: ${provider}`);
}

// ─── JSON extraction ────────────────────────────────────────────────────────

function extractJson<T>(raw: string): T {
  // Strip markdown fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Some models emit trailing text after the JSON (explanations, repeated blocks).
  // Find the outermost JSON object or array by matching braces/brackets.
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start === -1) {
    throw new Error(`[extractJson] No JSON object or array found in response. Raw: ${cleaned.slice(0, 200)}`);
  }

  const opener = cleaned[start] as '{' | '[';
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"' && !inString) {
      inString = true;
      continue;
    }
    if (ch === '"' && inString) {
      inString = false;
      continue;
    }
    if (inString) continue;
    if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(`[extractJson] Unmatched ${opener} in response. Raw: ${cleaned.slice(0, 200)}`);
  }

  const jsonText = cleaned.slice(start, end + 1);
  return JSON.parse(jsonText) as T;
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
    apiKey, provider = 'workers-ai', kimiBaseUrl, kimiModel, ai, transcript, groundTruth,
    diff, prTitle, prDescription, instructions, level = 'mid',
    dispositionalWeights,
  } = input;

  if (provider === 'workers-ai' && !ai) {
    throw new Error('[scorerAgent] Workers AI binding not available.');
  }
  if ((provider === 'google-ai' || provider === 'vertex-ai' || provider === 'kimi') && !apiKey) {
    throw new Error('[scorerAgent] No API key configured. Set GOOGLE_AI_API_KEY, VERTEX_AI_ACCESS_TOKEN, or KIMI_API_KEY.');
  }

  const prContext = [
    prTitle != null ? `Title: ${prTitle}` : '',
    prDescription != null ? `Description: ${prDescription}` : '',
    instructions != null ? `Instructions: ${instructions}` : '',
  ].filter(Boolean).join('\n');

  // Run Scorer A + Scorer B in parallel
  const [scorerARaw, scorerBRaw] = await Promise.all([
    callLLM(apiKey, provider, ai, SCORER_A_PROMPT, buildScorerAUserMessage(transcript, groundTruth, prContext, diff), 3000, { kimiBaseUrl, kimiModel }),
    callLLM(apiKey, provider, ai, SCORER_B_PROMPT, buildScorerBUserMessage(transcript), 2048, { kimiBaseUrl, kimiModel }),
  ]);

  // Debug: log raw LLM output before parsing (helps diagnose truncation)
  if (provider === 'workers-ai' || provider === 'kimi') {
    console.log('[scorerAgent] Scorer A raw length:', scorerARaw.length, 'last 200 chars:', JSON.stringify(scorerARaw.slice(-200)));
    console.log('[scorerAgent] Scorer B raw length:', scorerBRaw.length, 'last 200 chars:', JSON.stringify(scorerBRaw.slice(-200)));
  }

  // Parse scorer outputs
  const scorerA = extractJson<Record<string, unknown>>(scorerARaw);
  const scorerB = extractJson<Record<string, unknown>>(scorerBRaw);

  // Extract dimension scores (1-5, default to 3 = midpoint)
  // Handle both flat format and nested format (scores.dimension_name)
  const scoresA = (scorerA.scores ?? scorerA) as Record<string, unknown>;
  const scoresB = (scorerB.scores ?? scorerB) as Record<string, unknown>;
  const dimensions: BarsDimensionScores = {
    issue_identification: clampScore(Number(scoresA.issue_identification) || 3),
    prioritization: clampScore(Number(scoresA.prioritization) || 3),
    revision_evaluation: clampScore(Number(scoresA.revision_evaluation) || 3),
    reasoning_quality: clampScore(Number(scoresB.reasoning_quality) || 3),
    question_formation: clampScore(Number(scoresB.question_formation) || 3),
    ai_direction: clampScore(Number(scoresB.ai_direction) || 3),
  };

  // Extract evidence
  const scorerAEvidence = (scorerA.evidence ?? {}) as Record<string, string>;
  const scorerBEvidence = (scorerB.evidence ?? {}) as Record<string, string>;
  const evidence: ScorerEvidence = {
    issue_identification_evidence: scorerAEvidence.issue_identification_evidence ?? '',
    prioritization_evidence: scorerAEvidence.prioritization_evidence ?? '',
    revision_evaluation_evidence: scorerAEvidence.revision_evaluation_evidence ?? '',
    reasoning_quality_evidence: scorerBEvidence.reasoning_quality_evidence ?? '',
    question_formation_evidence: scorerBEvidence.question_formation_evidence ?? '',
    ai_direction_evidence: scorerBEvidence.ai_direction_evidence ?? '',
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
    apiKey, provider, ai, SYNTHESIZER_PROMPT,
    buildSynthesizerUserMessage(dimensions, effectiveness, scorerASummary, scorerBSummary),
    1024,
    { kimiBaseUrl, kimiModel },
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
