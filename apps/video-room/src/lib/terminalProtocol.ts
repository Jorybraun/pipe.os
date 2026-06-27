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
