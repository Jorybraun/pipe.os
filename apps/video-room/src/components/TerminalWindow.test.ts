import { describe, expect, it } from 'vitest';
import { terminalInputMessage, terminalResizeMessage } from '../lib/terminalProtocol';

describe('terminal WebSocket protocol', () => {
  it('wraps terminal keystrokes and resize events as control messages', () => {
    expect(JSON.parse(terminalInputMessage('ls\r'))).toEqual({
      type: 'TERMINAL_INPUT',
      data: 'ls\r',
    });
    expect(JSON.parse(terminalResizeMessage(120, 32))).toEqual({
      type: 'TERMINAL_RESIZE',
      cols: 120,
      rows: 32,
    });
  });
});
