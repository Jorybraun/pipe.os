export type AgentPromptActor = 'host' | 'guest';

const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

export interface AgentBrowserPromptIdentity {
  browserPromptId: string;
  browserPromptFingerprint: string;
  browserPromptTimestamp: number;
  browserPromptLength: number;
}

export function safeAgentEvidenceIdPart(value: string | null): string {
  const normalized = (value ?? 'none')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
}

export function normalizedAgentPromptTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function agentTextFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `agent_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildAgentPromptId(input: {
  workspaceSessionId: string | null;
  actor: AgentPromptActor;
  timestamp: number;
  promptFingerprint: string;
}): string {
  const workspacePart = safeAgentEvidenceIdPart(input.workspaceSessionId);
  const promptTimestamp = normalizedAgentPromptTimestamp(input.timestamp);
  return `${workspacePart}:${input.actor}:prompt:${promptTimestamp}:${input.promptFingerprint}`;
}

export function buildAgentBrowserPromptIdentity(input: {
  text: string;
  actor: AgentPromptActor;
  timestamp: number;
  workspaceSessionId: string | null;
}): AgentBrowserPromptIdentity {
  const browserPromptFingerprint = agentTextFingerprint(input.text);
  const browserPromptTimestamp = normalizedAgentPromptTimestamp(input.timestamp);
  return {
    browserPromptId: buildAgentPromptId({
      workspaceSessionId: input.workspaceSessionId,
      actor: input.actor,
      timestamp: browserPromptTimestamp,
      promptFingerprint: browserPromptFingerprint,
    }),
    browserPromptFingerprint,
    browserPromptTimestamp,
    browserPromptLength: input.text.length,
  };
}
