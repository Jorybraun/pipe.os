/**
 * Role Discovery Agent — provider-agnostic with tool calling support.
 *
 * Uses the LLMProvider interface so Mistral and Google AI (Gemma 4) can be
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
  maxTokens = 1024,
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

// ─── Mock response (for testing without API key) ────────────────────────────

function getMockQuestionResponse(questionsAsked: number): RoleAgentQuestionResponse {
  const questionNum = questionsAsked + 1;
  return {
    type: 'question',
    reasoning: `[MOCK] Generating question ${questionNum}.`,
    acknowledgment: questionNum === 1
      ? "I'll help you build a detailed profile for this role so we can design assessments that test for what actually matters."
      : 'Thanks for that context — it helps me understand the scope.',
    question: {
      id: `q-${questionNum}`,
      text: questionNum === 1
        ? "Are you the hiring manager, or recruiting on someone's behalf?"
        : `Mock question #${questionNum} — what does the day-to-day look like?`,
      input: {
        type: questionNum === 1 ? 'radio' : 'textarea',
        ...(questionNum === 1 ? { options: ['I\'m the hiring manager', 'I\'m recruiting for someone else'] } : {}),
        ...(questionNum === 1 ? {} : { placeholder: 'Describe a typical week...' }),
      },
    },
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    toolsUsed: [],
  };
}

function getMockSynthesisResponse(baseline: Record<string, unknown>): RoleAgentSynthesisResponse {
  const title = typeof baseline.title === 'string' ? baseline.title : 'the role';
  const companyName = typeof baseline.companyName === 'string' ? baseline.companyName : 'the company';
  const location = typeof baseline.location === 'string' ? baseline.location : 'Remote';

  const persona: CandidatePersona = {
    seniority: 'Mid-to-senior, 4-7 years',
    archetype: `Practitioner-shaped ${title} who has shipped and owned the outcome`,
    mustHaveSkills: [
      'Has written and maintained production code for 3+ years',
      'Can reason about trade-offs out loud',
      'Comfortable with ambiguity in requirements',
    ],
    niceToHaveSkills: [
      'Prior experience at a similar-stage company',
      'Has given technical talks or mentored juniors',
    ],
    disposition: [
      'Pragmatic over dogmatic',
      'Asks questions before assuming',
      'Comfortable with iterative feedback',
    ],
    careerSignal: 'Has shipped at least one substantial feature end-to-end',
    redFlags: [
      'Only ever worked in isolation',
      'Cannot articulate why they made past technical decisions',
    ],
    dealbreakers: [],
  };

  const jobDescription = `# ${title}

${companyName} is hiring a ${title} to join the team ${location ? `(${location})` : ''}.

## The Role

You'll own meaningful work from day one — shipping features that real users depend on, and shaping how the team builds over time.

## What You'll Do

- Ship features end-to-end, from design through production
- Collaborate closely with product and design on trade-offs
- Review code with care and push back when something doesn't add up

## What You Bring

- 3+ years writing production code
- Opinions about engineering craft, held loosely
- Comfort with ambiguity and iterative feedback

## Bonus Points

- Prior experience at a similar-stage company
- Have given technical talks or mentored others

## How to Apply

Hit apply — we'll be in touch within a few days. No cover letter needed.
`;

  return {
    type: 'synthesis',
    reasoning: '[MOCK] Budget exhausted. Mock persona + JD returned because MISTRAL_API_KEY is not configured.',
    persona,
    jobDescription,
    synthesis: persona.archetype,
    knowledgeStateUpdate: {},
    domainCoverage: { why: 'partial', work: 'partial', team: 'sparse', bar: 'sparse', codebase: 'none', process: 'none' },
    toolsUsed: [],
  };
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
  const { provider, baseline, exchanges, knowledgeState, questionsAsked, questionBudget, participantRole, domainCoverage, phaseDirective } = input;

  const budgetExhausted = questionsAsked >= questionBudget;

  if (!provider) {
    console.log('[roleAgent] No provider configured. Returning mock response.');
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  // RD-P5: use phase-specific system prompt when a directive is available;
  // fall back to the monolithic prompt for backwards compatibility.
  const systemPrompt = phaseDirective
    ? selectPhasePrompt(phaseDirective.phase, participantRole)
    : buildRoleAgentSystemPrompt(participantRole);

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

  const maxTokens = budgetExhausted ? 1536 : 1024;

  let content: string;
  let toolsUsed: string[];
  console.log(`[roleAgent] Calling provider: ${provider.name}`);
  try {
    const result = await callProviderWithTools(provider, messages, maxTokens);
    content = result.content;
    toolsUsed = result.toolsUsed;
    console.log(`[roleAgent] Provider ${provider.name} responded, ${content.length} chars`);
  } catch (err) {
    console.error(`[roleAgent] ${provider.name} call failed:`, err);
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  if (!content) {
    console.warn('[roleAgent] Provider returned empty content. Falling back to mock.');
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  // Parse JSON
  let parsed: Record<string, unknown>;
  try {
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    console.error('[roleAgent] Failed to parse JSON:', content.slice(0, 300));
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
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
> {
  const { provider, baseline, exchanges, knowledgeState, questionsAsked, questionBudget, participantRole, domainCoverage, phaseDirective } = input;
  const budgetExhausted = questionsAsked >= questionBudget;

  // No provider or no streaming support — fall back to non-streaming
  if (!provider?.completeStream) {
    const result = await callRoleAgent(input);
    yield { event: 'done', result };
    return;
  }

  // Build prompts (same logic as callRoleAgent)
  const systemPrompt = phaseDirective
    ? selectPhasePrompt(phaseDirective.phase, participantRole)
    : buildRoleAgentSystemPrompt(participantRole);

  const userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const maxTokens = budgetExhausted ? 1536 : 1024;

  // Stream the response
  const accumulated: string[] = [];
  try {
    for await (const token of provider.completeStream(messages, { forceJson: true, maxTokens })) {
      accumulated.push(token);
      yield { event: 'chunk', text: token };
    }
  } catch (err) {
    console.error('[roleAgent] Streaming failed:', err);
    yield { event: 'done', result: budgetExhausted ? getMockSynthesisResponse(baseline) : getMockQuestionResponse(questionsAsked) };
    return;
  }

  // Parse the accumulated content
  const content = accumulated.join('').trim();
  const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    console.error('[roleAgent] Failed to parse streamed JSON:', jsonText.slice(0, 300));
    yield { event: 'done', result: budgetExhausted ? getMockSynthesisResponse(baseline) : getMockQuestionResponse(questionsAsked) };
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
