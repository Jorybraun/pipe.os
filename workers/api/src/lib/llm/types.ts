/**
 * LLM Provider interface — provider-agnostic abstraction for the role agent.
 *
 * Each provider translates to/from its own API format internally. The role
 * agent only speaks these standardized types.
 */

// ─── Standardized message types ─────────────────────────────────────────────

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMMessageRole;
  content: string | null;
  toolCalls?: LLMToolCall[];
  /** Required when role === 'tool' */
  toolCallId?: string;
  toolName?: string;
}

// ─── Tool definition ─────────────────────────────────────────────────────────

export interface LLMToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LLMToolParameter>;
    required?: string[];
  };
}

// ─── Completion result ────────────────────────────────────────────────────────

export interface LLMCompletion {
  content: string | null;
  toolCalls?: LLMToolCall[];
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface CompleteOptions {
  tools?: LLMTool[];
  forceJson?: boolean;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly supportsTools: boolean;
  complete(messages: LLMMessage[], options?: CompleteOptions): Promise<LLMCompletion>;
}
