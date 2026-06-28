import { describe, expect, it } from 'vitest';
import {
  buildTerminalCommandEvidence,
  buildTerminalOutputEvidence,
  collectTerminalCommands,
  redactTerminalEvidenceText,
  terminalCommandInputData,
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
    expect(terminalCommandInputData(' devin auth login --force-manual-token-flow ')).toBe(
      'devin auth login --force-manual-token-flow\r',
    );
    expect(JSON.parse(terminalResizeMessage(120, 32))).toEqual({
      type: 'TERMINAL_RESIZE',
      cols: 120,
      rows: 32,
    });
  });

  it('redacts auth tokens before terminal commands or output become evidence', () => {
    const token = 'cog_oetjr6udnnd3vvvp5p6f577r7taxudks7fxdld7qnutgx55eewsa';
    expect(redactTerminalEvidenceText(`DEVIN_API_KEY=${token}`)).toBe('DEVIN_API_KEY=[REDACTED_SECRET]');

    const command = collectTerminalCommands('', `export DEVIN_API_KEY=${token}\r`);
    expect(command.commands).toEqual(['export DEVIN_API_KEY=[REDACTED_SECRET]']);

    const output = terminalOutputEvidenceText(`Paste this token: ${token}\n`);
    expect(output).toBe('Paste this token: [REDACTED_SECRET]\n');
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

  it('does not build terminal evidence until a real workspace session exists', () => {
    const context = {
      surface: 'win95',
      roomPhase: 'ACTIVE',
      workspaceStatus: null,
      workspaceSessionId: null,
      repoUrl: null,
    };

    expect(buildTerminalCommandEvidence({
      command: 'npm test',
      terminalSessionId: 'terminal-no-workspace-guest',
      commandSequence: 1,
      actor: 'guest',
      capturedAtMs: 1700000000000,
      context,
    })).toBeNull();
    expect(buildTerminalOutputEvidence({
      output: 'PASS src/app.test.ts\n',
      terminalSessionId: 'terminal-no-workspace-guest',
      outputSequence: 1,
      activeCommandId: null,
      capturedAtMs: 1700000000100,
      context,
    })).toBeNull();
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
      actor: 'guest',
      capturedAtMs: 1700000000000,
      context,
    });

    const retriedCommand = buildTerminalCommandEvidence({
      command: 'npm test',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      commandSequence: 7,
      actor: 'guest',
      capturedAtMs: 1700000005000,
      context,
    });

    const output = buildTerminalOutputEvidence({
      output: 'PASS src/app.test.ts\n',
      terminalSessionId: 'terminal-workspace-session-1-guest',
      outputSequence: 12,
      activeCommandId: command?.properties.terminalCommandId ?? null,
      capturedAtMs: 1700000000100,
      context,
    });

    expect(command).not.toBeNull();
    expect(retriedCommand).not.toBeNull();
    expect(output).not.toBeNull();
    if (!command || !retriedCommand || !output) throw new Error('expected workspace-backed terminal evidence');

    expect(command).toEqual({
      text: 'npm test',
      properties: expect.objectContaining({
        source: 'container_terminal',
        terminalEventSource: 'browser_terminal_ws',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandSequence: 7,
        terminalCommandId: expect.stringMatching(/^terminal-workspace-session-1-guest:command:guest:1700000000000:7:/),
        actor: 'guest',
        capturedAtMs: 1700000000000,
        commandFingerprint: expect.stringMatching(/^terminal_[a-f0-9]{8}$/),
        commandLength: 8,
        workspaceSessionId: 'workspace-session-1',
      }),
    });
    expect(retriedCommand.properties.terminalCommandId).not.toBe(command.properties.terminalCommandId);
    expect(output).toEqual({
      text: 'PASS src/app.test.ts\n',
      properties: expect.objectContaining({
        source: 'container_terminal',
        terminalEventSource: 'browser_terminal_ws',
        terminalSessionId: 'terminal-workspace-session-1-guest',
        terminalCommandId: command.properties.terminalCommandId,
        terminalOutputSequence: 12,
        terminalOutputChunkId: expect.stringMatching(/^terminal-workspace-session-1-guest:output:system:1700000000100:12:/),
        actor: 'system',
        capturedAtMs: 1700000000100,
        outputFingerprint: expect.stringMatching(/^terminal_[a-f0-9]{8}$/),
        outputLength: 21,
        workspaceSessionId: 'workspace-session-1',
      }),
    });
  });

  it('redacts secrets before fingerprinting terminal evidence', () => {
    const context = {
      surface: 'win95',
      roomPhase: 'ACTIVE',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-session-1',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
    };
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const command = buildTerminalCommandEvidence({
      command: `export GITHUB_TOKEN=${secret}`,
      terminalSessionId: 'terminal-workspace-session-1-host',
      commandSequence: 1,
      actor: 'host',
      capturedAtMs: 1700000000000,
      context,
    });
    const output = buildTerminalOutputEvidence({
      output: `authenticated with ${secret}\n`,
      terminalSessionId: 'terminal-workspace-session-1-host',
      outputSequence: 1,
      activeCommandId: command?.properties.terminalCommandId ?? null,
      capturedAtMs: 1700000000100,
      context,
    });

    expect(command).not.toBeNull();
    expect(output).not.toBeNull();
    if (!command || !output) throw new Error('expected workspace-backed terminal evidence');

    expect(command.text).toBe('export GITHUB_TOKEN=[REDACTED_SECRET]');
    expect(command.properties.commandLength).toBe(command.text.length);
    expect(output.text).toBe('authenticated with [REDACTED_SECRET]\n');
    expect(output.properties.outputLength).toBe(output.text.length);
  });
});
