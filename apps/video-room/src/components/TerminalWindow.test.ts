import { describe, expect, it } from 'vitest';
import {
  collectTerminalCommands,
  terminalInputMessage,
  terminalOutputEvidenceText,
  terminalResizeMessage,
} from '../lib/terminalProtocol';

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

  it('extracts completed terminal commands from real keystroke chunks', () => {
    const first = collectTerminalCommands('', 'npm ');
    expect(first).toEqual({ buffer: 'npm ', commands: [] });

    const second = collectTerminalCommands(first.buffer, 'tesx\u007ft\r');
    expect(second).toEqual({ buffer: '', commands: ['npm test'] });
  });

  it('drops cancelled terminal input instead of fabricating a command', () => {
    expect(collectTerminalCommands('rm -rf /', '\u0003')).toEqual({
      buffer: '',
      commands: [],
    });
  });

  it('keeps terminal output evidence bounded while preserving original text', () => {
    expect(terminalOutputEvidenceText('\x1b[32mok\x1b[0m\r\n')).toBe('\x1b[32mok\x1b[0m\r\n');
    expect(terminalOutputEvidenceText('\x1b[0m\r\n')).toBeNull();
    expect(terminalOutputEvidenceText('x'.repeat(5000))?.length).toBe(4000);
  });
});
