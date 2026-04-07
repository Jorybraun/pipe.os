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

/** Token usage reported by the provider, when available. */
export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMCompletion {
  content: string | null;
  toolCalls?: LLMToolCall[];
  /** Token usage reported by the underlying provider. May be absent if the
   *  provider does not return usage metadata for this model/call. */
  usage?: LLMUsage;
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
