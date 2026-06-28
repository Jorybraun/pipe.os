/**
 * Implementer Agent — Multi-Turn Code Review
 *
 * Calls the configured LLM to generate PR author responses to reviewer comments.
 *
 * Aligned with the Code Review Arena spec:
 * - Output: ImplementerResponse[] with to_comment_id + move (comment/change/pushback)
 * - Input: ReviewRound[] transcript + new ReviewComment[]
 *
 * Missing or failed AI providers return explicit diagnostics. They must not
 * fabricate PR author behavior.
 */

import {
  aiDeveloperUnavailableDiagnostic,
  type AssessmentDiagnostic,
} from './assessmentEvidence';
import { buildImplementerSystemPrompt } from './prompts';

// ─── Types (arena-aligned) ──────────────────────────────────────────────────

export type ImplementerMove = 'comment' | 'change' | 'pushback';

export interface ReviewComment {
  id: number;
  file?: string;
  line?: number;
  category: string | null;
  severity: string | null;
  what: string;
  why: string;
  suggestion?: string;
  positive: boolean;
}

export interface ImplementerResponse {
  to_comment_id: number;
  move: ImplementerMove;
  content: string;
  updated_code?: string;
}

export interface ReviewRound {
  round: number;
  reviewer_comments: ReviewComment[];
  reviewer_verdict?: string;
  reviewer_summary?: string;
  implementer_responses: ImplementerResponse[];
}

export type LLMProvider = 'workers-ai' | 'google-ai' | 'kimi';

export class AiDeveloperUnavailableError extends Error {
  readonly diagnostic: AssessmentDiagnostic;

  constructor(input: {
    provider: LLMProvider;
    reason: string;
    retryable?: boolean;
    details?: Record<string, string | number | boolean | null>;
  }) {
    const diagnostic = aiDeveloperUnavailableDiagnostic({
      provider: input.provider,
      reason: input.reason,
      retryable: input.retryable,
      details: input.details,
    });
    super(diagnostic.reason);
    this.name = 'AiDeveloperUnavailableError';
    this.diagnostic = diagnostic;
  }
}

export interface CallImplementerAgentInput {
  apiKey: string;
  provider?: LLMProvider;
  kimiBaseUrl?: string;
  kimiModel?: string;
  /** Workers AI binding — required when provider is 'workers-ai' */
  ai?: Ai;
  persona: 'junior' | 'senior';
  prBrief: string;
  prDiff: string;
  /** Previous rounds for context */
  previousRounds: ReviewRound[];
  /** New comments the candidate submitted this round */
  newComments: ReviewComment[];
  /**
   * Optional RCD dispositional weights (ADR-036 §3). When present, the
   * persona prompt gains a natural-language addendum describing team values
   * ("the team values pragmatism, push back harder on theoretical concerns").
   * The addendum never overrides persona — it tunes, it does not replace.
   */
  dispositionalWeights?: Record<string, number>;
}

const VALID_MOVES: ImplementerMove[] = ['comment', 'change', 'pushback'];
const IMPLEMENTER_WORKERS_AI_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const IMPLEMENTER_WORKERS_AI_FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// ─── Kimi (Moonshot AI) ────────────────────────────────────────────────────

async function callKimi(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  baseUrl = 'https://api.kimi.com/coding/v1',
  model = 'kimi-for-coding',
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'Kilo-Code/1.0.0',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kimi API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ─── Workers AI (Cloudflare) ───────────────────────────────────────────────

async function callWorkersAI(
  ai: Ai,
  systemPrompt: string,
  userMessage: string,
  model = IMPLEMENTER_WORKERS_AI_MODEL,
): Promise<string> {
  const response = await ai.run(
    model as Parameters<Ai['run']>[0],
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
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
  return textFromProviderResponse(raw ?? response).trim();
}

function textFromProviderResponse(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  const directKeys = ['response', 'text', 'content', 'generated_text', 'output_text', 'result'];
  for (const key of directKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content ?? first?.text;
    if (typeof content === 'string') return content;
  }

  const output = record.output;
  if (Array.isArray(output)) {
    const chunks = output
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const outputItem = item as Record<string, unknown>;
        if (typeof outputItem.text === 'string') return outputItem.text;
        if (typeof outputItem.content === 'string') return outputItem.content;
        return '';
      })
      .filter(Boolean);
    if (chunks.length > 0) return chunks.join('\n');
  }

  console.warn(
    '[implementerAgent] Provider response did not expose a known text field:',
    JSON.stringify(value).slice(0, 200),
  );
  return '';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function jsonPayloadCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fenceMatch?.[1]?.trim() ?? trimmed;
  const candidates = [unfenced];

  const start = unfenced.indexOf('[');
  const end = unfenced.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(unfenced.slice(start, end + 1).trim());
  }

  const objectStart = unfenced.indexOf('{');
  const objectEnd = unfenced.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    candidates.push(unfenced.slice(objectStart, objectEnd + 1).trim());
  }

  return uniqueStrings(candidates);
}

function escapeRawNewlinesInsideStrings(value: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    if (char === '\n') {
      output += '\\n';
      continue;
    }
    if (char === '\r') {
      output += '\\r';
      continue;
    }

    output += char;
  }
  return output;
}

function stripTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function parseModelJson(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(stripTrailingCommas(escapeRawNewlinesInsideStrings(candidate)));
  }
}

function unwrapImplementerResponses(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return parsed;
  const record = parsed as Record<string, unknown>;
  for (const key of ['responses', 'response', 'author_responses', 'implementer_responses', 'replies']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  if (
    typeof record.to_comment_id === 'number'
    && typeof record.content === 'string'
  ) {
    return [record];
  }
  return parsed;
}

function parseImplementerResponseJson(raw: string): unknown {
  const candidates = jsonPayloadCandidates(raw);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return unwrapImplementerResponses(parseModelJson(candidate));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No JSON payload found');
}

function normaliseImplementerResponses(parsed: unknown): ImplementerResponse[] {
  if (!Array.isArray(parsed)) return [];

  const results: ImplementerResponse[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).to_comment_id === 'number' &&
      typeof (item as Record<string, unknown>).content === 'string'
    ) {
      const rec = item as Record<string, unknown>;
      const rawMove = typeof rec.move === 'string' ? rec.move.toLowerCase() : 'comment';
      const move: ImplementerMove = VALID_MOVES.includes(rawMove as ImplementerMove)
        ? (rawMove as ImplementerMove)
        : 'comment';

      const updatedCode = typeof rec.updated_code === 'string' && rec.updated_code.trim() !== ''
        ? rec.updated_code
        : undefined;

      // Soft validation: warn if move=change but no updated_code
      if (move === 'change' && updatedCode === undefined) {
        console.warn(`[implementerAgent] move=change for comment #${rec.to_comment_id} but no updated_code provided`);
      }

      results.push({
        to_comment_id: rec.to_comment_id as number,
        move,
        content: rec.content as string,
        ...(updatedCode !== undefined ? { updated_code: updatedCode } : {}),
      });
    }
  }

  return results;
}

function buildJsonRepairUserMessage(raw: string, newComments: ReviewComment[]): string {
  const commentIds = newComments.map((comment) => comment.id).join(', ');
  return [
    'Convert the raw PR author response into strict JSON.',
    'Return ONLY this shape: {"responses":[{"to_comment_id":number,"move":"comment|change|pushback","content":"string","updated_code":"optional string"}]}',
    `Allowed to_comment_id values: ${commentIds}.`,
    'Preserve the PR author intent from the raw response. Do not add markdown fences, prose, or extra keys.',
    '',
    'RAW_RESPONSE:',
    raw || '(empty response)',
  ].join('\n');
}

async function callJsonRepairProvider(input: {
  provider: LLMProvider;
  apiKey: string;
  kimiBaseUrl?: string;
  kimiModel?: string;
  ai?: Ai;
  raw: string;
  newComments: ReviewComment[];
}): Promise<string> {
  const systemPrompt = [
    'You repair malformed model output for a code-review PR author agent.',
    'You do not invent review content. You only convert the supplied raw answer into the required JSON object.',
    'If the raw answer contains multiple comments, map each one to the closest allowed comment id.',
  ].join('\n');
  const userMessage = buildJsonRepairUserMessage(input.raw, input.newComments);

  if (input.provider === 'workers-ai') {
    if (!input.ai) {
      throw new Error('Workers AI binding is not available for JSON repair.');
    }
    return callWorkersAI(input.ai, systemPrompt, userMessage, IMPLEMENTER_WORKERS_AI_FALLBACK_MODEL);
  }
  if (input.provider === 'kimi') {
    return callKimi(input.apiKey, systemPrompt, userMessage, input.kimiBaseUrl, input.kimiModel);
  }
  throw new Error(`[implementerAgent] Provider '${input.provider}' is not supported for JSON repair.`);
}

async function repairAndParseImplementerResponse(input: {
  provider: LLMProvider;
  apiKey: string;
  kimiBaseUrl?: string;
  kimiModel?: string;
  ai?: Ai;
  raw: string;
  newComments: ReviewComment[];
}): Promise<unknown> {
  if (input.raw.trim() === '') {
    throw new Error('Cannot repair an empty provider response.');
  }
  const repairedRaw = await callJsonRepairProvider(input);
  return parseImplementerResponseJson(repairedRaw);
}

// ─── Prompt builder for user message ────────────────────────────────────────

/**
 * Formats the conversation transcript + new comments into a user message.
 */
function buildUserMessage(
  previousRounds: ReviewRound[],
  newComments: ReviewComment[],
): string {
  const parts: string[] = [];

  if (previousRounds.length > 0) {
    parts.push('CONVERSATION HISTORY SO FAR:\n');
    for (const round of previousRounds) {
      parts.push(`--- Round ${round.round} ---`);
      for (const comment of round.reviewer_comments) {
        const location = comment.file
          ? ` (${comment.file}${comment.line ? `:${comment.line}` : ''})`
          : '';
        const severity = comment.severity ? ` [${comment.severity}]` : '';
        parts.push(`Reviewer comment #${comment.id}${location}${severity}: ${comment.what}`);
        if (comment.why) parts.push(`  Why: ${comment.why}`);
        if (comment.suggestion) parts.push(`  Suggestion: ${comment.suggestion}`);
      }
      for (const resp of round.implementer_responses) {
        parts.push(`You (PR author) → comment #${resp.to_comment_id} [${resp.move}]: ${resp.content}`);
      }
      parts.push('');
    }
  }

  parts.push('NEW REVIEWER COMMENTS TO RESPOND TO:\n');
  for (const comment of newComments) {
    const location = comment.file
      ? ` (${comment.file}${comment.line ? `:${comment.line}` : ''})`
      : '';
    const severity = comment.severity ? ` [${comment.severity}]` : '';
    parts.push(`Comment #${comment.id}${location}${severity}: ${comment.what}`);
    if (comment.why) parts.push(`  Why: ${comment.why}`);
    if (comment.suggestion) parts.push(`  Suggestion: ${comment.suggestion}`);
  }

  parts.push('\nRespond to each new comment as the PR author. Return the JSON array as instructed.');

  return parts.join('\n');
}

// ─── Agent call ──────────────────────────────────────────────────────────────

/**
 * Calls the configured LLM to get implementer responses for the given comments.
 *
 * Throws AiDeveloperUnavailableError when a real provider cannot produce a
 * valid response. Candidate transcripts must never contain simulated author
 * behavior.
 */
export async function callImplementerAgent(
  input: CallImplementerAgentInput,
): Promise<ImplementerResponse[]> {
  const {
    apiKey, provider = 'workers-ai', kimiBaseUrl, kimiModel, ai, persona, prBrief, prDiff,
    previousRounds, newComments, dispositionalWeights,
  } = input;

  if (newComments.length === 0) {
    return [];
  }

  if (provider === 'workers-ai' && !ai) {
    throw new AiDeveloperUnavailableError({
      provider,
      reason: 'Workers AI binding is not available for the review author agent.',
      retryable: true,
    });
  }

  const systemPrompt = buildImplementerSystemPrompt(persona, prBrief, prDiff, dispositionalWeights);
  const userMessage = buildUserMessage(previousRounds, newComments);

  let raw: string;
  let usedWorkersAiFallback = false;
  try {
    if (provider === 'workers-ai') {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage);
    } else if (provider === 'kimi') {
      raw = await callKimi(apiKey, systemPrompt, userMessage, kimiBaseUrl, kimiModel);
    } else {
      throw new Error(`[implementerAgent] Provider '${provider}' is not supported.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[implementerAgent] ${provider} call failed:`, message);
    throw new AiDeveloperUnavailableError({
      provider,
      reason: `Review author agent provider failed: ${message}`,
      retryable: true,
    });
  }

  if (!raw && provider === 'workers-ai') {
    console.warn('[implementerAgent] Workers AI primary author model returned empty response; retrying fallback model.');
    usedWorkersAiFallback = true;
    try {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage, IMPLEMENTER_WORKERS_AI_FALLBACK_MODEL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[implementerAgent] workers-ai fallback call failed:', message);
      throw new AiDeveloperUnavailableError({
        provider,
        reason: `Review author agent fallback provider failed: ${message}`,
        retryable: true,
      });
    }
  }

  // Parse JSON array from response — handle fenced code blocks
  let parsed: unknown;
  try {
    if (!raw) {
      throw new Error('Empty response');
    }
    parsed = parseImplementerResponseJson(raw);
  } catch (parseError) {
    if (provider === 'workers-ai' && !usedWorkersAiFallback) {
      console.warn(
        '[implementerAgent] Workers AI primary author model returned unparsable response; retrying fallback model:',
        parseError instanceof Error ? parseError.message : String(parseError),
      );
      usedWorkersAiFallback = true;
      try {
        raw = await callWorkersAI(ai!, systemPrompt, userMessage, IMPLEMENTER_WORKERS_AI_FALLBACK_MODEL);
        parsed = parseImplementerResponseJson(raw);
      } catch (fallbackError) {
        console.error(
          '[implementerAgent] Workers AI fallback failed to produce valid JSON:',
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
        try {
          parsed = await repairAndParseImplementerResponse({
            provider,
            apiKey,
            ...(kimiBaseUrl ? { kimiBaseUrl } : {}),
            ...(kimiModel ? { kimiModel } : {}),
            ai,
            raw,
            newComments,
          });
        } catch (repairError) {
          console.error(
            '[implementerAgent] JSON repair failed after fallback parse error:',
            repairError instanceof Error ? repairError.message : String(repairError),
          );
          throw new AiDeveloperUnavailableError({
            provider,
            reason: 'Review author agent provider returned invalid JSON.',
            retryable: true,
          });
        }
      }
    } else {
      console.error('[implementerAgent] Failed to parse JSON response:', raw.slice(0, 200));
      try {
        parsed = await repairAndParseImplementerResponse({
          provider,
          apiKey,
          ...(kimiBaseUrl ? { kimiBaseUrl } : {}),
          ...(kimiModel ? { kimiModel } : {}),
          ai,
          raw,
          newComments,
        });
      } catch (repairError) {
        console.error(
          '[implementerAgent] JSON repair failed after parse error:',
          repairError instanceof Error ? repairError.message : String(repairError),
        );
        throw new AiDeveloperUnavailableError({
          provider,
          reason: raw
            ? 'Review author agent provider returned invalid JSON.'
            : 'Review author agent provider returned an empty response.',
          retryable: true,
        });
      }
    }
  }

  if (!Array.isArray(parsed)) {
    if (provider === 'workers-ai' && !usedWorkersAiFallback) {
      console.warn('[implementerAgent] Workers AI primary author model returned non-array JSON; retrying fallback model.');
      try {
        raw = await callWorkersAI(ai!, systemPrompt, userMessage, IMPLEMENTER_WORKERS_AI_FALLBACK_MODEL);
        parsed = parseImplementerResponseJson(raw);
      } catch (fallbackError) {
        console.error(
          '[implementerAgent] Workers AI fallback failed after non-array response:',
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
      }
    }
  }

  if (!Array.isArray(parsed)) {
    try {
      parsed = await repairAndParseImplementerResponse({
        provider,
        apiKey,
        ...(kimiBaseUrl ? { kimiBaseUrl } : {}),
        ...(kimiModel ? { kimiModel } : {}),
        ai,
        raw,
        newComments,
      });
    } catch (repairError) {
      console.error(
        '[implementerAgent] JSON repair failed after non-array response:',
        repairError instanceof Error ? repairError.message : String(repairError),
      );
      throw new AiDeveloperUnavailableError({
        provider,
        reason: 'Review author agent provider response was not an array.',
        retryable: true,
      });
    }
  }

  let results = normaliseImplementerResponses(parsed);
  if (results.length === 0) {
    try {
      parsed = await repairAndParseImplementerResponse({
        provider,
        apiKey,
        ...(kimiBaseUrl ? { kimiBaseUrl } : {}),
        ...(kimiModel ? { kimiModel } : {}),
        ai,
        raw,
        newComments,
      });
      results = normaliseImplementerResponses(parsed);
    } catch (repairError) {
      console.error(
        '[implementerAgent] JSON repair failed after empty normalized responses:',
        repairError instanceof Error ? repairError.message : String(repairError),
      );
    }

    if (results.length === 0) {
      console.error('[implementerAgent] Parsed array had no valid items');
      throw new AiDeveloperUnavailableError({
        provider,
        reason: 'Review author agent provider returned no valid responses.',
        retryable: true,
      });
    }
  }

  return results;
}
