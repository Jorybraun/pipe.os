import { describe, expect, it } from 'vitest';
import {
  buildTerminalCommandEvidence,
  buildTerminalOutputEvidence,
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

  it('links terminal output chunks to the completed command that produced them', () => {
    const context = {
      surface: 'win95',
      roomPhase: 'ACTIVE',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
    };

    const command = buildTerminalCommandEvidence({
      command: 'npm test',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      commandSequence: 7,
      context,
    });

    const output = buildTerminalOutputEvidence({
      output: 'PASS src/app.test.ts\n',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      outputSequence: 12,
      activeCommandId: command.properties.terminalCommandId,
      context,
    });

    expect(command).toEqual({
      text: 'npm test',
      properties: expect.objectContaining({
        source: 'container_terminal',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandSequence: 7,
        terminalCommandId: expect.stringMatching(/^terminal-workspace-session-1-guest:command:7:/),
        commandFingerprint: expect.stringMatching(/^terminal_[a-f0-9]{8}$/),
        commandLength: 8,
        workspaceSessionId: 'workspace-session-1',
      }),
    });
    expect(output).toEqual({
      text: 'PASS src/app.test.ts\n',
      properties: expect.objectContaining({
        source: 'container_terminal',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandId: command.properties.terminalCommandId,
        terminalOutputSequence: 12,
        terminalOutputChunkId: expect.stringMatching(/^terminal-workspace-session-1-guest:output:12:/),
        outputFingerprint: expect.stringMatching(/^terminal_[a-f0-9]{8}$/),
        outputLength: 21,
        workspaceSessionId: 'workspace-session-1',
      }),
    });
  });
});
