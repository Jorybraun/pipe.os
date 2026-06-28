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
const SCORER_WORKERS_AI_MODELS = [
  '@cf/openai/gpt-oss-20b',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
] as const;
const WORKERS_AI_CALL_TIMEOUT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (isRecord(part) && typeof part.text === 'string') return part.text;
      if (isRecord(part) && typeof part.content === 'string') return part.content;
      return '';
    })
    .join('')
    .trim();
}

async function readStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) chunks.push(new TextDecoder().decode(result.value));
  }
  return chunks.join('').trim();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function extractWorkersAIText(response: unknown): Promise<string> {
  if (typeof response === 'string') return response.trim();
  if (typeof ReadableStream !== 'undefined' && response instanceof ReadableStream) {
    return readStream(response);
  }
  if (!isRecord(response)) return '';

  const direct = textFromContent(response.response);
  if (direct) return direct;

  const result = isRecord(response.result) ? response.result : null;
  const resultText = result ? textFromContent(result.response) || textFromContent(result.content) : '';
  if (resultText) return resultText;

  const choices = Array.isArray(response.choices) ? response.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    const message = isRecord(choice.message) ? choice.message : null;
    const text = textFromContent(message?.content) || textFromContent(choice.text) || textFromContent(choice.content);
    if (text) return text;
  }

  return '';
}

async function callWorkersAIModel(
  ai: Ai,
  model: typeof SCORER_WORKERS_AI_MODELS[number],
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  console.log('[callWorkersAI] calling ai.run with model:', model, 'prompt lengths:', systemPrompt.length, userMessage.length);
  const response = await withTimeout(
    ai.run(
      model as Parameters<typeof ai.run>[0],
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
      },
    ),
    WORKERS_AI_CALL_TIMEOUT_MS,
    `[callWorkersAI] ${model}`,
  );

  const text = await extractWorkersAIText(response);
  if (!text) {
    throw new Error(`[scorerAgent] Workers AI ${model} returned empty text.`);
  }
  return text;
}

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string, maxTokens = 2048): Promise<string> {
  let lastError: unknown;
  for (const model of SCORER_WORKERS_AI_MODELS) {
    try {
      const text = await callWorkersAIModel(ai, model, systemPrompt, userMessage, maxTokens);
      console.log('[callWorkersAI] using model:', model);
      return text;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[callWorkersAI] model failed, trying next scorer model:', { model, message });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

const WORKERS_AI_SINGLE_PASS_PROMPT = `You are a production code-review assessment scoring panel.

Score the completed candidate review using the 6 BARS dimensions:
- issue_identification
- prioritization
- revision_evaluation
- reasoning_quality
- question_formation
- ai_direction

Use only the PR context, diff excerpt, ground truth when present, and review transcript. Do not invent bugs, files, source facts, or candidate behavior. If ground truth is empty, judge the candidate's review practice against the diff/context and set bug metrics conservatively.

Return only valid JSON with this exact top-level shape:
{
  "dimensions": {
    "issue_identification": 1-5,
    "prioritization": 1-5,
    "revision_evaluation": 1-5,
    "reasoning_quality": 1-5,
    "question_formation": 1-5,
    "ai_direction": 1-5
  },
  "evidence": {
    "issue_identification_evidence": "source-backed reason",
    "prioritization_evidence": "source-backed reason",
    "revision_evaluation_evidence": "source-backed reason",
    "reasoning_quality_evidence": "source-backed reason",
    "question_formation_evidence": "source-backed reason",
    "ai_direction_evidence": "source-backed reason"
  },
  "metrics": {
    "bugs_found": [number ids],
    "bugs_missed": [number ids],
    "bugs_found_pct": 0-1,
    "false_positive_count": number,
    "true_finding_count": number,
    "approved_with_unfound_critical": boolean,
    "cave_ratio": number,
    "fix_verifications": number
  },
  "overall": {
    "narrative": "short hiring-facing summary",
    "strengths": ["specific strength"],
    "growth_areas": ["specific growth area"]
  },
  "scorer_a_summary": "ground-truth/source-backed scoring summary",
  "scorer_b_summary": "communication and review-practice scoring summary"
}`;

function buildWorkersAISinglePassUserMessage(input: {
  transcript: unknown;
  groundTruth: PlantedBug[];
  prContext: string;
  diff?: string | null;
}): string {
  const transcriptJson = JSON.stringify(input.transcript, null, 2).slice(0, 30_000);
  const groundTruthJson = JSON.stringify(input.groundTruth, null, 2).slice(0, 12_000);
  const diffSection = input.diff
    ? `## Source-Backed Diff Excerpt\n${input.diff.slice(0, 35_000)}\n\n`
    : '';

  return `## PR Context
${input.prContext || 'No PR title/description supplied.'}

${diffSection}## Ground Truth Bugs
${groundTruthJson}

## Candidate Review Transcript
${transcriptJson}

Score this completed review now. Return only the JSON object.`;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function numberArrayValue(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.round(entry));
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function dimensionValue(record: Record<string, unknown>, id: DimensionId): number {
  return clampScore(numberValue(record[id], 3));
}

function normalizeSinglePassScoreReport(input: {
  raw: Record<string, unknown>;
  transcript: unknown;
  groundTruth: PlantedBug[];
  level: 'junior' | 'mid' | 'senior';
  dispositionalWeights?: Record<string, number>;
}): ScoreReport {
  const dimensionSource = recordOrEmpty(input.raw.dimensions ?? input.raw.scores);
  const dimensions: BarsDimensionScores = {
    issue_identification: dimensionValue(dimensionSource, 'issue_identification'),
    prioritization: dimensionValue(dimensionSource, 'prioritization'),
    revision_evaluation: dimensionValue(dimensionSource, 'revision_evaluation'),
    reasoning_quality: dimensionValue(dimensionSource, 'reasoning_quality'),
    question_formation: dimensionValue(dimensionSource, 'question_formation'),
    ai_direction: dimensionValue(dimensionSource, 'ai_direction'),
  };

  const evidenceRaw = recordOrEmpty(input.raw.evidence);
  const evidence: ScorerEvidence = {
    issue_identification_evidence: stringValue(evidenceRaw.issue_identification_evidence),
    prioritization_evidence: stringValue(evidenceRaw.prioritization_evidence),
    revision_evaluation_evidence: stringValue(evidenceRaw.revision_evaluation_evidence),
    reasoning_quality_evidence: stringValue(evidenceRaw.reasoning_quality_evidence),
    question_formation_evidence: stringValue(evidenceRaw.question_formation_evidence),
    ai_direction_evidence: stringValue(evidenceRaw.ai_direction_evidence),
  };

  const metricsRaw = recordOrEmpty(input.raw.metrics);
  const bugsFound = [...new Set(numberArrayValue(metricsRaw.bugs_found))];
  const missedFromModel = [...new Set(numberArrayValue(metricsRaw.bugs_missed))];
  const bugsMissed = missedFromModel.length > 0
    ? missedFromModel
    : input.groundTruth.filter((bug) => !bugsFound.includes(bug.id)).map((bug) => bug.id);
  const bugsFoundPct = input.groundTruth.length > 0
    ? bugsFound.filter((id) => input.groundTruth.some((bug) => bug.id === id)).length / input.groundTruth.length
    : Math.max(0, Math.min(1, numberValue(metricsRaw.bugs_found_pct, 0)));

  const metrics: ScorerAMetrics = {
    bugs_found: bugsFound,
    bugs_missed: bugsMissed,
    bugs_found_pct: Math.round(bugsFoundPct * 100) / 100,
    false_positive_count: Math.max(0, Math.round(numberValue(metricsRaw.false_positive_count, 0))),
    true_finding_count: Math.max(0, Math.round(numberValue(metricsRaw.true_finding_count, bugsFound.length))),
    approved_with_unfound_critical: Boolean(metricsRaw.approved_with_unfound_critical),
    cave_ratio: Math.max(0, numberValue(metricsRaw.cave_ratio, 0)),
    fix_verifications: Math.max(0, Math.round(numberValue(metricsRaw.fix_verifications, 0))),
  };

  const totalComments = countReviewerComments(input.transcript);
  const effectiveness = computeEffectiveness(
    metrics.bugs_found,
    metrics.bugs_missed,
    input.groundTruth,
    metrics.false_positive_count,
    totalComments,
  );
  const overallScore = computeOverallScore(
    dimensions,
    effectiveness,
    input.level,
    input.dispositionalWeights,
  );
  const band = assignBand(overallScore);
  const overallRaw = recordOrEmpty(input.raw.overall);
  const narrative = stringValue(
    overallRaw.narrative,
    `Overall score: ${overallScore}/100 (${band}). The review was scored from source-backed transcript and PR evidence.`,
  );

  return {
    dimensions,
    evidence,
    metrics,
    effectiveness,
    overall: {
      score: overallScore,
      band,
      narrative,
      strengths: stringArrayValue(overallRaw.strengths),
      growth_areas: stringArrayValue(overallRaw.growth_areas),
    },
    scorer_a_summary: stringValue(input.raw.scorer_a_summary, 'Source-backed scoring pass completed.'),
    scorer_b_summary: stringValue(input.raw.scorer_b_summary, 'Communication scoring pass completed.'),
  };
}

async function scoreReviewSessionWithWorkersAISinglePass(input: {
  ai: Ai;
  transcript: unknown;
  groundTruth: PlantedBug[];
  diff?: string | null;
  prContext: string;
  level: 'junior' | 'mid' | 'senior';
  dispositionalWeights?: Record<string, number>;
}): Promise<ScoreReport> {
  const userMessage = buildWorkersAISinglePassUserMessage({
    transcript: input.transcript,
    groundTruth: input.groundTruth,
    prContext: input.prContext,
    diff: input.diff,
  });

  let lastError: unknown;
  for (const model of SCORER_WORKERS_AI_MODELS) {
    try {
      const raw = await callWorkersAIModel(input.ai, model, WORKERS_AI_SINGLE_PASS_PROMPT, userMessage, 4096);
      const parsed = extractJson<Record<string, unknown>>(raw);
      return normalizeSinglePassScoreReport({
        raw: parsed,
        transcript: input.transcript,
        groundTruth: input.groundTruth,
        level: input.level,
        dispositionalWeights: input.dispositionalWeights,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[scorerAgent] Workers AI single-pass scorer failed, trying next model:', { model, message });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

  if (provider === 'workers-ai') {
    return scoreReviewSessionWithWorkersAISinglePass({
      ai: ai!,
      transcript,
      groundTruth,
      diff,
      prContext,
      level,
      dispositionalWeights,
    });
  }

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
