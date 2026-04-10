/**
 * Copilot Agent — Global recruiter assistant with skill modes.
 *
 * Runs on Gemma 4 via CloudflareAIProvider. Uses prompt-injected tool protocol
 * since Workers AI CloudflareAIProvider.supportsTools is false. The agent outputs
 * <tool_call>JSON</tool_call> blocks; this orchestrator parses and executes them.
 *
 * ReAct loop (max 3 rounds):
 * 1. Build system prompt (skill mode + context + tool protocol)
 * 2. Send messages to LLM
 * 3. Parse response for <tool_call> blocks
 * 4. If found: execute tool, append result, go to step 2
 * 5. If not: return final response
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import { buildSystemPrompt, type AgentContext } from './copilotAgentPrompts';
import { getToolsForMode, executeTool, type ToolExecContext } from './copilotTools';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CopilotInput {
  provider: LLMProvider;
  /** Full message history from the session (excluding system prompt). */
  history: LLMMessage[];
  /** New user message for this turn. */
  userMessage: string;
  /** Current skill mode. */
  skillMode: string;
  /** Pipeline context for the system prompt. */
  context: AgentContext;
  /** Execution context for tools (DB, tokens). */
  toolCtx: ToolExecContext;
}

export interface CopilotOutput {
  /** The agent's text response (with tool_call blocks stripped). */
  response: string;
  /** Tools that were called during this turn. */
  toolsUsed: string[];
  /** Updated skill mode (agent can switch modes). */
  skillMode: string;
  /** Full updated message history (for persisting back to session). */
  updatedHistory: LLMMessage[];
}

// ─── Tool call parser ───────────────────────────────────────────────────────

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const TOOL_CALL_RE = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/;

function parseToolCall(text: string): ParsedToolCall | null {
  const match = text.match(TOOL_CALL_RE);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name as string,
      arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/** Strip the <tool_call>...</tool_call> block from the response text. */
function stripToolCall(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
}

// ─── Skill mode detection ───────────────────────────────────────────────────

const SKILL_TRIGGERS: Record<string, RegExp> = {
  challenge_design: /\b(design|create|build|make)\b.*\b(challenge|code review|assessment)\b/i,
};

function detectSkillMode(message: string, currentMode: string): string {
  // If already in a skill mode, stay unless user explicitly exits
  if (currentMode !== 'general' && !/\b(exit|stop|done|back|general)\b/i.test(message)) {
    return currentMode;
  }

  for (const [mode, pattern] of Object.entries(SKILL_TRIGGERS)) {
    if (pattern.test(message)) return mode;
  }

  return 'general';
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 3;

export async function runCopilotTurn(input: CopilotInput): Promise<CopilotOutput> {
  const { provider, history, userMessage, context, toolCtx } = input;

  // Detect skill mode from user message
  const skillMode = detectSkillMode(userMessage, input.skillMode);
  const tools = getToolsForMode(skillMode);
  const systemPrompt = buildSystemPrompt(skillMode, context, tools);

  // Build message list
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const updatedHistory: LLMMessage[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  // ReAct loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await provider.complete(messages, {
      maxTokens: 1500,
    });

    const rawResponse = completion.content?.trim() ?? '';

    // Check for tool call
    const toolCall = parseToolCall(rawResponse);
    if (!toolCall) {
      // No tool call — final response
      updatedHistory.push({ role: 'assistant', content: rawResponse });
      return {
        response: rawResponse,
        toolsUsed,
        skillMode,
        updatedHistory,
      };
    }

    // Execute tool
    const textBeforeToolCall = stripToolCall(rawResponse);
    console.log(`[copilotAgent] Tool call round ${round + 1}: ${toolCall.name}`);
    toolsUsed.push(toolCall.name);

    const toolResult = await executeTool(toolCall, toolCtx);

    // Append to messages for next round
    const assistantContent = textBeforeToolCall
      ? `${textBeforeToolCall}\n\n[Calling tool: ${toolCall.name}]`
      : `[Calling tool: ${toolCall.name}]`;

    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: `Tool result for ${toolCall.name}:\n\n${toolResult}`,
    });

    // Track in history
    updatedHistory.push({ role: 'assistant', content: assistantContent });
    updatedHistory.push({
      role: 'user',
      content: `Tool result for ${toolCall.name}:\n\n${toolResult}`,
    });
  }

  // Fell through max rounds — get final response without tools
  const finalCompletion = await provider.complete(messages, {
    maxTokens: 1500,
  });

  const finalResponse = finalCompletion.content?.trim() ?? 'I ran out of tool rounds. Let me know how to help.';
  updatedHistory.push({ role: 'assistant', content: finalResponse });

  return {
    response: finalResponse,
    toolsUsed,
    skillMode,
    updatedHistory,
  };
}

// ─── Mock response ──────────────────────────────────────────────────────────

export function getMockCopilotResponse(message: string, skillMode: string): CopilotOutput {
  const isChallenge = skillMode === 'challenge_design' || /challenge|code review/i.test(message);

  return {
    response: isChallenge
      ? "I can help you design a code review challenge. What tech stack should it focus on? I'll search for repos that match and find PRs that would make good review exercises."
      : "I'm your PIPE copilot. I can help you design challenges, explain scores, or advise on your pipeline structure. What would you like to work on?",
    toolsUsed: [],
    skillMode: isChallenge ? 'challenge_design' : 'general',
    updatedHistory: [
      { role: 'user', content: message },
      {
        role: 'assistant',
        content: isChallenge
          ? "I can help you design a code review challenge. What tech stack should it focus on?"
          : "I'm your PIPE copilot. I can help you design challenges, explain scores, or advise on your pipeline structure.",
      },
    ],
  };
}
