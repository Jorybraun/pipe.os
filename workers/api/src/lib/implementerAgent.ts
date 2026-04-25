/**
 * Implementer Agent — Multi-Turn Code Review
 *
 * Calls the configured LLM to generate PR author responses to reviewer comments.
 *
 * Aligned with the Code Review Arena spec:
 * - Output: ImplementerResponse[] with to_comment_id + move (comment/change/pushback)
 * - Input: ReviewRound[] transcript + new ReviewComment[]
 *
 * When no AI binding is available, returns mock responses so that
 * the Worker can be tested locally.
 */

import { buildImplementerSystemPrompt } from './prompts';
import { getMockImplementerResponses } from './mockResponses';

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

export type LLMProvider = 'workers-ai' | 'google-ai';

export interface CallImplementerAgentInput {
  apiKey: string;
  provider?: LLMProvider;
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

// ─── Workers AI (Cloudflare) ───────────────────────────────────────────────

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await ai.run(
    '@cf/qwen/qwen2.5-coder-32b-instruct',
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
  if (typeof raw === 'string') return raw.trim();
  if (raw != null) {
    // Some Workers AI models return nested objects — coerce to string
    console.warn('[implementerAgent] Workers AI response.response is not a string:', typeof raw, JSON.stringify(raw).slice(0, 200));
    return String(raw).trim();
  }
  return '';
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
 * Falls back to mock responses when:
 * - The API call fails (logs error, does not throw — assessment must not break)
 */
export async function callImplementerAgent(
  input: CallImplementerAgentInput,
): Promise<ImplementerResponse[]> {
  const {
    apiKey, provider = 'workers-ai', ai, persona, prBrief, prDiff,
    previousRounds, newComments, dispositionalWeights,
  } = input;

  if (newComments.length === 0) {
    return [];
  }

  if (provider === 'workers-ai' && !ai) {
    throw new Error('[implementerAgent] Workers AI binding not available.');
  }

  const systemPrompt = buildImplementerSystemPrompt(persona, prBrief, prDiff, dispositionalWeights);
  const userMessage = buildUserMessage(previousRounds, newComments);

  let raw: string;
  try {
    if (provider === 'workers-ai') {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage);
    } else {
      throw new Error(`[implementerAgent] Provider '${provider}' is not supported.`);
    }
  } catch (err) {
    console.error(`[implementerAgent] ${provider} call failed:`, err);
    console.log('[implementerAgent] Falling back to mock responses.');
    return getMockImplementerResponses(newComments, persona);
  }

  if (!raw) {
    console.warn(`[implementerAgent] ${provider} returned empty response. Falling back to mocks.`);
    return getMockImplementerResponses(newComments, persona);
  }

  // Parse JSON array from response — handle fenced code blocks
  let parsed: unknown;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[implementerAgent] Failed to parse JSON response:', raw.slice(0, 200));
    console.log('[implementerAgent] Falling back to mock responses.');
    return getMockImplementerResponses(newComments, persona);
  }

  if (!Array.isArray(parsed)) {
    console.error('[implementerAgent] Response is not an array:', typeof parsed);
    console.log('[implementerAgent] Falling back to mock responses.');
    return getMockImplementerResponses(newComments, persona);
  }

  // Validate and normalise each item
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

  if (results.length === 0) {
    console.error('[implementerAgent] Parsed array had no valid items');
    throw new Error(`[implementerAgent] ${provider} failed to produce valid responses`);
  }

  return results;
}
