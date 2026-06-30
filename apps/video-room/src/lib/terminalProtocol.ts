export interface TerminalInputControlMessage {
  type: 'TERMINAL_INPUT';
  data: string;
}

export interface TerminalResizeControlMessage {
  type: 'TERMINAL_RESIZE';
  cols: number;
  rows: number;
}

export function terminalInputMessage(data: string): string {
  const message: TerminalInputControlMessage = {
    type: 'TERMINAL_INPUT',
    data,
  };
  return JSON.stringify(message);
}

export function terminalCommandInputData(command: string): string {
  return `${command.trim()}\r`;
}

export function terminalResizeMessage(cols: number, rows: number): string {
  const message: TerminalResizeControlMessage = {
    type: 'TERMINAL_RESIZE',
    cols,
    rows,
  };
  return JSON.stringify(message);
}

export interface TerminalCommandCaptureResult {
  buffer: string;
  commands: string[];
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const DEFAULT_TERMINAL_EVIDENCE_LIMIT = 4000;
const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;
const TERMINAL_REDACTED_SECRET = '[REDACTED_SECRET]';
const BARE_SECRET_RE = /\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g;
const GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const ENV_SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/gi;

export interface TerminalEvidenceContext {
  surface: string;
  roomPhase: string;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}

export type TerminalEvidenceActor = 'host' | 'guest';

export interface TerminalCommandEvidenceProperties extends Record<string, unknown> {
  source: 'container_terminal';
  terminalEventSource: 'browser_terminal_ws';
  terminalSessionId: string;
  terminalCommandId: string;
  terminalCommandSequence: number;
  actor: TerminalEvidenceActor;
  capturedAtMs: number;
  commandFingerprint: string;
  commandLength: number;
  surface: string;
  roomPhase: string;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}

export interface TerminalOutputEvidenceProperties extends Record<string, unknown> {
  source: 'container_terminal';
  terminalEventSource: 'browser_terminal_ws';
  terminalSessionId: string;
  terminalCommandId: string | null;
  terminalOutputChunkId: string;
  terminalOutputSequence: number;
  actor: 'system';
  capturedAtMs: number;
  outputFingerprint: string;
  outputLength: number;
  surface: string;
  roomPhase: string;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}

export interface TerminalCommandEvidenceInput {
  command: string;
  terminalSessionId: string;
  commandSequence: number;
  actor: TerminalEvidenceActor;
  capturedAtMs: number;
  context: TerminalEvidenceContext;
}

export interface TerminalOutputEvidenceInput {
  output: string;
  terminalSessionId: string;
  outputSequence: number;
  activeCommandId: string | null;
  capturedAtMs: number;
  context: TerminalEvidenceContext;
}

export interface TerminalCommandEvidence {
  text: string;
  properties: TerminalCommandEvidenceProperties;
}

export interface TerminalOutputEvidence {
  text: string;
  properties: TerminalOutputEvidenceProperties;
}

function safeTerminalIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'terminal';
}

export function terminalTextFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `terminal_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function redactTerminalEvidenceText(text: string): string {
  return text
    .replace(ENV_SECRET_ASSIGNMENT_RE, (_match, name: string) => `${name}=${TERMINAL_REDACTED_SECRET}`)
    .replace(GITHUB_PAT_RE, TERMINAL_REDACTED_SECRET)
    .replace(BARE_SECRET_RE, TERMINAL_REDACTED_SECRET);
}

function terminalContextProperties(context: TerminalEvidenceContext): Pick<
  TerminalCommandEvidenceProperties,
  'source' | 'terminalEventSource' | 'surface' | 'roomPhase' | 'workspaceStatus' | 'workspaceSessionId' | 'repoUrl'
> {
  return {
    source: 'container_terminal',
    terminalEventSource: 'browser_terminal_ws',
    surface: context.surface,
    roomPhase: context.roomPhase,
    workspaceStatus: context.workspaceStatus,
    workspaceSessionId: context.workspaceSessionId,
    repoUrl: context.repoUrl,
  };
}

function hasWorkspaceTerminalContext(context: TerminalEvidenceContext): boolean {
  return typeof context.workspaceStatus === 'string'
    && context.workspaceStatus.trim().length > 0
    && typeof context.workspaceSessionId === 'string'
    && context.workspaceSessionId.trim().length > 0;
}

export function collectTerminalCommands(buffer: string, data: string): TerminalCommandCaptureResult {
  let nextBuffer = buffer;
  const commands: string[] = [];

  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const command = redactTerminalEvidenceText(nextBuffer.trim());
      if (command.length > 0) commands.push(command);
      nextBuffer = '';
      continue;
    }
    if (char === '\u0003') {
      nextBuffer = '';
      continue;
    }
    if (char === '\b' || char === '\u007f') {
      nextBuffer = nextBuffer.slice(0, -1);
      continue;
    }
    if (char >= ' ' && char !== '\u007f') {
      nextBuffer += char;
    }
  }

  return { buffer: nextBuffer.slice(-DEFAULT_TERMINAL_EVIDENCE_LIMIT), commands };
}

export function terminalOutputEvidenceText(
  output: string,
  maxLength = DEFAULT_TERMINAL_EVIDENCE_LIMIT,
): string | null {
  const redacted = redactTerminalEvidenceText(output);
  const visible = redacted.replace(ANSI_ESCAPE_RE, '').trim();
  if (visible.length === 0) return null;
  return redacted.slice(0, maxLength);
}

export function buildTerminalCommandEvidence({
  command,
  terminalSessionId,
  commandSequence,
  actor,
  capturedAtMs,
  context,
}: TerminalCommandEvidenceInput): TerminalCommandEvidence | null {
  if (!hasWorkspaceTerminalContext(context)) return null;
  const safeSessionId = safeTerminalIdPart(terminalSessionId);
  const safeCapturedAtMs = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  const redactedCommand = redactTerminalEvidenceText(command);
  const commandFingerprint = terminalTextFingerprint(redactedCommand);
  return {
    text: redactedCommand,
    properties: {
      ...terminalContextProperties(context),
      terminalSessionId: safeSessionId,
      terminalCommandId: `${safeSessionId}:command:${actor}:${safeCapturedAtMs}:${commandSequence}:${commandFingerprint}`,
      terminalCommandSequence: commandSequence,
      actor,
      capturedAtMs: safeCapturedAtMs,
      commandFingerprint,
      commandLength: redactedCommand.length,
    },
  };
}

export function buildTerminalOutputEvidence({
  output,
  terminalSessionId,
  outputSequence,
  activeCommandId,
  capturedAtMs,
  context,
}: TerminalOutputEvidenceInput): TerminalOutputEvidence | null {
  if (!hasWorkspaceTerminalContext(context)) return null;
  const safeSessionId = safeTerminalIdPart(terminalSessionId);
  const safeCapturedAtMs = Number.isFinite(capturedAtMs) ? Math.max(0, Math.round(capturedAtMs)) : 0;
  const redactedOutput = redactTerminalEvidenceText(output);
  const outputFingerprint = terminalTextFingerprint(redactedOutput);
  return {
    text: redactedOutput,
    properties: {
      ...terminalContextProperties(context),
      terminalSessionId: safeSessionId,
      terminalCommandId: activeCommandId,
      terminalOutputChunkId: `${safeSessionId}:output:system:${safeCapturedAtMs}:${outputSequence}:${outputFingerprint}`,
      terminalOutputSequence: outputSequence,
      actor: 'system',
      capturedAtMs: safeCapturedAtMs,
      outputFingerprint,
      outputLength: redactedOutput.length,
    },
  };
}
