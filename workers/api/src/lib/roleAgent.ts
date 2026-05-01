/**
 * Role Discovery Agent — provider-agnostic with tool calling support.
 *
 * Uses the LLMProvider interface so Google AI (Gemma 4) and Vertex AI can be
 * swapped via the ROLE_AGENT_PROVIDER env var.
 *
 * ReAct loop (only when provider.supportsTools):
 * 1. Send messages + tool definitions to provider
 * 2. If provider returns tool_calls → execute them (fetch URLs, extract text)
 * 3. Append tool results, call provider again
 * 4. Repeat until provider returns the final question/synthesis JSON
 *
 * Falls back to mock responses when no provider key is configured.
 */

import {
  buildRoleAgentSystemPrompt,
  buildRoleAgentUserMessage,
  buildSynthesisPrompt,
  selectPhasePrompt,
} from './roleAgentPrompts';
import type { LLMProvider, LLMMessage, LLMToolCall } from './llm/types';
import type {
  RoleExchange,
  DomainCoverage,
  CandidatePersona,
  GeneratedJobDescription,
  PhaseDirective,
  ConversationContext,
  RecruitmentBrief,
} from '../types';

export type {
  CandidatePersona,
  GeneratedJobDescription,
  PhaseDirective,
  ConversationContext,
  ConversationPhase,
  EvpCategory,
  ExtractedStory,
  QualificationStatus,
  RecruitmentBrief,
} from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RoleAgentQuestionResponse {
  type: 'question';
  reasoning: string;
  acknowledgment: string;
  question: {
    id: string;
    text: string;
    input: {
      type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
      options?: string[];
      placeholder?: string;
    };
    suggestedAnswers?: string[];
  };
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
}

export interface RoleAgentSynthesisResponse {
  type: 'synthesis';
  reasoning: string;
  /** Structured candidate persona (Role Discovery v2 output). */
  persona: CandidatePersona;
  /** Markdown job description (Role Discovery v2 output). */
  jobDescription: string;
  /**
   * Legacy narrative string. Derived from `persona.archetype` for backwards
   * compatibility with any caller still reading this field. New code should
   * use `persona` and `jobDescription`.
   */
  synthesis: string;
  /** Structured recruiter outreach brief (RD-P5, RD-39). Present when the EVP/friction phase completed. */
  recruitmentBrief?: RecruitmentBrief;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
}

export type RoleAgentResponse = RoleAgentQuestionResponse | RoleAgentSynthesisResponse;

export interface CallRoleAgentInput {
  provider: LLMProvider | null;
  /** Fallback provider — used when the primary fails (model switching for resilience). */
  fallbackProvider?: LLMProvider | null;
  /** Provider used for synthesis turns (budget exhausted). When unset, falls back to `provider`. */
  synthesisProvider?: LLMProvider | null;
  /** Fallback for synthesis provider. When unset, falls back to `fallbackProvider`. */
  synthesisFallbackProvider?: LLMProvider | null;
  baseline: Record<string, unknown>;
  exchanges: RoleExchange[];
  knowledgeState: Record<string, unknown>;
  questionsAsked: number;
  questionBudget: number;
  /** ADR-028: participant role for adaptive prompt variants. */
  participantRole?: string;
  /** Previous turn's domain coverage assessment — fed back so the agent doesn't repeat. */
  domainCoverage?: Record<string, string>;
  /** RD-P5: phase directive from the deterministic controller. When present, selects the phase-specific system prompt. */
  phaseDirective?: PhaseDirective;
  /** RD-P5: full conversation context assembled by the controller. */
  conversationContext?: ConversationContext;
}


// ─── Tool definitions ───────────────────────────────────────────────────────

import type { LLMTool } from './llm/types';

const AGENT_TOOLS: LLMTool[] = [
  {
    name: 'research_company',
    description: 'Fetch and read a company website to understand their business, product, culture, and tech stack. Use this when you know the company name or URL to ask more informed questions.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The company website URL (e.g., "https://acme.com" or "acme.com")' },
        focus: {
          type: 'string',
          description: 'What to look for: "about" for company overview, "careers" for job listings, "engineering" for tech blog',
          enum: ['about', 'careers', 'engineering'],
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_technology',
    description: 'Look up information about a specific technology, framework, or tool to ask better follow-up questions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The technology or concept to research (e.g., "Temporal workflow engine")' },
      },
      required: ['query'],
    },
  },
];

// ─── Tool execution ─────────────────────────────────────────────────────────

/** Fetch a URL and extract readable text (strips HTML tags). */
async function fetchAndExtract(url: string, maxChars = 3000): Promise<string> {
  let fullUrl = url;
  if (!fullUrl.startsWith('http')) fullUrl = `https://${fullUrl}`;

  try {
    const response = await fetch(fullUrl, {
      headers: { 'User-Agent': 'PipeBot/1.0 (role-discovery)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return `[Error: HTTP ${response.status} fetching ${fullUrl}]`;
    }

    const html = await response.text();

    // Strip HTML tags, scripts, styles — crude but effective for context
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, maxChars);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[roleAgent] Fetch failed for ${fullUrl}:`, msg);
    return `[Error: Could not fetch ${fullUrl} — ${msg}]`;
  }
}

async function executeToolCall(call: LLMToolCall): Promise<{ result: string; label: string }> {
  const args = call.arguments as Record<string, string>;

  switch (call.name) {
    case 'research_company': {
      const url = args.url ?? '';
      const focus = args.focus ?? 'about';
      const paths: Record<string, string[]> = {
        about: ['', '/about', '/about-us'],
        careers: ['/careers', '/jobs', '/hiring'],
        engineering: ['/blog', '/engineering', '/tech'],
      };
      const targetPaths = paths[focus] ?? [''];

      // Try the first path that works
      for (const path of targetPaths) {
        const fullUrl = url.replace(/\/$/, '') + path;
        const result = await fetchAndExtract(fullUrl);
        if (!result.startsWith('[Error')) {
          console.log(`[roleAgent] research_company: fetched ${fullUrl}, ${result.length} chars`);
          return { result, label: `Researching ${url}...` };
        }
      }
      return { result: `[Could not access ${url}]`, label: `Researching ${url}...` };
    }

    case 'search_technology': {
      const query = args.query ?? '';
      // Use DuckDuckGo instant answer API (no key needed)
      try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const response = await fetch(ddgUrl, { signal: AbortSignal.timeout(4000) });
        const data = (await response.json()) as {
          Abstract?: string;
          AbstractText?: string;
          RelatedTopics?: Array<{ Text?: string }>;
        };
        const parts: string[] = [];
        if (data.AbstractText) parts.push(data.AbstractText);
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text) parts.push(topic.Text);
          }
        }
        const result = parts.join('\n\n') || `[No results for "${query}"]`;
        console.log(`[roleAgent] search_technology: "${query}", ${result.length} chars`);
        return { result: result.slice(0, 2000), label: `Looking up ${query}...` };
      } catch {
        return { result: `[Search failed for "${query}"]`, label: `Looking up ${query}...` };
      }
    }

    default:
      return { result: `[Unknown tool: ${call.name}]`, label: 'Thinking...' };
  }
}

// ─── Provider call with tool loop ───────────────────────────────────────────

const MAX_TOOL_ROUNDS = 3;

async function callProviderWithTools(
  provider: LLMProvider,
  messages: LLMMessage[],
  maxTokens = 4096,
): Promise<{ content: string; toolsUsed: string[] }> {
  const toolsUsed: string[] = [];
  let currentMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS - 1;

    const useTools = !isLastRound && provider.supportsTools;
    const completion = await provider.complete(currentMessages, {
      ...(useTools ? { tools: AGENT_TOOLS } : {}),
      forceJson: isLastRound || !provider.supportsTools,
      maxTokens,
    });

    // No tool calls — we have the final answer
    if (!completion.toolCalls?.length) {
      return { content: completion.content?.trim() ?? '', toolsUsed };
    }

    // Execute tool calls in parallel — each is an independent fetch
    currentMessages.push({
      role: 'assistant',
      content: completion.content,
      toolCalls: completion.toolCalls,
    });

    const toolResults = await Promise.all(completion.toolCalls.map((call) => executeToolCall(call)));
    for (let i = 0; i < completion.toolCalls.length; i++) {
      const call = completion.toolCalls[i]!;
      const { result, label } = toolResults[i]!;
      toolsUsed.push(label);
      currentMessages.push({
        role: 'tool',
        content: result,
        toolCallId: call.id,
        toolName: call.name,
      });
    }

    console.log(`[roleAgent] Tool round ${round + 1} (${provider.name}): executed ${completion.toolCalls.length} tool(s) in parallel`);
  }

  return { content: '', toolsUsed };
}

// ─── Provider call with retry ───────────────────────────────────────────────

/**
 * Try the primary provider; if it fails, try the fallback. If both fail, throw.
 * This gives us model-switching resilience without silently serving mock questions.
 */
async function callProviderWithFallback(
  primary: LLMProvider | null,
  fallback: LLMProvider | null,
  callFn: (p: LLMProvider) => Promise<{ content: string; toolsUsed: string[] }>,
): Promise<{ content: string; toolsUsed: string[] }> {
  const providers = [
    { p: primary, name: primary?.name ?? 'primary' },
    { p: fallback, name: fallback?.name ?? 'fallback' },
  ].filter((x) => x.p) as { p: LLMProvider; name: string }[];

  if (providers.length === 0) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
  }

  let lastError: Error | null = null;

  for (const { p, name } of providers) {
    try {
      const result = await callFn(p);
      if (result.content.trim().length > 0) {
        return result;
      }
      lastError = new Error(`${name} returned empty content`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[roleAgent] ${name} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error('All AI providers failed');
}

// ─── Parse and validate ─────────────────────────────────────────────────────

const VALID_INPUT_TYPES = ['text', 'textarea', 'tags', 'select', 'radio'] as const;
const VALID_COVERAGES: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];
const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;

function parseDomainCoverage(raw: unknown): Record<string, DomainCoverage> {
  const result: Record<string, DomainCoverage> = {};
  if (raw && typeof raw === 'object') {
    for (const domain of SIX_DOMAINS) {
      const val = (raw as Record<string, unknown>)[domain];
      result[domain] = typeof val === 'string' && VALID_COVERAGES.includes(val as DomainCoverage)
        ? (val as DomainCoverage) : 'none';
    }
  } else {
    for (const domain of SIX_DOMAINS) result[domain] = 'none';
  }
  return result;
}

function parseKnowledgeStateUpdate(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value as Record<string, unknown>;
    }
  }
  return result;
}

function parseQuestionResponse(parsed: Record<string, unknown>, questionsAsked: number, toolsUsed: string[]): RoleAgentQuestionResponse {
  const question = parsed.question as Record<string, unknown> | undefined;
  const input = question?.input as Record<string, unknown> | undefined;

  const inputType = typeof input?.type === 'string' && VALID_INPUT_TYPES.includes(input.type as typeof VALID_INPUT_TYPES[number])
    ? (input.type as RoleAgentQuestionResponse['question']['input']['type'])
    : 'textarea';

  return {
    type: 'question',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    acknowledgment: typeof parsed.acknowledgment === 'string' ? parsed.acknowledgment : '',
    question: {
      id: typeof question?.id === 'string' ? question.id : `q-${questionsAsked + 1}`,
      text: typeof question?.text === 'string' ? question.text : '',
      input: {
        type: inputType,
        ...(Array.isArray(input?.options) ? { options: input.options.filter((o: unknown) => typeof o === 'string') as string[] } : {}),
        ...(typeof input?.placeholder === 'string' ? { placeholder: input.placeholder } : {}),
      },
      ...(Array.isArray(question?.suggestedAnswers) ? { suggestedAnswers: toStringArray(question.suggestedAnswers) } : {}),
    },
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
    toolsUsed,
  };
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parsePersona(raw: unknown): CandidatePersona {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    seniority: typeof r.seniority === 'string' ? r.seniority : 'Not specified',
    archetype: typeof r.archetype === 'string' ? r.archetype : 'Not specified',
    mustHaveSkills: toStringArray(r.mustHaveSkills),
    niceToHaveSkills: toStringArray(r.niceToHaveSkills),
    disposition: toStringArray(r.disposition),
    careerSignal: typeof r.careerSignal === 'string' ? r.careerSignal : 'Not specified',
    redFlags: toStringArray(r.redFlags),
    dealbreakers: toStringArray(r.dealbreakers),
  };
}

function parseSynthesisResponse(parsed: Record<string, unknown>, toolsUsed: string[]): RoleAgentSynthesisResponse {
  const persona = parsePersona(parsed.persona);
  const jobDescription = typeof parsed.jobDescription === 'string' ? parsed.jobDescription : '';
  // Legacy synthesis string: prefer explicit field, fall back to archetype so
  // any caller still reading `synthesis` gets a meaningful one-liner instead
  // of an empty string.
  const legacySynthesis = typeof parsed.synthesis === 'string' && parsed.synthesis.length > 0
    ? parsed.synthesis
    : persona.archetype;
  return {
    type: 'synthesis',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    persona,
    jobDescription,
    synthesis: legacySynthesis,
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
    toolsUsed,
  };
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Call the Role Discovery Agent with tool support.
 *
 * The agent may use tools (research_company, search_technology) mid-turn
 * to gather context before generating its question. Returns toolsUsed
 * so the frontend can show what the agent researched.
 */
export async function callRoleAgent(input: CallRoleAgentInput): Promise<RoleAgentResponse> {
  const { provider, fallbackProvider, synthesisProvider, synthesisFallbackProvider, baseline, exchanges, knowledgeState, questionsAsked, questionBudget, participantRole, domainCoverage, phaseDirective } = input;

  const budgetExhausted = questionsAsked >= questionBudget;

  // RD-P5: use phase-specific system prompt when a directive is available.
  // When budget is exhausted (synthesis turn), always use the monolithic prompt —
  // phase prompts only carry the question-turn schema; the synthesis schema (persona
  // fields, JD structure) lives exclusively in buildRoleAgentSystemPrompt.
  //
  // IMPORTANT: The core prompt contains the JSON response format schema. Phase prompts
  // only add posture-specific instructions. We MUST keep the core prompt so the model
  // knows the expected output shape (question.text, acknowledgment, domainCoverage, etc.).
  const basePrompt = buildRoleAgentSystemPrompt(participantRole);
  const systemPrompt = !budgetExhausted && phaseDirective
    ? `${basePrompt}\n\n${selectPhasePrompt(phaseDirective.phase, participantRole)}`
    : basePrompt;

  if (phaseDirective) {
    console.log(`[roleAgent] Phase: ${phaseDirective.phase} | Goal: ${phaseDirective.focusGoal}`);
  }
  const userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const maxTokens = budgetExhausted ? 4096 : 2048;

  // Use synthesis-specific provider for synthesis turns, otherwise the regular provider.
  const activeProvider = budgetExhausted ? (synthesisProvider ?? provider) : provider;
  const activeFallback = budgetExhausted ? (synthesisFallbackProvider ?? fallbackProvider ?? null) : (fallbackProvider ?? null);

  const { content, toolsUsed } = await callProviderWithFallback(
    activeProvider,
    activeFallback,
    (p) => callProviderWithTools(p, messages, maxTokens),
  );

  console.log(`[roleAgent] Provider responded, ${content.length} chars`);

  // Parse JSON
  const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(`AI provider returned invalid JSON: ${content.slice(0, 300)}`);
  }

  if (budgetExhausted || typeof parsed.synthesis === 'string') {
    return parseSynthesisResponse(parsed, toolsUsed);
  }

  return parseQuestionResponse(parsed, questionsAsked, toolsUsed);
}

// ─── Streaming variant ──────────────────────────────────────────────────────

/**
 * Streaming variant of callRoleAgent.
 *
 * Yields text chunks from the model as they arrive, then a final done event
 * with the parsed response. Falls back to a single done event (no chunks)
 * when the provider doesn't support streaming.
 */
export async function* callRoleAgentStream(
  input: CallRoleAgentInput,
): AsyncGenerator<
  | { event: 'chunk'; text: string }
  | { event: 'done'; result: RoleAgentResponse }
  | { event: 'error'; message: string }
> {
  const { provider, fallbackProvider, synthesisProvider, synthesisFallbackProvider, baseline, exchanges, knowledgeState, questionsAsked, questionBudget, participantRole, domainCoverage, phaseDirective } = input;
  const budgetExhausted = questionsAsked >= questionBudget;

  // Build prompts (same logic as callRoleAgent)
  const basePrompt = buildRoleAgentSystemPrompt(participantRole);
  const systemPrompt = !budgetExhausted && phaseDirective
    ? `${basePrompt}\n\n${selectPhasePrompt(phaseDirective.phase, participantRole)}`
    : basePrompt;

  const userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const maxTokens = budgetExhausted ? 4096 : 2048;

  // Use synthesis-specific provider for synthesis turns, otherwise the regular provider.
  const activeProvider = budgetExhausted ? (synthesisProvider ?? provider) : provider;
  const activeFallback = budgetExhausted ? (synthesisFallbackProvider ?? fallbackProvider ?? null) : (fallbackProvider ?? null);

  // Pick a provider that supports streaming; fall back to non-streaming if none do
  const streamingProvider = activeProvider?.completeStream
    ? activeProvider
    : activeFallback?.completeStream
      ? activeFallback
      : null;

  if (!streamingProvider) {
    // Neither provider supports streaming — use non-streaming path
    try {
      const result = await callRoleAgent(input);
      yield { event: 'done', result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { event: 'error', message: msg };
    }
    return;
  }

  // Stream the response
  const accumulated: string[] = [];
  try {
    for await (const token of streamingProvider.completeStream!(messages, { forceJson: true, maxTokens })) {
      accumulated.push(token);
      yield { event: 'chunk', text: token };
    }
  } catch (err) {
    console.error('[roleAgent] Streaming failed:', err);
    yield { event: 'error', message: err instanceof Error ? err.message : 'Streaming failed' };
    return;
  }

  // Parse the accumulated content
  const content = accumulated.join('').trim();
  const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    const msg = `AI provider returned invalid JSON: ${jsonText.slice(0, 300)}`;
    console.error('[roleAgent]', msg);
    yield { event: 'error', message: msg };
    return;
  }

  const result = budgetExhausted || typeof parsed.synthesis === 'string'
    ? parseSynthesisResponse(parsed, [])
    : parseQuestionResponse(parsed, questionsAsked, []);

  yield { event: 'done', result };
}

/**
 * Merge a knowledge state update into the existing knowledge state.
 */
export function mergeKnowledgeState(
  existing: Record<string, Record<string, unknown>>,
  update: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result = { ...existing };
  for (const [domain, fields] of Object.entries(update)) {
    result[domain] = { ...(result[domain] ?? {}), ...fields };
  }
  return result;
}
