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

const ANSI_ESCAPE_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const DEFAULT_TERMINAL_EVIDENCE_LIMIT = 4000;
const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

export interface TerminalEvidenceContext {
  surface: string;
  roomPhase: string;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}

export interface TerminalCommandEvidenceProperties extends Record<string, unknown> {
  source: 'container_terminal';
  terminalSessionId: string;
  terminalCommandId: string;
  terminalCommandSequence: number;
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
  terminalSessionId: string;
  terminalCommandId: string | null;
  terminalOutputChunkId: string;
  terminalOutputSequence: number;
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
  context: TerminalEvidenceContext;
}

export interface TerminalOutputEvidenceInput {
  output: string;
  terminalSessionId: string;
  outputSequence: number;
  activeCommandId: string | null;
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

function terminalContextProperties(context: TerminalEvidenceContext): Pick<
  TerminalCommandEvidenceProperties,
  'source' | 'surface' | 'roomPhase' | 'workspaceStatus' | 'workspaceSessionId' | 'repoUrl'
> {
  return {
    source: 'container_terminal',
    surface: context.surface,
    roomPhase: context.roomPhase,
    workspaceStatus: context.workspaceStatus,
    workspaceSessionId: context.workspaceSessionId,
    repoUrl: context.repoUrl,
  };
}

export function collectTerminalCommands(buffer: string, data: string): TerminalCommandCaptureResult {
  let nextBuffer = buffer;
  const commands: string[] = [];

  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const command = nextBuffer.trim();
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
  const visible = output.replace(ANSI_ESCAPE_RE, '').trim();
  if (visible.length === 0) return null;
  return output.slice(0, maxLength);
}

export function buildTerminalCommandEvidence({
  command,
  terminalSessionId,
  commandSequence,
  context,
}: TerminalCommandEvidenceInput): TerminalCommandEvidence {
  const safeSessionId = safeTerminalIdPart(terminalSessionId);
  const commandFingerprint = terminalTextFingerprint(command);
  return {
    text: command,
    properties: {
      ...terminalContextProperties(context),
      terminalSessionId: safeSessionId,
      terminalCommandId: `${safeSessionId}:command:${commandSequence}:${commandFingerprint}`,
      terminalCommandSequence: commandSequence,
      commandFingerprint,
      commandLength: command.length,
    },
  };
}

export function buildTerminalOutputEvidence({
  output,
  terminalSessionId,
  outputSequence,
  activeCommandId,
  context,
}: TerminalOutputEvidenceInput): TerminalOutputEvidence {
  const safeSessionId = safeTerminalIdPart(terminalSessionId);
  const outputFingerprint = terminalTextFingerprint(output);
  return {
    text: output,
    properties: {
      ...terminalContextProperties(context),
      terminalSessionId: safeSessionId,
      terminalCommandId: activeCommandId,
      terminalOutputChunkId: `${safeSessionId}:output:${outputSequence}:${outputFingerprint}`,
      terminalOutputSequence: outputSequence,
      outputFingerprint,
      outputLength: output.length,
    },
  };
}
