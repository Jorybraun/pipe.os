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
