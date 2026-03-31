/**
 * Implementer Agent — Multi-Turn Code Review
 *
 * Calls Devstral (Mistral) via the OpenAI-compatible Chat Completions API
 * to generate PR author responses to reviewer comments.
 *
 * Aligned with the Code Review Arena spec:
 * - Output: ImplementerResponse[] with to_comment_id + move (comment/change/pushback)
 * - Input: ReviewRound[] transcript + new ReviewComment[]
 *
 * When MISTRAL_API_KEY is not set, returns mock responses so that
 * the Worker can be tested locally without a live API key.
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

export type LLMProvider = 'workers-ai' | 'mistral' | 'anthropic';

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
}

// ─── LLM API response shapes ────────────────────────────────────────────────

interface MistralChoice {
  message: { role: string; content: string };
}

interface MistralResponse {
  choices: MistralChoice[];
}

interface AnthropicMessage {
  content: Array<{ type: string; text: string }>;
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

  return (response as { response?: string }).response?.trim() ?? '';
}

// ─── Prompt builder for user message ────────────────────────────────────────

/**
 * Formats the conversation transcript + new comments into a user message
 * for the Anthropic API.
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

// ─── Provider-specific API calls ────────────────────────────────────────────

async function callMistral(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'devstral-latest',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[implementerAgent] Mistral API error', { status: response.status, body: errorText });
    return '';
  }

  const data = (await response.json()) as MistralResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropic(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[implementerAgent] Anthropic API error', { status: response.status, body: errorText });
    return '';
  }

  const data = (await response.json()) as AnthropicMessage;
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

// ─── Agent call ──────────────────────────────────────────────────────────────

/**
 * Calls the configured LLM (Mistral Devstral by default, Anthropic as option)
 * to get implementer responses for the given comments.
 *
 * Falls back to mock responses when:
 * - apiKey is empty / missing
 * - The API call fails (logs error, does not throw — assessment must not break)
 */
export async function callImplementerAgent(
  input: CallImplementerAgentInput,
): Promise<ImplementerResponse[]> {
  const { apiKey, provider = 'workers-ai', ai, persona, prBrief, prDiff, previousRounds, newComments } = input;

  if (newComments.length === 0) {
    return [];
  }

  // Return mock responses when API key is not configured (for testing)
  if (!apiKey && provider !== 'workers-ai') {
    console.log('[implementerAgent] No API key configured. Returning mock responses for testing.');
    return getMockImplementerResponses(newComments, persona);
  }

  if (provider === 'workers-ai' && !ai) {
    throw new Error('[implementerAgent] Workers AI binding not available.');
  }
  if (provider !== 'workers-ai' && !apiKey) {
    throw new Error(`[implementerAgent] No API key configured for ${provider}. Set MISTRAL_API_KEY or ANTHROPIC_API_KEY.`);
  }

  const systemPrompt = buildImplementerSystemPrompt(persona, prBrief, prDiff);
  const userMessage = buildUserMessage(previousRounds, newComments);

  let raw: string;
  try {
    if (provider === 'workers-ai') {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage);
    } else if (provider === 'anthropic') {
      raw = await callAnthropic(apiKey, systemPrompt, userMessage);
    } else {
      raw = await callMistral(apiKey, systemPrompt, userMessage);
    }
  } catch (err) {
    console.error(`[implementerAgent] ${provider} call failed:`, err);
    throw new Error(`[implementerAgent] ${provider} failed to produce valid responses`);
  }

  if (!raw) {
    throw new Error(`[implementerAgent] ${provider} failed to produce valid responses`);
  }

  // Parse JSON array from response — handle fenced code blocks
  let parsed: unknown;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[implementerAgent] Failed to parse JSON response:', raw.slice(0, 200));
    throw new Error(`[implementerAgent] ${provider} failed to produce valid responses`);
  }

  if (!Array.isArray(parsed)) {
    console.error('[implementerAgent] Response is not an array:', typeof parsed);
    throw new Error(`[implementerAgent] ${provider} failed to produce valid responses`);
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
